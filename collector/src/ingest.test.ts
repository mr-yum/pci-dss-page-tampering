import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import type { Beacon } from '../../src/types/beacon.js'
import { CspViolationObservationSchema } from '../../src/types/beacon.js'
import type { CollectorConfig, CollectorDeps, FunctionUrlEvent, FunctionUrlResult, MetricDatum } from './ingest.js'
import { createHandler, EMF_MAX_ARRAY_MEMBERS, emfPublisher, emfRecords, loadConfigFromEnv, resetAttributedAgentVersionsForTesting, stdoutLine } from './ingest.js'
import { buildNoveltyKey } from './novelty.js'

const FIXTURES = join(__dirname, '../../test/fixtures/beacons')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const NOW = 1755600000500
const STAGING_ORIGIN = 'https://staging.pay.example.com'
const PROD_ORIGIN = 'https://pay.example.com'

const makeConfig = (overrides: Partial<CollectorConfig> = {}): CollectorConfig => ({
  originTargets: [
    { origin: STAGING_ORIGIN, target_id: '1.0', target_type: 'inventory' },
    { origin: PROD_ORIGIN, target_id: '1.0', target_type: 'detection' },
  ],
  edgeAuthMode: 'aws_iam',
  firehoseStream: 'archive-stream',
  noveltyTable: 'novelty-table',
  queueUrl: 'https://sqs.example/queue',
  noveltyTtlDays: 90,
  metricNamespace: 'Collector/RUM',
  ...overrides,
})

interface MockDeps extends CollectorDeps {
  firehose: { putRecord: jest.Mock }
  dynamo: { putItemIfAbsent: jest.Mock; updateCounters: jest.Mock; deleteItem: jest.Mock }
  sqs: { sendMessage: jest.Mock }
  metrics: { publish: jest.Mock }
}

const makeDeps = (): MockDeps => ({
  firehose: { putRecord: jest.fn().mockResolvedValue(undefined) },
  dynamo: { putItemIfAbsent: jest.fn().mockResolvedValue(undefined), updateCounters: jest.fn().mockResolvedValue(undefined), deleteItem: jest.fn().mockResolvedValue(undefined) },
  sqs: { sendMessage: jest.fn().mockResolvedValue(undefined) },
  metrics: { publish: jest.fn().mockResolvedValue(undefined) },
  now: () => NOW,
})

const makeEvent = (body: string | undefined, headers: Record<string, string> = { Origin: PROD_ORIGIN }, isBase64Encoded = false): FunctionUrlEvent => ({ headers, ...(body === undefined ? {} : { body }), isBase64Encoded })

const publishedMetrics = (deps: MockDeps): MetricDatum[] => deps.metrics.publish.mock.calls.flatMap(([input]: [{ data: MetricDatum[] }]) => input.data)
const metricNames = (deps: MockDeps): string[] => publishedMetrics(deps).map((datum) => datum.name)

/** Every outcome must be indistinguishable on the wire: 204, empty body. */
const expectNoContent = (result: FunctionUrlResult): void => {
  expect(result.statusCode).toBe(204)
  expect(result.body).toBe('')
}

const conditionalCheckFailed = (): Error => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })

describe('createHandler', () => {
  // The attributed-version set is container-lifetime state; reset it so no
  // test depends on which earlier test established a version.
  beforeEach(() => resetAttributedAgentVersionsForTesting())

  it('stamps a staging-origin beacon as the inventory pass', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'), { origin: STAGING_ORIGIN }))

    expectNoContent(result)
    const record = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    expect(record.stamp).toEqual({ target_id: '1.0', target_type: 'inventory', received_at: NOW })
    expect(record.beacon).toEqual(JSON.parse(fixture('external-unknown.json')))
  })

  it('archives and enqueues an initiator chain verbatim, and keeps it out of the novelty key', async () => {
    const deps = makeDeps()
    const beacon = JSON.parse(fixture('canonical.json')) as Beacon
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('canonical.json')))

    expectNoContent(result)
    expect(JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data).beacon).toEqual(beacon)
    const external = beacon.observations[0]!
    const queued = deps.sqs.sendMessage.mock.calls.map((call: [{ body: string }]) => JSON.parse(call[0].body)).find((message: { observation: { kind: string } }) => message.observation.kind === 'external-script')
    expect(queued.observation).toEqual(external)
    // The key is still target#identity#IMMEDIATE initiator host: a different
    // grandparent is not a new sighting.
    expect(queued.novelty.pk).toBe('1.0#https://cdn.example.net/sdk.js#pay.example.com')
  })

  it('rejects a beacon whose chain breaks the schema caps without storing anything', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('invalid/chain-too-long.json')))

    expectNoContent(result)
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
  })

  it('stamps a production-origin beacon as the detection pass', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'), { Origin: PROD_ORIGIN }))

    expectNoContent(result)
    const record = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    expect(record.stamp.target_type).toBe('detection')
    expect(metricNames(deps)).toContain('rum_beacons_accepted')
    // Version-cohort observability rides a SEPARATE metric name: an extra
    // dimension on rum_beacons_accepted would change that series' identity
    // and silently detach the per-target volume anomaly alarms.
    expect(publishedMetrics(deps)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'rum_beacons_accepted_by_version', dimensions: { TargetId: '1.0', AgentVersion: '1.0.0' } })]))
  })

  it('redacts page.url query string and fragment before archival (PII must not enter the 1-year archive)', async () => {
    const deps = makeDeps()
    const beacon = JSON.parse(fixture('external-unknown.json')) as Beacon
    beacon.page.url = 'https://pay.example.com/checkout?token=secret-abc&order=42#step-3'
    const result = await createHandler(makeConfig(), deps)(makeEvent(JSON.stringify(beacon)))

    expectNoContent(result)
    const serialised = deps.firehose.putRecord.mock.calls[0][0].data as string
    // Neither the token nor the fragment survives anywhere in the archived line.
    expect(serialised).not.toContain('secret-abc')
    expect(serialised).not.toContain('step-3')
    const record = JSON.parse(serialised)
    expect(record.beacon.page.url).toBe('https://pay.example.com/checkout')
    // Pipeline behaviour is otherwise unchanged: observations still flow.
    expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledTimes(1)
    expect(deps.sqs.sendMessage).toHaveBeenCalledTimes(1)
    const queued = JSON.parse(deps.sqs.sendMessage.mock.calls[0][0].body)
    expect(JSON.stringify(queued)).not.toContain('secret-abc')
  })

  it('drops and counts an unmapped origin without storing anything', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('canonical.json'), { Origin: 'https://unmapped.example.net' }))

    expectNoContent(result)
    expect(metricNames(deps)).toEqual(['rum_unmapped_origin'])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
    expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
  })

  describe('shared_secret edge auth', () => {
    const config = makeConfig({ edgeAuthMode: 'shared_secret', edgeSharedSecret: 'edge-secret' })

    it('accepts the correct key, case-insensitively on the header name', async () => {
      const deps = makeDeps()
      const result = await createHandler(config, deps)(makeEvent(fixture('external-unknown.json'), { Origin: PROD_ORIGIN, 'X-Collector-Edge-Key': 'edge-secret' }))

      expectNoContent(result)
      expect(deps.firehose.putRecord).toHaveBeenCalledTimes(1)
      expect(metricNames(deps)).not.toContain('rum_edge_auth_failure')
    })

    it.each<[string, Record<string, string>]>([
      ['wrong key', { Origin: PROD_ORIGIN, 'x-collector-edge-key': 'not-the-secret' }],
      ['missing key', { Origin: PROD_ORIGIN }],
    ])('rejects a request with %s before touching the body', async (_label, headers) => {
      const deps = makeDeps()
      const result = await createHandler(config, deps)(makeEvent(fixture('external-unknown.json'), headers))

      expectNoContent(result)
      // Auth failure short-circuits: no origin lookup outcome, no parse
      // outcome, no storage — only the auth-failure count.
      expect(metricNames(deps)).toEqual(['rum_edge_auth_failure'])
      expect(deps.firehose.putRecord).not.toHaveBeenCalled()
      expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
      expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
    })

    it.each<[string, string | undefined]>([
      ['undefined', undefined],
      ['empty', ''],
    ])('rejects every request when the configured secret is %s — misconfiguration must fail closed, even for an empty provided key', async (_label, edgeSharedSecret) => {
      const misconfigured = makeConfig({ edgeAuthMode: 'shared_secret', ...(edgeSharedSecret === undefined ? {} : { edgeSharedSecret }) })
      const deps = makeDeps()
      // The nastiest probe: an empty key header, which would timing-safe-equal
      // an empty expected secret if the guard compared instead of rejecting.
      const result = await createHandler(misconfigured, deps)(makeEvent(fixture('external-unknown.json'), { Origin: PROD_ORIGIN, 'x-collector-edge-key': '' }))

      expectNoContent(result)
      expect(metricNames(deps)).toEqual(['rum_edge_auth_failure'])
      expect(deps.firehose.putRecord).not.toHaveBeenCalled()
      expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('beacon rejection', () => {
    it('counts a schema-invalid beacon with its reason, attributing the claimed version only once accepted traffic has established it', async () => {
      const deps = makeDeps()
      const handler = createHandler(makeConfig(), deps)
      // Establish 1.0.0 via an accepted beacon: attribution is EARNED by
      // accepted traffic — a rejected body never allocates a version slot.
      await handler(makeEvent(fixture('external-unknown.json')))
      const result = await handler(makeEvent(fixture('invalid/unknown-key.json')))

      expectNoContent(result)
      expect(publishedMetrics(deps)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: 'schema', AgentVersion: '1.0.0' } })]))
      expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledTimes(1) // only the accepted beacon
    })

    it('never lets rejected bodies allocate version slots: eight garbage claims then a real candidate — the candidate still attributes', async () => {
      // CodeRabbit regression case: on a fresh container, eight
      // schema-invalid bodies with distinct valid-shaped versions must NOT
      // consume the attribution budget ahead of legitimate traffic.
      const deps = makeDeps()
      const handler = createHandler(makeConfig(), deps)
      for (let i = 0; i < 8; i++) {
        const garbage = JSON.parse(fixture('invalid/unknown-key.json'))
        garbage.session.agentVersion = `66.6.${i}`
        await handler(makeEvent(JSON.stringify(garbage)))
      }
      // Unestablished claims read as "other" (a version with zero accepted
      // beacons is a claim, not a release)...
      const rejects = publishedMetrics(deps).filter((d) => d.name === 'rum_beacons_rejected')
      expect(rejects).toHaveLength(8)
      for (const datum of rejects) expect(datum.dimensions['AgentVersion']).toBe('other')

      // ...and the real candidate arriving afterwards attributes normally.
      const candidate = JSON.parse(fixture('external-unknown.json'))
      candidate.session.agentVersion = '2.0.0'
      await handler(makeEvent(JSON.stringify(candidate)))
      expect(publishedMetrics(deps)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'rum_beacons_accepted_by_version', dimensions: { TargetId: '1.0', AgentVersion: '2.0.0' } })]))
    })

    it.each([
      ['size', 'x'.repeat(40000)],
      ['json', '{not json'],
    ])('counts a %s rejection with version unknown (nothing parseable to attribute)', async (reason, body) => {
      const deps = makeDeps()
      expectNoContent(await createHandler(makeConfig(), deps)(makeEvent(body)))
      expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: reason, AgentVersion: 'unknown' } })])
      expect(deps.firehose.putRecord).not.toHaveBeenCalled()
    })

    it('collapses a non-semver claimed version to "unknown" (metric-dimension cardinality guard)', async () => {
      const deps = makeDeps()
      const beacon = JSON.parse(fixture('invalid/unknown-key.json'))
      beacon.session.agentVersion = '<script>alert(1)</script>'
      expectNoContent(await createHandler(makeConfig(), deps)(makeEvent(JSON.stringify(beacon))))
      expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: 'schema', AgentVersion: 'unknown' } })])
    })

    it('bounds the ATTRIBUTED version value space: semver-shaped spray collapses to "other" past the per-container cap, while known versions keep attributing', async () => {
      // Format alone is not a bound — every distinct valid-shaped semver
      // would mint its own CloudWatch series across three metrics. The
      // first-seen set caps distinct attributed versions per container.
      resetAttributedAgentVersionsForTesting()
      const deps = makeDeps()
      const handler = createHandler(makeConfig(), deps)
      const withVersion = (version: string) => {
        const beacon = JSON.parse(fixture('external-unknown.json'))
        beacon.session.agentVersion = version
        return JSON.stringify(beacon)
      }

      // Fill the cap with distinct valid versions (all accepted beacons).
      for (let i = 0; i < 8; i++) await handler(makeEvent(withVersion(`1.0.${i}`)))
      // The 9th distinct version exceeds the budget → "other".
      await handler(makeEvent(withVersion('9.9.9')))
      // A version already in the set still attributes normally.
      await handler(makeEvent(withVersion('1.0.0')))

      const byVersion = publishedMetrics(deps).filter((datum) => datum.name === 'rum_beacons_accepted_by_version')
      expect(byVersion.at(-2)?.dimensions).toEqual({ TargetId: '1.0', AgentVersion: 'other' })
      expect(byVersion.at(-1)?.dimensions).toEqual({ TargetId: '1.0', AgentVersion: '1.0.0' })
      resetAttributedAgentVersionsForTesting()
    })
  })

  it('enqueues a first sighting with the exact queue-message.md body and attributes', async () => {
    const deps = makeDeps()
    const beacon = JSON.parse(fixture('external-unknown.json')) as Beacon
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json')))

    expectNoContent(result)
    const expectedPk = '1.0#https://evil.example/skimmer.js#pay.example.com'
    expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledWith({
      table: 'novelty-table',
      item: {
        pk: expectedPk,
        first_seen: NOW,
        last_seen: NOW,
        sessions: 1,
        first_route: '/checkout',
        target_type: 'detection',
        ttl: Math.floor(NOW / 1000) + 90 * 86400,
      },
    })
    expect(deps.sqs.sendMessage).toHaveBeenCalledTimes(1)
    const { queueUrl, body, attributes } = deps.sqs.sendMessage.mock.calls[0][0]
    expect(queueUrl).toBe('https://sqs.example/queue')
    expect(attributes).toEqual({ target_type: 'detection', kind: 'external-script' })
    expect(JSON.parse(body)).toEqual({
      v: 1,
      target_id: '1.0',
      target_type: 'detection',
      observation: beacon.observations[0],
      novelty: { pk: expectedPk, first_seen: NOW, first_route: '/checkout' },
      received_at: NOW,
      session_id: beacon.session.id,
    })
    expect(metricNames(deps)).toEqual(expect.arrayContaining(['rum_first_sightings', 'rum_beacons_accepted']))
  })

  it('updates counters without enqueueing on a repeat sighting', async () => {
    const deps = makeDeps()
    deps.dynamo.putItemIfAbsent.mockRejectedValue(conditionalCheckFailed())
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json')))

    expectNoContent(result)
    expect(deps.dynamo.updateCounters).toHaveBeenCalledWith({ table: 'novelty-table', pk: '1.0#https://evil.example/skimmer.js#pay.example.com', lastSeen: NOW })
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
    expect(metricNames(deps)).toContain('rum_observations_counted')
    expect(metricNames(deps)).not.toContain('rum_first_sightings')
  })

  it('compensates a first-sighting novelty write when the SQS enqueue fails, so a later delivery re-enqueues', async () => {
    const deps = makeDeps()
    deps.sqs.sendMessage.mockRejectedValueOnce(new Error('sqs down'))
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // First delivery: put succeeds, enqueue throws → the novelty item is
      // deleted (compensation) so the pk does not block re-enqueue for the TTL.
      expectNoContent(await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'))))
      const pk = '1.0#https://evil.example/skimmer.js#pay.example.com'
      expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledTimes(1)
      expect(deps.dynamo.deleteItem).toHaveBeenCalledWith({ table: 'novelty-table', pk })

      // A subsequent identical request re-triggers the first-sighting path and
      // enqueues (the compensating delete cleared the blocking record).
      const second = makeDeps()
      expectNoContent(await createHandler(makeConfig(), second)(makeEvent(fixture('external-unknown.json'))))
      expect(second.dynamo.putItemIfAbsent).toHaveBeenCalledTimes(1)
      expect(second.dynamo.deleteItem).not.toHaveBeenCalled()
      expect(second.sqs.sendMessage).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('emits metrics for agent-health observations but never keys or enqueues them', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('canonical.json')))

    expectNoContent(result)
    // canonical.json: external + inline + csp-violation + agent-health.
    expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledTimes(3)
    expect(deps.sqs.sendMessage).toHaveBeenCalledTimes(3)
    const kinds = deps.sqs.sendMessage.mock.calls.map(([input]: [{ attributes: { kind: string } }]) => input.attributes.kind)
    expect(kinds).not.toContain('agent-health')
    expect(publishedMetrics(deps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'rum_agent_p95_task_ms', value: 2, dimensions: { TargetId: '1.0', AgentVersion: '1.0.0' } }),
        expect.objectContaining({ name: 'rum_agent_dropped', value: 0, dimensions: { TargetId: '1.0', AgentVersion: '1.0.0' } }),
      ]),
    )
  })

  it('decodes a base64-encoded Function URL body', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(Buffer.from(fixture('inline-valid.json'), 'utf8').toString('base64'), { Origin: PROD_ORIGIN }, true))

    expectNoContent(result)
    expect(deps.firehose.putRecord).toHaveBeenCalledTimes(1)
    expect(metricNames(deps)).toContain('rum_beacons_accepted')
  })

  describe('204 invariance under downstream failure', () => {
    it('returns 204 and skips novelty processing when Firehose fails', async () => {
      const deps = makeDeps()
      deps.firehose.putRecord.mockRejectedValue(new Error('firehose down'))
      const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json')))

      expectNoContent(result)
      expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
      expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
      // The beacon was validated intake even though archival failed.
      expect(metricNames(deps)).toContain('rum_beacons_accepted')
    })

    it.each<[string, (deps: MockDeps) => void]>([
      ['DynamoDB', (deps) => deps.dynamo.putItemIfAbsent.mockRejectedValue(new Error('dynamo down'))],
      ['SQS', (deps) => deps.sqs.sendMessage.mockRejectedValue(new Error('sqs down'))],
      ['CloudWatch', (deps) => deps.metrics.publish.mockRejectedValue(new Error('cloudwatch down'))],
    ])('returns 204 when %s fails', async (_name, arm) => {
      const deps = makeDeps()
      arm(deps)
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        expectNoContent(await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'))))
      } finally {
        consoleError.mockRestore()
      }
    })

    it('returns 204 for an empty body and for absent headers', async () => {
      const deps = makeDeps()
      const handler = createHandler(makeConfig(), deps)
      expectNoContent(await handler(makeEvent(undefined)))
      expectNoContent(await handler({}))
    })
  })

  it('routes the canary fixture through its dedicated canary target', async () => {
    const canaryOrigin = 'https://canary.example.test'
    const config = makeConfig({ originTargets: [...makeConfig().originTargets, { origin: canaryOrigin, target_id: 'canary', target_type: 'detection' }] })
    const deps = makeDeps()

    expectNoContent(await createHandler(config, deps)(makeEvent(fixture('canary.json'), { Origin: canaryOrigin })))
    // The deliberately uninventoried marker URL is keyed under the canary
    // target id — never a payment-page target — so its expected alert routes
    // to the ops channel via the canary target's alerts config.
    expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ pk: 'canary#https://canary-marker.example.test/rum-canary.js#canary.example.test' }) }))
    expect(JSON.parse(deps.sqs.sendMessage.mock.calls[0][0].body)).toMatchObject({ target_id: 'canary', target_type: 'detection' })
  })
})

describe('CSP report ingestion (/csp-reports)', () => {
  const cspEvent = (body: string, headers: Record<string, string> = { Origin: PROD_ORIGIN }): FunctionUrlEvent => ({ rawPath: '/csp-reports', headers, body, isBase64Encoded: false })

  const LEGACY_REPORT = {
    'csp-report': {
      'document-uri': 'https://pay.example.com/checkout?session=abc123#step-2',
      'effective-directive': 'script-src',
      'violated-directive': 'script-src',
      'blocked-uri': 'https://evil.example/skimmer.js',
      'original-policy': "script-src 'self'",
    },
  }

  const REPORT_TO_VIOLATION = {
    type: 'csp-violation',
    age: 12,
    url: 'https://pay.example.com/checkout',
    body: {
      documentURL: 'https://pay.example.com/checkout?session=abc123',
      effectiveDirective: 'script-src',
      blockedURL: 'https://evil.example/skimmer.js',
      disposition: 'enforce',
    },
  }

  const EXPECTED_OBSERVATION = { kind: 'csp-violation', ts: NOW, route: '/checkout', directive: 'script-src', blockedUri: 'https://evil.example/skimmer.js' } as const

  /** Structural mirror of queue-message.md (importing src/rum/drain.ts here is off-limits). */
  const CspQueueMessageSchema = z.strictObject({
    v: z.literal(1),
    target_id: z.string().min(1),
    target_type: z.enum(['inventory', 'detection']),
    observation: CspViolationObservationSchema,
    novelty: z.strictObject({ pk: z.string().min(1), first_seen: z.number().int().positive(), first_route: z.string() }),
    received_at: z.number().int().positive(),
    session_id: z.string().min(1),
  })

  it('ingests a legacy report-uri report through the full beacon pipeline', async () => {
    const deps = makeDeps()
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(LEGACY_REPORT))))

    // Archive: report in a marked envelope, distinguishable from beacons, with
    // the document URL redacted to origin+pathname (query/fragment stripped).
    const record = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    expect(record.stamp).toEqual({ target_id: '1.0', target_type: 'detection', received_at: NOW })
    expect(record.cspReport).toEqual({ 'csp-report': { ...LEGACY_REPORT['csp-report'], 'document-uri': 'https://pay.example.com/checkout' } })
    expect(record.beacon).toBeUndefined()

    // Novelty pk must use novelty.ts's csp identity format exactly.
    const expectedPk = buildNoveltyKey('1.0', { ...EXPECTED_OBSERVATION, kind: 'csp-violation' })
    expect(expectedPk).toBe('1.0#csp:script-src:https://evil.example/skimmer.js#-')
    expect(deps.dynamo.putItemIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ table: 'novelty-table', item: expect.objectContaining({ pk: expectedPk, first_route: '/checkout', target_type: 'detection' }) }))

    // Enqueued message: valid against the queue-message shape, route stripped
    // of query and fragment, sentinel session id.
    const { body, attributes } = deps.sqs.sendMessage.mock.calls[0][0]
    expect(attributes).toEqual({ target_type: 'detection', kind: 'csp-violation' })
    const message = CspQueueMessageSchema.parse(JSON.parse(body))
    expect(message.observation).toEqual(EXPECTED_OBSERVATION)
    expect(message.session_id).toBe('csp-report')
    expect(message.novelty).toEqual({ pk: expectedPk, first_seen: NOW, first_route: '/checkout' })

    expect(publishedMetrics(deps)).toContainEqual(expect.objectContaining({ name: 'rum_csp_reports_accepted', dimensions: { TargetId: '1.0' } }))
    expect(metricNames(deps)).toContain('rum_first_sightings')
    expect(metricNames(deps)).not.toContain('rum_csp_reports_rejected')
  })

  it('strips the query string and fragment from the archived document URL (PII must not enter the 1-year archive)', async () => {
    const deps = makeDeps()
    const report = { 'csp-report': { ...LEGACY_REPORT['csp-report'], 'document-uri': 'https://pay.example.com/checkout?token=secret-value&order=42#step-3' } }
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(report))))

    const archived = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    const documentUri = archived.cspReport['csp-report']['document-uri']
    expect(documentUri).toBe('https://pay.example.com/checkout')
    // The whole serialised record must carry none of the PII.
    const serialised = deps.firehose.putRecord.mock.calls[0][0].data
    expect(serialised).not.toContain('secret-value')
    expect(serialised).not.toContain('token=')
    expect(serialised).not.toContain('#step-3')
  })

  it('ingests a report-to batch, skipping records of other report types without rejection', async () => {
    const deps = makeDeps()
    const batch = [{ type: 'deprecation', age: 3, url: 'https://pay.example.com/checkout', body: { id: 'websql' } }, REPORT_TO_VIOLATION]
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(batch))))

    expect(deps.firehose.putRecord).toHaveBeenCalledTimes(1)
    // documentURL is redacted to origin+pathname; every other field is preserved.
    expect(JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data).cspReport).toEqual({ ...REPORT_TO_VIOLATION, body: { ...REPORT_TO_VIOLATION.body, documentURL: 'https://pay.example.com/checkout' } })
    const message = CspQueueMessageSchema.parse(JSON.parse(deps.sqs.sendMessage.mock.calls[0][0].body))
    expect(message.observation).toEqual(EXPECTED_OBSERVATION)
    expect(metricNames(deps)).not.toContain('rum_csp_reports_rejected')
  })

  it('falls back to the document URL origin when the Origin header is absent', async () => {
    const deps = makeDeps()
    const report = { 'csp-report': { ...LEGACY_REPORT['csp-report'], 'document-uri': `${STAGING_ORIGIN}/checkout?x=1` } }
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(report), {})))

    expect(JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data).stamp.target_type).toBe('inventory')
    expect(publishedMetrics(deps)).toContainEqual(expect.objectContaining({ name: 'rum_csp_reports_accepted', dimensions: { TargetId: '1.0' } }))
  })

  it('drops and counts as unmapped when neither Origin nor document URL maps', async () => {
    const deps = makeDeps()
    const report = { 'csp-report': { ...LEGACY_REPORT['csp-report'], 'document-uri': 'https://unmapped.example.net/checkout' } }
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(report), {})))

    expect(metricNames(deps)).toEqual(['rum_unmapped_origin'])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
    expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
  })

  it('drops the whole request when a present Origin header is unmapped, ignoring the document URL', async () => {
    const deps = makeDeps()
    // The document URL maps — but a present Origin header is the sole authority.
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(LEGACY_REPORT), { Origin: 'https://unmapped.example.net' })))

    expect(metricNames(deps)).toEqual(['rum_unmapped_origin'])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
  })

  it.each<[string, string, string]>([
    ['size', 'x'.repeat(40000), 'size'],
    ['json', '{not json', 'json'],
    ['unrecognised shape', JSON.stringify({ weird: true }), 'schema'],
    ['csp record missing its directive', JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://pay.example.com/checkout' } }]), 'schema'],
  ])('rejects a body with %s and stores nothing', async (_label, body, reason) => {
    const deps = makeDeps()
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(body)))

    expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_csp_reports_rejected', dimensions: { Reason: reason } })])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
    expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
  })

  it('updates counters without enqueueing on a repeat sighting', async () => {
    const deps = makeDeps()
    deps.dynamo.putItemIfAbsent.mockRejectedValue(conditionalCheckFailed())
    expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(LEGACY_REPORT))))

    expect(deps.dynamo.updateCounters).toHaveBeenCalledWith({ table: 'novelty-table', pk: '1.0#csp:script-src:https://evil.example/skimmer.js#-', lastSeen: NOW })
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
    expect(metricNames(deps)).toContain('rum_observations_counted')
  })

  it('applies the same edge auth before touching the body', async () => {
    const deps = makeDeps()
    const config = makeConfig({ edgeAuthMode: 'shared_secret', edgeSharedSecret: 'edge-secret' })
    expectNoContent(await createHandler(config, deps)(cspEvent(JSON.stringify(LEGACY_REPORT))))

    expect(metricNames(deps)).toEqual(['rum_edge_auth_failure'])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
  })

  it('returns 204 and skips novelty processing when Firehose fails', async () => {
    const deps = makeDeps()
    deps.firehose.putRecord.mockRejectedValue(new Error('firehose down'))
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expectNoContent(await createHandler(makeConfig(), deps)(cspEvent(JSON.stringify(LEGACY_REPORT))))
    } finally {
      consoleError.mockRestore()
    }
    expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
    expect(deps.sqs.sendMessage).not.toHaveBeenCalled()
  })

  it('leaves the default path treating a CSP report body as an invalid beacon', async () => {
    const deps = makeDeps()
    expectNoContent(await createHandler(makeConfig(), deps)({ rawPath: '/', headers: { Origin: PROD_ORIGIN }, body: JSON.stringify(LEGACY_REPORT), isBase64Encoded: false }))

    expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: 'schema', AgentVersion: 'unknown' } })])
    expect(deps.firehose.putRecord).not.toHaveBeenCalled()
  })
})

describe('loadConfigFromEnv', () => {
  const baseEnv = {
    ORIGIN_TARGETS: JSON.stringify([{ origin: PROD_ORIGIN, target_id: '1.0', target_type: 'detection' }]),
    EDGE_AUTH_MODE: 'aws_iam',
    FIREHOSE_STREAM: 'archive',
    NOVELTY_TABLE: 'novelty',
    QUEUE_URL: 'https://sqs.example/q',
    NOVELTY_TTL_DAYS: '90',
    METRIC_NAMESPACE: 'Collector/RUM',
  }

  it('parses the lambda.tf environment contract', () => {
    expect(loadConfigFromEnv(baseEnv)).toEqual({
      originTargets: [{ origin: PROD_ORIGIN, target_id: '1.0', target_type: 'detection' }],
      edgeAuthMode: 'aws_iam',
      firehoseStream: 'archive',
      noveltyTable: 'novelty',
      queueUrl: 'https://sqs.example/q',
      noveltyTtlDays: 90,
      metricNamespace: 'Collector/RUM',
    })
  })

  it('requires EDGE_SHARED_SECRET in shared_secret mode', () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, EDGE_AUTH_MODE: 'shared_secret' })).toThrow('EDGE_SHARED_SECRET')
    expect(loadConfigFromEnv({ ...baseEnv, EDGE_AUTH_MODE: 'shared_secret', EDGE_SHARED_SECRET: 's' }).edgeSharedSecret).toBe('s')
  })

  it('rejects an unknown EDGE_AUTH_MODE', () => {
    expect(() => loadConfigFromEnv({ ...baseEnv, EDGE_AUTH_MODE: 'none' })).toThrow('EDGE_AUTH_MODE')
  })

  it.each(['not-a-number', '0', '-7', 'NaN'])('rejects NOVELTY_TTL_DAYS=%s at config load (NaN/non-positive)', (value) => {
    expect(() => loadConfigFromEnv({ ...baseEnv, NOVELTY_TTL_DAYS: value })).toThrow('NOVELTY_TTL_DAYS')
  })
})

describe('metrics emission — CloudWatch Embedded Metric Format (emfRecords / emfPublisher)', () => {
  const ts = 1755600000000
  const data: MetricDatum[] = [
    { name: 'rum_beacons_accepted', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } },
    { name: 'rum_first_sightings', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } },
    { name: 'rum_observations_counted', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } },
    { name: 'rum_observations_counted', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } },
    { name: 'rum_agent_p95_task_ms', value: 2, unit: 'Milliseconds', dimensions: { AgentVersion: '1.0.0', TargetId: '1.0' } },
    { name: 'rum_unmapped_origin', value: 1, unit: 'Count', dimensions: {} },
  ]

  it('emits one record per distinct dimension-value set, declaring the keys once and carrying every metric under them', () => {
    const records = emfRecords('rum/rum', data, ts)
    expect(records).toHaveLength(3)
    const byKeys = Object.fromEntries(records.map((record) => [JSON.stringify((record as { _aws: { CloudWatchMetrics: Array<{ Dimensions: string[][] }> } })._aws.CloudWatchMetrics[0]?.Dimensions), record]))
    const target = byKeys[JSON.stringify([['TargetId']])] as Record<string, unknown>
    expect(target).toMatchObject({ TargetId: '1.0', rum_beacons_accepted: 1, rum_first_sightings: 1 })
    // A metric repeated under one dimension set is an array of samples — what two PutMetricData datums were.
    expect(target['rum_observations_counted']).toEqual([1, 1])
    expect((target['_aws'] as { Timestamp: number }).Timestamp).toBe(ts)
    expect((target['_aws'] as { CloudWatchMetrics: Array<{ Namespace: string; Metrics: unknown[] }> }).CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'rum/rum',
      Metrics: expect.arrayContaining([
        { Name: 'rum_beacons_accepted', Unit: 'Count' },
        { Name: 'rum_first_sightings', Unit: 'Count' },
        { Name: 'rum_observations_counted', Unit: 'Count' },
      ]),
    })
  })

  it('keeps dimension keys sorted and multi-key sets distinct, with units preserved', () => {
    const records = emfRecords('rum/rum', data, ts)
    const health = records.find((record) => 'AgentVersion' in record) as Record<string, unknown>
    expect((health['_aws'] as { CloudWatchMetrics: Array<{ Dimensions: string[][] }> }).CloudWatchMetrics[0]?.Dimensions).toEqual([['AgentVersion', 'TargetId']])
    expect(health).toMatchObject({ AgentVersion: '1.0.0', TargetId: '1.0', rum_agent_p95_task_ms: 2 })
    expect((health['_aws'] as { CloudWatchMetrics: Array<{ Metrics: unknown[] }> }).CloudWatchMetrics[0]?.Metrics).toEqual([{ Name: 'rum_agent_p95_task_ms', Unit: 'Milliseconds' }])
  })

  it('represents an undimensioned metric as an empty dimension set, not a missing one', () => {
    const records = emfRecords('rum/rum', data, ts)
    const plain = records.find((record) => 'rum_unmapped_origin' in record) as Record<string, unknown>
    expect((plain['_aws'] as { CloudWatchMetrics: Array<{ Dimensions: string[][] }> }).CloudWatchMetrics[0]?.Dimensions).toEqual([[]])
    expect(plain['rum_unmapped_origin']).toBe(1)
  })

  it('treats the same keys with different values as different records — a dimension value is a root property and cannot be two things', () => {
    const records = emfRecords(
      'rum/rum',
      [
        { name: 'rum_beacons_rejected', value: 1, unit: 'Count', dimensions: { Reason: 'schema', AgentVersion: '1.0.0' } },
        { name: 'rum_beacons_rejected', value: 1, unit: 'Count', dimensions: { Reason: 'size', AgentVersion: 'unknown' } },
      ],
      ts,
    )
    expect(records).toHaveLength(2)
    expect(records.map((record) => (record as { Reason: string }).Reason).sort()).toEqual(['schema', 'size'])
  })

  it('never lets a dimension name and a metric name collide in the root', () => {
    for (const record of emfRecords('rum/rum', data, ts)) {
      const aws = record['_aws'] as { CloudWatchMetrics: Array<{ Dimensions: string[][]; Metrics: Array<{ Name: string }> }> }
      const dimensionKeys = aws.CloudWatchMetrics[0]?.Dimensions[0] ?? []
      const metricNames = aws.CloudWatchMetrics[0]?.Metrics.map((metric) => metric.Name) ?? []
      expect(dimensionKeys.filter((key) => metricNames.includes(key))).toEqual([])
      for (const key of [...dimensionKeys, ...metricNames]) expect(record).toHaveProperty(key)
    }
  })

  it('splits a dimension set whose metric exceeds 100 samples across records — CloudWatch extracts nothing from an event with a longer array', () => {
    // A single /csp-reports body can carry ~300 reports, each counted under the same TargetId.
    const flood: MetricDatum[] = [
      ...Array.from({ length: 300 }, (): MetricDatum => ({ name: 'rum_csp_reports_accepted', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } })),
      ...Array.from({ length: 150 }, (): MetricDatum => ({ name: 'rum_first_sightings', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } })),
      { name: 'rum_beacons_accepted', value: 1, unit: 'Count', dimensions: { TargetId: '1.0' } },
    ]
    const records = emfRecords('rum/rum', flood, ts) as Array<Record<string, unknown> & { _aws: { CloudWatchMetrics: Array<{ Metrics: Array<{ Name: string }> }> } }>
    expect(records).toHaveLength(3)
    const members = (record: Record<string, unknown>, name: string): number => (Array.isArray(record[name]) ? (record[name] as number[]).length : record[name] === undefined ? 0 : 1)
    for (const record of records) {
      for (const name of ['rum_csp_reports_accepted', 'rum_first_sightings', 'rum_beacons_accepted']) expect(members(record, name)).toBeLessThanOrEqual(EMF_MAX_ARRAY_MEMBERS)
      // Every record declares exactly the metrics it carries, and carries the dimension value.
      expect(record._aws.CloudWatchMetrics[0]?.Metrics.map((metric) => metric.Name).sort()).toEqual(
        Object.keys(record)
          .filter((key) => key.startsWith('rum_'))
          .sort(),
      )
      expect(record['TargetId']).toBe('1.0')
    }
    // Nothing lost: the sample counts add up across the chunks.
    expect(records.reduce((sum, record) => sum + members(record, 'rum_csp_reports_accepted'), 0)).toBe(300)
    expect(records.reduce((sum, record) => sum + members(record, 'rum_first_sightings'), 0)).toBe(150)
    expect(records.reduce((sum, record) => sum + members(record, 'rum_beacons_accepted'), 0)).toBe(1)
    // The shorter metrics appear only in the records that still have samples of them.
    expect(members(records[2]!, 'rum_first_sightings')).toBe(0)
    expect(members(records[1]!, 'rum_beacons_accepted')).toBe(0)
  })

  it('writes to raw stdout, never console.log, whose output the runtime decorates', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      stdoutLine('{"_aws":{}}\n')
      expect(stdout).toHaveBeenCalledWith('{"_aws":{}}\n')
      expect(log).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
      log.mockRestore()
    }
  })

  it('the publisher writes one newline-terminated JSON line per record and nothing for an empty batch', async () => {
    const lines: string[] = []
    const publish = emfPublisher(
      (line) => lines.push(line),
      () => ts,
    )
    await publish({ namespace: 'rum/rum', data })
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true)
      expect(line.slice(0, -1)).not.toContain('\n')
      expect(JSON.parse(line)).toMatchObject({ _aws: { Timestamp: ts } })
    }
    await publish({ namespace: 'rum/rum', data: [] })
    expect(lines).toHaveLength(3)
  })
})
