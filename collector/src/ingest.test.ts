import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Beacon } from '../../src/types/beacon.js'
import type { CollectorConfig, CollectorDeps, FunctionUrlEvent, FunctionUrlResult, MetricDatum } from './ingest.js'
import { createHandler, loadConfigFromEnv } from './ingest.js'

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
  dynamo: { putItemIfAbsent: jest.Mock; updateCounters: jest.Mock }
  sqs: { sendMessage: jest.Mock }
  metrics: { publish: jest.Mock }
}

const makeDeps = (): MockDeps => ({
  firehose: { putRecord: jest.fn().mockResolvedValue(undefined) },
  dynamo: { putItemIfAbsent: jest.fn().mockResolvedValue(undefined), updateCounters: jest.fn().mockResolvedValue(undefined) },
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
  it('stamps a staging-origin beacon as the inventory pass', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'), { origin: STAGING_ORIGIN }))

    expectNoContent(result)
    const record = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    expect(record.stamp).toEqual({ target_id: '1.0', target_type: 'inventory', received_at: NOW })
    expect(record.beacon).toEqual(JSON.parse(fixture('external-unknown.json')))
  })

  it('stamps a production-origin beacon as the detection pass', async () => {
    const deps = makeDeps()
    const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('external-unknown.json'), { Origin: PROD_ORIGIN }))

    expectNoContent(result)
    const record = JSON.parse(deps.firehose.putRecord.mock.calls[0][0].data)
    expect(record.stamp.target_type).toBe('detection')
    expect(metricNames(deps)).toContain('rum_beacons_accepted')
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
    it('counts a schema-invalid beacon with its reason and archives nothing', async () => {
      const deps = makeDeps()
      const result = await createHandler(makeConfig(), deps)(makeEvent(fixture('invalid/unknown-key.json')))

      expectNoContent(result)
      expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: 'schema' } })])
      expect(deps.firehose.putRecord).not.toHaveBeenCalled()
      expect(deps.dynamo.putItemIfAbsent).not.toHaveBeenCalled()
    })

    it.each([
      ['size', 'x'.repeat(40000)],
      ['json', '{not json'],
    ])('counts a %s rejection', async (reason, body) => {
      const deps = makeDeps()
      expectNoContent(await createHandler(makeConfig(), deps)(makeEvent(body)))
      expect(publishedMetrics(deps)).toEqual([expect.objectContaining({ name: 'rum_beacons_rejected', dimensions: { Reason: reason } })])
      expect(deps.firehose.putRecord).not.toHaveBeenCalled()
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
      expect.arrayContaining([expect.objectContaining({ name: 'rum_agent_p95_task_ms', value: 2, dimensions: { TargetId: '1.0' } }), expect.objectContaining({ name: 'rum_agent_dropped', value: 0, dimensions: { TargetId: '1.0' } })]),
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
