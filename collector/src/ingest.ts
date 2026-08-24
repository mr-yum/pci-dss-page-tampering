import { createHash, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import type { CspViolationObservation, Observation } from '../../src/types/beacon.js'
import { MAX_BEACON_BYTES, parseBeacon } from '../../src/types/beacon.js'
import { buildNoveltyKey, ttlEpochSeconds } from './novelty.js'

/**
 * Collector ingest Lambda handler — contracts/collector-ingest.md.
 *
 * The pipeline per request: edge auth → Origin → target stamping → strict
 * schema parse → Firehose archive → per-observation novelty write and
 * first-sighting enqueue → metrics. Every path returns 204 with an empty
 * body (no-oracle contract): the response must not reveal whether auth,
 * origin mapping, or validation succeeded.
 *
 * A second route, `POST /csp-reports`, ingests browser-native CSP violation
 * reports (report-uri and Reporting API report-to formats) and maps them to
 * synthetic `csp-violation` observations through the same archive → novelty
 * → enqueue pipeline — see the contract's addendum.
 *
 * `createHandler(config, deps)` takes thin injected clients so tests use
 * plain jest.fn deps; the default export wires the same handler to real
 * AWS SDK v3 clients. The esbuild bundle deliberately includes the SDK
 * (no --external) so the deployed artefact pins the exact client versions
 * from package-lock.json instead of trusting whatever the Lambda runtime
 * happens to ship.
 */

const EDGE_KEY_HEADER = 'x-collector-edge-key'

/** Env names match infra/collector-core/lambda.tf exactly. */
const OriginTargetSchema = z.object({
  origin: z.string().min(1),
  target_id: z.string().min(1),
  target_type: z.enum(['inventory', 'detection']),
})

export type OriginTarget = z.infer<typeof OriginTargetSchema>

export interface CollectorConfig {
  originTargets: OriginTarget[]
  edgeAuthMode: 'aws_iam' | 'shared_secret'
  edgeSharedSecret?: string
  firehoseStream: string
  noveltyTable: string
  queueUrl: string
  noveltyTtlDays: number
  metricNamespace: string
}

export const loadConfigFromEnv = (env: Record<string, string | undefined>): CollectorConfig => {
  const require_ = (name: string): string => {
    const value = env[name]
    if (!value) throw new Error(`missing required environment variable ${name}`)
    return value
  }

  const edgeAuthMode = require_('EDGE_AUTH_MODE')
  if (edgeAuthMode !== 'aws_iam' && edgeAuthMode !== 'shared_secret') {
    throw new Error(`EDGE_AUTH_MODE must be "aws_iam" or "shared_secret", got "${edgeAuthMode}"`)
  }

  const noveltyTtlDays = Number.parseInt(require_('NOVELTY_TTL_DAYS'), 10)
  if (Number.isNaN(noveltyTtlDays) || noveltyTtlDays <= 0) {
    throw new Error(`NOVELTY_TTL_DAYS must be a positive integer, got "${env['NOVELTY_TTL_DAYS']}"`)
  }

  return {
    originTargets: z.array(OriginTargetSchema).parse(JSON.parse(require_('ORIGIN_TARGETS'))),
    edgeAuthMode,
    ...(edgeAuthMode === 'shared_secret' ? { edgeSharedSecret: require_('EDGE_SHARED_SECRET') } : {}),
    firehoseStream: require_('FIREHOSE_STREAM'),
    noveltyTable: require_('NOVELTY_TABLE'),
    queueUrl: require_('QUEUE_URL'),
    noveltyTtlDays,
    metricNamespace: require_('METRIC_NAMESPACE'),
  }
}

/** Novelty record attributes, data-model.md §4. */
export interface NoveltyItem {
  pk: string
  first_seen: number
  last_seen: number
  sessions: number
  first_route: string
  target_type: 'inventory' | 'detection'
  ttl: number
}

export interface MetricDatum {
  name: string
  value: number
  unit: 'Count' | 'Milliseconds'
  dimensions: Record<string, string>
}

/**
 * Thin domain-shaped dependency ports (not SDK client shapes) so unit tests
 * inject plain jest.fn implementations. The real adapters below translate to
 * AWS SDK v3 commands; the only SDK semantic that leaks through is the
 * conditional-write failure, signalled by an error whose `name` is
 * `ConditionalCheckFailedException` (what the DynamoDB client actually throws).
 */
export interface CollectorDeps {
  firehose: { putRecord(input: { streamName: string; data: string }): Promise<unknown> }
  dynamo: {
    /** PutItem with attribute_not_exists(pk); rejects with ConditionalCheckFailedException when the pk exists. */
    putItemIfAbsent(input: { table: string; item: NoveltyItem }): Promise<unknown>
    /** SET last_seen, ADD sessions 1 on an existing record. */
    updateCounters(input: { table: string; pk: string; lastSeen: number }): Promise<unknown>
    /** DeleteItem by pk — compensates a first-sighting put whose SQS enqueue failed. */
    deleteItem(input: { table: string; pk: string }): Promise<unknown>
  }
  sqs: { sendMessage(input: { queueUrl: string; body: string; attributes: Record<string, string> }): Promise<unknown> }
  metrics: { publish(input: { namespace: string; data: MetricDatum[] }): Promise<unknown> }
  now: () => number
}

/** Lambda Function URL (payload v2) event subset the handler consumes. */
export interface FunctionUrlEvent {
  rawPath?: string
  headers?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
}

export interface FunctionUrlResult {
  statusCode: 204
  body: ''
}

/** The single response object: no code path may construct any other. */
const NO_CONTENT: FunctionUrlResult = { statusCode: 204, body: '' }

const headerValue = (event: FunctionUrlEvent, name: string): string | undefined => {
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}

/** Constant-time equality over sha256 digests, so length differences leak nothing. */
const secretMatches = (provided: string | undefined, expected: string): boolean => {
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(provided ?? ''), digest(expected))
}

/** Per-invocation metric accumulator, flushed once from the handler's finally. */
class MetricsBatch {
  private readonly data: MetricDatum[] = []

  count(name: string, dimensions: Record<string, string> = {}, value = 1): void {
    this.data.push({ name, value, unit: 'Count', dimensions })
  }

  millis(name: string, value: number, dimensions: Record<string, string> = {}): void {
    this.data.push({ name, value, unit: 'Milliseconds', dimensions })
  }

  drain(): MetricDatum[] {
    return this.data.splice(0)
  }
}

const decodeBody = (event: FunctionUrlEvent): string => {
  const body = event.body ?? ''
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
}

const isConditionalCheckFailed = (error: unknown): boolean => error instanceof Error && error.name === 'ConditionalCheckFailedException'

const processObservation = async (observation: Observation, sessionId: string, target: OriginTarget, receivedAt: number, config: CollectorConfig, deps: CollectorDeps, metrics: MetricsBatch): Promise<void> => {
  const targetDimension = { TargetId: target.target_id }

  if (observation.kind === 'agent-health') {
    // Never keyed, never enqueued — metrics only (data-model.md §2d).
    metrics.millis('rum_agent_p95_task_ms', observation.p95TaskMs, targetDimension)
    metrics.count('rum_agent_dropped', targetDimension, observation.dropped)
    return
  }

  const pk = buildNoveltyKey(target.target_id, observation)
  try {
    await deps.dynamo.putItemIfAbsent({
      table: config.noveltyTable,
      item: {
        pk,
        first_seen: receivedAt,
        last_seen: receivedAt,
        sessions: 1,
        first_route: observation.route,
        target_type: target.target_type,
        ttl: ttlEpochSeconds(receivedAt, config.noveltyTtlDays),
      },
    })
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error
    // Repeat sighting: counters only, nothing enqueued.
    await deps.dynamo.updateCounters({ table: config.noveltyTable, pk, lastSeen: receivedAt })
    metrics.count('rum_observations_counted', targetDimension)
    return
  }

  // First sighting: enqueue exactly on conditional-write success
  // (queue-message.md producer obligations; duplicates on Lambda retry are
  // absorbed by consumer idempotency on novelty.pk).
  metrics.count('rum_first_sightings', targetDimension)
  try {
    await deps.sqs.sendMessage({
      queueUrl: config.queueUrl,
      body: JSON.stringify({
        v: 1,
        target_id: target.target_id,
        target_type: target.target_type,
        observation,
        novelty: { pk, first_seen: receivedAt, first_route: observation.route },
        received_at: receivedAt,
        session_id: sessionId,
      }),
      attributes: { target_type: target.target_type, kind: observation.kind },
    })
  } catch (error) {
    // Compensating delete (NOT an outbox): the novelty record persisted but the
    // queue message did not, so without this the pk would suppress re-enqueue
    // for the whole TTL (90 days) and the observation would be silently lost —
    // worse than at-least-once. Deleting the just-written item lets a later
    // delivery re-trigger the first-sighting path. Best-effort: a failed
    // compensation is logged and the always-204 contract still holds.
    try {
      await deps.dynamo.deleteItem({ table: config.noveltyTable, pk })
    } catch (compensationError) {
      console.error('collector: novelty compensation delete failed', compensationError)
    }
    throw error
  }
}

/**
 * Browser-native CSP report ingestion — contracts/collector-ingest.md addendum.
 *
 * Both delivery formats are accepted on `POST /csp-reports`, recognised by
 * body shape rather than Content-Type (UAs vary): the legacy report-uri
 * object `{"csp-report": {…}}` and the Reporting API report-to array of
 * `{type: "csp-violation", body: {…}}` records (records of other report
 * types in the batch are not ours and are skipped, not rejected).
 */
const CSP_REPORTS_PATH = '/csp-reports'

/**
 * Queue-message session id for observations minted from browser-native CSP
 * reports: they carry no agent session, and the queue contract only requires
 * a non-empty string, so a fixed sentinel marks the provenance.
 */
const CSP_REPORT_SESSION_ID = 'csp-report'

/** One CSP violation record, normalised across the two delivery formats. */
interface CspReportSource {
  /**
   * The report record as received, EXCEPT the document URL field, which is
   * redacted to origin + pathname before archival — the same PII rule applied
   * to `page.url` on the beacon path. `document-uri`/`documentURL` routinely
   * carry query strings and fragments (tokens, order ids), and the archive has
   * a one-year retention, so the raw value must never enter it.
   */
  verbatim: unknown
  directive: string
  blockedUri: string
  documentUrl: URL
}

interface CspFieldKeys {
  directive: string[]
  blockedUri: string[]
  documentUrl: string[]
}

/** report-uri body field names; `violated-directive` is the pre-CSP2 fallback. */
const REPORT_URI_KEYS: CspFieldKeys = { directive: ['effective-directive', 'violated-directive'], blockedUri: ['blocked-uri'], documentUrl: ['document-uri'] }

/** Reporting API (report-to) body field names. */
const REPORT_TO_KEYS: CspFieldKeys = { directive: ['effectiveDirective'], blockedUri: ['blockedURL'], documentUrl: ['documentURL'] }

const asRecord = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

const stringField = (record: Record<string, unknown>, names: string[]): string | undefined => {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Returns the first matching field name and its string value, or undefined. */
const stringFieldEntry = (record: Record<string, unknown>, names: string[]): { key: string; value: string } | undefined => {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.length > 0) return { key: name, value }
  }
  return undefined
}

/** Document URL redacted to origin + pathname — query string and fragment stripped. */
const redactDocumentUrl = (url: URL): string => `${url.origin}${url.pathname}`

/**
 * A structural deep copy of the report record with the document URL field
 * (found at `fields[urlKey]`, nested under `containerKey`) replaced by its
 * origin+pathname redaction. Works off a JSON clone so the original object is
 * untouched; falls back to leaving the value in place only if the shape is
 * unexpectedly not what the parser saw (it always is here).
 */
const redactVerbatimDocumentUrl = (verbatim: unknown, containerKey: string, urlKey: string, redactedUrl: string): unknown => {
  const clone: unknown = JSON.parse(JSON.stringify(verbatim))
  const container = asRecord(asRecord(clone)?.[containerKey])
  if (container) container[urlKey] = redactedUrl
  return clone
}

/**
 * Normalises one report record, or undefined when it is malformed: the
 * directive and a parseable document URL are required (every conforming UA
 * sends both; the document URL feeds the route and the Origin-absent
 * fallback), while a missing blocked URI is legitimate (inline violations)
 * and becomes the empty string. `containerKey` names where the fields object
 * sits inside `verbatim` (`csp-report` for legacy, `body` for report-to), so
 * the archived copy can be redacted at the right path.
 */
const toCspReportSource = (verbatim: unknown, fields: Record<string, unknown> | undefined, keys: CspFieldKeys, containerKey: string): CspReportSource | undefined => {
  if (!fields) return undefined
  const directive = stringField(fields, keys.directive)
  const documentUrlEntry = stringFieldEntry(fields, keys.documentUrl)
  if (!directive || !documentUrlEntry) return undefined
  try {
    const documentUrl = new URL(documentUrlEntry.value)
    return {
      // Archived with the document URL redacted to origin + pathname (PII).
      verbatim: redactVerbatimDocumentUrl(verbatim, containerKey, documentUrlEntry.key, redactDocumentUrl(documentUrl)),
      directive,
      blockedUri: stringField(fields, keys.blockedUri) ?? '',
      documentUrl,
    }
  } catch {
    return undefined
  }
}

/** undefined = the body matches neither delivery format (whole-body schema rejection). */
const extractCspReportSources = (parsed: unknown): { sources: CspReportSource[]; malformed: number } | undefined => {
  if (Array.isArray(parsed)) {
    const sources: CspReportSource[] = []
    let malformed = 0
    for (const element of parsed) {
      const record = asRecord(element)
      if (!record || record['type'] !== 'csp-violation') continue
      const source = toCspReportSource(element, asRecord(record['body']), REPORT_TO_KEYS, 'body')
      if (source) sources.push(source)
      else malformed++
    }
    return { sources, malformed }
  }
  const record = asRecord(parsed)
  const legacyBody = record ? asRecord(record['csp-report']) : undefined
  if (!legacyBody) return undefined
  const source = toCspReportSource(parsed, legacyBody, REPORT_URI_KEYS, 'csp-report')
  return source ? { sources: [source], malformed: 0 } : { sources: [], malformed: 1 }
}

/**
 * The synthetic observation: clamps enforce the beacon-schema field caps, the
 * route is the document URL's pathname only (query and fragment never enter —
 * the same privacy rule as agent-captured routes), and `ts` is receipt time
 * (browser report timestamps are not trusted).
 */
const toCspObservation = (source: CspReportSource, receivedAt: number): CspViolationObservation => ({
  kind: 'csp-violation',
  ts: receivedAt,
  route: source.documentUrl.pathname.slice(0, 512),
  directive: source.directive.slice(0, 128),
  blockedUri: source.blockedUri.slice(0, 2048),
})

const processCspReports = async (event: FunctionUrlEvent, config: CollectorConfig, deps: CollectorDeps, metrics: MetricsBatch): Promise<void> => {
  // Same pre-parse body cap as beacons: a transport limit on the raw bytes.
  const raw = decodeBody(event)
  if (new TextEncoder().encode(raw).byteLength > MAX_BEACON_BYTES) {
    metrics.count('rum_csp_reports_rejected', { Reason: 'size' })
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    metrics.count('rum_csp_reports_rejected', { Reason: 'json' })
    return
  }

  const extracted = extractCspReportSources(parsed)
  if (!extracted) {
    metrics.count('rum_csp_reports_rejected', { Reason: 'schema' })
    return
  }
  if (extracted.malformed > 0) metrics.count('rum_csp_reports_rejected', { Reason: 'schema' }, extracted.malformed)

  // Origin → target stamping first, exactly as for beacons — but some UAs
  // send CSP reports with no Origin header at all, so absence (and only
  // absence — a present-but-unmapped Origin still drops the request) falls
  // back to mapping the origin of each report's own document URL.
  const origin = headerValue(event, 'origin')
  const headerTarget = origin === undefined ? undefined : config.originTargets.find((candidate) => candidate.origin === origin)
  if (origin !== undefined && !headerTarget) {
    metrics.count('rum_unmapped_origin')
    return
  }

  const receivedAt = deps.now()
  const outcomes = await Promise.allSettled(
    extracted.sources.map(async (source) => {
      const target = headerTarget ?? config.originTargets.find((candidate) => candidate.origin === source.documentUrl.origin)
      if (!target) {
        metrics.count('rum_unmapped_origin')
        return
      }
      metrics.count('rum_csp_reports_accepted', { TargetId: target.target_id })

      // Same ordering and failure preference as beacons: archive verbatim
      // first (marked `cspReport` so the archive distinguishes sources), and
      // a Firehose failure aborts novelty processing for this report.
      await deps.firehose.putRecord({
        streamName: config.firehoseStream,
        data: `${JSON.stringify({ stamp: { target_id: target.target_id, target_type: target.target_type, received_at: receivedAt }, cspReport: source.verbatim })}\n`,
      })
      await processObservation(toCspObservation(source, receivedAt), CSP_REPORT_SESSION_ID, target, receivedAt, config, deps, metrics)
    }),
  )
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      console.error('collector: csp report processing failed', outcome.reason)
    }
  }
}

const processEvent = async (event: FunctionUrlEvent, config: CollectorConfig, deps: CollectorDeps, metrics: MetricsBatch): Promise<void> => {
  // 1. Edge auth, before the body is touched (collector-ingest.md): in
  // shared_secret mode the Cloudflare Transform Rule injects the key header;
  // in aws_iam mode unsigned requests never reach the handler.
  if (config.edgeAuthMode === 'shared_secret') {
    // A missing/empty configured secret must reject, never compare: an empty
    // expected value would make a request with an empty (or absent) key
    // header authenticate — fail-open under misconfiguration.
    if (!config.edgeSharedSecret || !secretMatches(headerValue(event, EDGE_KEY_HEADER), config.edgeSharedSecret)) {
      metrics.count('rum_edge_auth_failure')
      return
    }
  }

  // Path routing after auth: /csp-reports carries browser-native CSP
  // reports; every other path (the Function URL default '/') is a beacon.
  if (event.rawPath === CSP_REPORTS_PATH) {
    await processCspReports(event, config, deps, metrics)
    return
  }

  // 2. Origin → target stamping: exact match, sole authority on identity.
  const origin = headerValue(event, 'origin')
  const target = config.originTargets.find((candidate) => candidate.origin === origin)
  if (!target) {
    metrics.count('rum_unmapped_origin')
    return
  }

  // 3. Strict parse (shared size/JSON/schema semantics from src/types/beacon.ts).
  const parsed = parseBeacon(decodeBody(event))
  if (!parsed.ok) {
    metrics.count('rum_beacons_rejected', { Reason: parsed.reason })
    return
  }
  const beacon = parsed.beacon
  const receivedAt = deps.now()

  // Accepted = validated and stamped. Counted before archival so the
  // per-target volume signal (anomaly alarms hang off it) reflects real
  // intake and is not confounded by a Firehose outage.
  metrics.count('rum_beacons_accepted', { TargetId: target.target_id })

  // 4. Archive the verbatim beacon plus the stamp envelope as a JSON line.
  // A Firehose failure aborts novelty processing for this beacon: the
  // contract prefers losing one beacon (client resend / statistical
  // coverage) over enqueueing observations that were never archived.
  await deps.firehose.putRecord({
    streamName: config.firehoseStream,
    data: `${JSON.stringify({ stamp: { target_id: target.target_id, target_type: target.target_type, received_at: receivedAt }, beacon })}\n`,
  })

  // 5. Novelty write + first-sighting enqueue per observation. One failing
  // observation must not starve its siblings, so failures are collected and
  // logged rather than short-circuiting the loop.
  const outcomes = await Promise.allSettled(beacon.observations.map((observation) => processObservation(observation, beacon.session.id, target, receivedAt, config, deps, metrics)))
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      console.error('collector: observation processing failed', outcome.reason)
    }
  }
}

export const createHandler = (config: CollectorConfig, deps: CollectorDeps) => {
  return async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
    const metrics = new MetricsBatch()
    try {
      await processEvent(event, config, deps, metrics)
    } catch (error) {
      // Internal failures (Firehose, DynamoDB, SQS, bugs) are logged and
      // swallowed: the 204 no-oracle contract holds on every path.
      console.error('collector: ingest failed', error)
    } finally {
      const data = metrics.drain()
      if (data.length > 0) {
        try {
          await deps.metrics.publish({ namespace: config.metricNamespace, data })
        } catch (error) {
          console.error('collector: metrics publish failed', error)
        }
      }
    }
    return NO_CONTENT
  }
}

/**
 * Real AWS SDK v3 wiring. Clients are created lazily on first invocation so
 * unit tests importing this module never touch the SDK. The dynamic imports
 * are about that test-time laziness, not about where the SDK comes from —
 * the deployed bundle carries the SDK inside it (see module docstring).
 */
const createAwsDeps = async (): Promise<CollectorDeps> => {
  const [{ FirehoseClient, PutRecordCommand }, { DynamoDBClient, PutItemCommand, UpdateItemCommand, DeleteItemCommand }, { SQSClient, SendMessageCommand }, { CloudWatchClient, PutMetricDataCommand }] = await Promise.all([
    import('@aws-sdk/client-firehose'),
    import('@aws-sdk/client-dynamodb'),
    import('@aws-sdk/client-sqs'),
    import('@aws-sdk/client-cloudwatch'),
  ])

  const firehose = new FirehoseClient({})
  const dynamo = new DynamoDBClient({})
  const sqs = new SQSClient({})
  const cloudwatch = new CloudWatchClient({})

  return {
    firehose: {
      putRecord: ({ streamName, data }) => firehose.send(new PutRecordCommand({ DeliveryStreamName: streamName, Record: { Data: Buffer.from(data, 'utf8') } })),
    },
    dynamo: {
      putItemIfAbsent: ({ table, item }) =>
        dynamo.send(
          new PutItemCommand({
            TableName: table,
            Item: {
              pk: { S: item.pk },
              first_seen: { N: String(item.first_seen) },
              last_seen: { N: String(item.last_seen) },
              sessions: { N: String(item.sessions) },
              first_route: { S: item.first_route },
              target_type: { S: item.target_type },
              ttl: { N: String(item.ttl) },
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        ),
      updateCounters: ({ table, pk, lastSeen }) =>
        dynamo.send(
          new UpdateItemCommand({
            TableName: table,
            Key: { pk: { S: pk } },
            UpdateExpression: 'SET last_seen = :last_seen ADD sessions :one',
            ExpressionAttributeValues: { ':last_seen': { N: String(lastSeen) }, ':one': { N: '1' } },
          }),
        ),
      deleteItem: ({ table, pk }) => dynamo.send(new DeleteItemCommand({ TableName: table, Key: { pk: { S: pk } } })),
    },
    sqs: {
      sendMessage: ({ queueUrl, body, attributes }) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: body,
            MessageAttributes: Object.fromEntries(Object.entries(attributes).map(([name, value]) => [name, { DataType: 'String', StringValue: value }])),
          }),
        ),
    },
    metrics: {
      publish: ({ namespace, data }) =>
        cloudwatch.send(
          new PutMetricDataCommand({
            Namespace: namespace,
            MetricData: data.map((datum) => ({
              MetricName: datum.name,
              Value: datum.value,
              Unit: datum.unit,
              Dimensions: Object.entries(datum.dimensions).map(([Name, Value]) => ({ Name, Value })),
            })),
          }),
        ),
    },
    now: () => Date.now(),
  }
}

let realHandler: ((event: FunctionUrlEvent) => Promise<FunctionUrlResult>) | undefined

/** Lambda entry point (`ingest.handler` in infra/collector-core/lambda.tf). */
export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  realHandler ??= createHandler(loadConfigFromEnv(process.env), await createAwsDeps())
  return realHandler(event)
}

export default handler
