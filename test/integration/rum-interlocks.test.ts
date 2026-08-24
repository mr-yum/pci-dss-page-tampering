import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectorConfig, CollectorDeps, NoveltyItem } from '../../collector/src/ingest.js'
import { createHandler } from '../../collector/src/ingest.js'
import type { IAlertService } from '../../src/interfaces/alert.js'
import type { QueueSource, RawQueueEntry } from '../../src/rum/drain.js'
import { drainQueue } from '../../src/rum/drain.js'
import { normaliseMessage } from '../../src/rum/normalise.js'
import type { RumRouteOutcome } from '../../src/rum/route.js'
import { routeMessage } from '../../src/rum/route.js'
import { resolveRumAlertDestination } from '../../src/services/alert/rum.js'
import { ScriptComparisonService } from '../../src/services/comparison/script.js'
import type { RumAlertCategory, RumAlertContext } from '../../src/types/alert.js'
import type { SHA256Hash } from '../../src/types/hash.js'
import type { AlertRum, Inventory, InventoryAlert, InventoryScriptInfo } from '../../src/types/inventory/model.js'
import { getInventoryWorkflows } from '../../src/types/inventory/model.js'
import { createMatcher } from '../../src/types/matcher/matcher-factory.js'
import type { Target, TargetDetection } from '../../src/types/target.js'
import type { Logger } from '../../src/utils/logger.js'

/**
 * RUM interlocks end-to-end (feature 011, US4 — T040): the three mechanisms
 * that keep the surveillance itself honest, each driven through the real
 * in-process pipeline (collector ingest handler → queue → drainQueue →
 * normaliseMessage → routeMessage → real ScriptComparisonService), with only
 * the AWS transports replaced by in-memory fakes. No network, no Puppeteer.
 *
 * 1. Canary (FR-016): the scheduled canary beacon exercises the full path
 *    against a DEDICATED canary target whose alert config routes the rum
 *    categories to the ops channel — the expected alert lands there through
 *    the ordinary pipeline (no suppression mechanism anywhere), and the
 *    production target's security channel receives nothing.
 * 2. Agent tamper (FR-016, T037): the hash-pinned, requiredOn agent entry
 *    makes the synthetic detection pass alarm when the agent is absent
 *    (missing_required_script) or its bytes changed (unauthorised content).
 * 3. CSP gating (T035): rum_csp_violation_reported alerts only for a target
 *    that opted in via alerts.rum.cspViolationReported; every other target
 *    records the violation — and an opted-in target with a prevalence floor
 *    above the first sighting's one provable session records with an
 *    explicit gated reason.
 */

const FIXTURES = join(__dirname, '../fixtures/beacons')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const NOW = 1755600000500
const PROD_ORIGIN = 'https://pay.example.com'
const CANARY_ORIGIN = 'https://canary.example.test'
const CANARY_MARKER_URL = 'https://canary-marker.example.test/rum-canary.js'
const AGENT_URL = 'https://monitor.example.com/rum-agent.js'
const AGENT_HASH = 'a1'.repeat(32)
const INVENTORY_REF = 'fedcba9876543210fedcba9876543210fedcba98'

const silentLogger: Logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined }

// ---------------------------------------------------------------------------
// Collector harness: the REAL createHandler over in-memory transports, with
// an origin map covering the production target AND the dedicated canary
// target (docs/rum/canary-workflow.md).
// ---------------------------------------------------------------------------

const collectorConfig: CollectorConfig = {
  originTargets: [
    { origin: PROD_ORIGIN, target_id: '1.0', target_type: 'detection' },
    { origin: CANARY_ORIGIN, target_id: 'canary', target_type: 'detection' },
  ],
  edgeAuthMode: 'aws_iam',
  firehoseStream: 'archive-stream',
  noveltyTable: 'novelty-table',
  queueUrl: 'https://sqs.example/queue',
  noveltyTtlDays: 90,
  metricNamespace: 'Collector/RUM',
}

type SentQueueMessage = { queueUrl: string; body: string; attributes: Record<string, string> }

const makeCollectorHarness = () => {
  const noveltyStore = new Map<string, NoveltyItem>()
  const queueMessages: SentQueueMessage[] = []

  const deps: CollectorDeps = {
    firehose: { putRecord: async () => undefined },
    dynamo: {
      putItemIfAbsent: async ({ item }) => {
        if (noveltyStore.has(item.pk)) {
          throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
        }
        noveltyStore.set(item.pk, { ...item })
      },
      updateCounters: async () => undefined,
      deleteItem: async ({ pk }) => {
        noveltyStore.delete(pk)
      },
    },
    sqs: {
      sendMessage: async (input) => {
        queueMessages.push(input)
      },
    },
    metrics: { publish: async () => undefined },
    now: () => NOW,
  }

  const handler = createHandler(collectorConfig, deps)
  const post = (origin: string, body: string) => handler({ headers: { origin }, body })

  return { post, queueMessages }
}

// ---------------------------------------------------------------------------
// Comparator harness (pattern of rum-tripwire.test.ts): drainQueue over an
// in-memory QueueSource, routing via the real pipeline against a per-target
// inventory — exactly how `--mode rum-compare` partitions messages by
// target_id.
// ---------------------------------------------------------------------------

class InMemoryQueueSource implements QueueSource {
  deleted: string[] = []
  deadLettered: { id: string; reason: string }[] = []
  private served = false

  constructor(private readonly entries: RawQueueEntry[]) {}

  async receiveBatch(): Promise<RawQueueEntry[]> {
    if (this.served) return []
    this.served = true
    return this.entries
  }

  async delete(entry: RawQueueEntry): Promise<void> {
    this.deleted.push(entry.id)
  }

  async deadLetter(entry: RawQueueEntry, reason: string): Promise<void> {
    this.deadLettered.push({ id: entry.id, reason })
  }
}

type CapturedAlert = { category: RumAlertCategory; context: RumAlertContext; destinations: InventoryAlert }

const makeCapturingAlertService = () => {
  const alerts: CapturedAlert[] = []
  const capture = {
    alertForRumObservation: async (category: RumAlertCategory, context: RumAlertContext, destinations: InventoryAlert): Promise<void> => {
      alerts.push({ category, context, destinations })
    },
  }
  return { alerts, service: capture as unknown as IAlertService }
}

const makeDetectionTarget = (url: string): TargetDetection => ({
  type: 'detection',
  url,
  workflow: { fileName: 'rum-interlocks-workflow.json', definition: { steps: [] } },
  logger: silentLogger,
})

/**
 * Inventory fixture builder. The security-channel destinations are the
 * defaults; the canary target overrides every category — including the rum
 * block — to the ops channel, and CSP-gating cases override just the rum
 * block (T035 opt-in).
 */
const makeInventory = (fileName: string, detectionUrl: string, options: { channel?: string; rum?: AlertRum; scripts?: InventoryScriptInfo[] } = {}): Inventory => {
  const channel = options.channel ?? 'security-channel'
  return {
    fileName,
    target: {
      inventory: { type: 'inventory', url: 'https://staging.pay.example.com/checkout', workflow: { fileName: 'rum-interlocks-workflow.json', definition: { steps: [] } }, logger: silentLogger },
      detection: makeDetectionTarget(detectionUrl),
    },
    alerts: {
      inventory: {
        newScriptIdentified: { destination: channel },
        newHeaderIdentified: { destination: channel },
      },
      detection: {
        newScriptDetected: { destination: channel },
        scriptMismatchDetected: { destination: channel },
        newHeaderDetected: { destination: channel },
      },
      ...(options.rum !== undefined ? { rum: options.rum } : {}),
      successNotification: { destination: 'success-channel' },
    },
    scripts: options.scripts ?? [],
    headers: [],
  }
}

/** One drain run routing every message against the given target's inventory. */
const drainRun = async (bodies: string[], inventory: Inventory) => {
  const { alerts, service } = makeCapturingAlertService()
  const source = new InMemoryQueueSource(bodies.map((body, index) => ({ id: `msg-${index}`, body })))
  const outcomes: RumRouteOutcome[] = []
  const seen = new Set<string>()

  const counts = await drainQueue(source, async (message) => {
    const outcome = await routeMessage(normaliseMessage(message), {
      scriptComparison: new ScriptComparisonService(),
      alertService: service,
      inventory,
      // The fixture is always single-workflow; normalising through the same
      // helper orchestration uses keeps the type honest.
      target: getInventoryWorkflows(inventory.target)[0]!.detection,
      inventoryRef: INVENTORY_REF,
      log: silentLogger,
      seen,
    })
    outcomes.push(outcome)
    return outcome.drain
  })

  return { counts, alerts, source, outcomes }
}

// ---------------------------------------------------------------------------
// 1. Canary path (FR-016, docs/rum/canary-workflow.md)
// ---------------------------------------------------------------------------

describe('RUM interlocks: canary → ops channel through the real pipeline', () => {
  /** The canary target's alert config: EVERY rum category → ops channel. */
  const canaryInventory = () =>
    makeInventory('canary.json', `${CANARY_ORIGIN}/`, {
      channel: 'ops-channel',
      rum: {
        uninventoriedScriptDetected: { destination: 'ops-channel' },
        mismatchedScriptDetected: { destination: 'ops-channel' },
        cspViolationReported: { destination: 'ops-channel' },
      },
    })

  it('maps the canary origin to the dedicated canary target at ingest — never to a production target', async () => {
    const harness = makeCollectorHarness()

    const result = await harness.post(CANARY_ORIGIN, fixture('canary.json'))

    expect(result).toEqual({ statusCode: 204, body: '' })
    expect(harness.queueMessages).toHaveLength(1)
    const message = JSON.parse(harness.queueMessages[0]!.body)
    expect(message.target_id).toBe('canary')
    expect(message.target_type).toBe('detection')
    expect(message.observation.url).toBe(CANARY_MARKER_URL)
  })

  it("lands the expected rum_uninventoried_script_detected alert on the canary target's ops channel, with no suppression anywhere in the path", async () => {
    const harness = makeCollectorHarness()
    await harness.post(CANARY_ORIGIN, fixture('canary.json'))

    const { counts, alerts, source } = await drainRun(
      harness.queueMessages.map((message) => message.body),
      canaryInventory(),
    )

    expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
    expect(alerts).toHaveLength(1)
    const { category, context, destinations } = alerts[0]!
    expect(category).toBe('rum_uninventoried_script_detected')
    expect(context.observation.identity).toBe(CANARY_MARKER_URL)
    expect(context.inventoryRef).toBe(INVENTORY_REF)
    // The alert routes by the canary target's own config — the real resolver
    // lands it on the ops channel, exactly as a Slack/console service would.
    expect(resolveRumAlertDestination(destinations, category)).toEqual({ destination: 'ops-channel' })
    expect(source.deleted).toEqual(['msg-0'])
    expect(source.deadLettered).toEqual([])
  })

  it('leaves the production target untouched: no queue message for it, and its security channel receives nothing', async () => {
    const harness = makeCollectorHarness()
    await harness.post(CANARY_ORIGIN, fixture('canary.json'))

    // Ingest attribution is the isolation mechanism: every message the canary
    // produced belongs to the canary target, so the production partition of
    // the drain is empty.
    const productionBodies = harness.queueMessages.filter((message) => JSON.parse(message.body).target_id === '1.0')
    expect(productionBodies).toHaveLength(0)

    const productionRun = await drainRun(
      productionBodies.map((message) => message.body),
      makeInventory('1.0.json', `${PROD_ORIGIN}/checkout`),
    )

    expect(productionRun.alerts).toHaveLength(0)
    expect(productionRun.counts).toEqual({ received: 0, routed: 0, invalid: 0, failed: 0 })
  })
})

// ---------------------------------------------------------------------------
// 2. Agent-tamper path (FR-016, T037 machinery — synthetic detection pass)
// ---------------------------------------------------------------------------

describe('RUM interlocks: hash-pinned agent entry on the synthetic detection pass', () => {
  const service = new ScriptComparisonService()

  /** The agent as the inventory pins it: exact URL, exact hash, required on detection. */
  const agentEntry = (): InventoryScriptInfo => ({
    identifyWith: createMatcher({ nameMatcher: '^https://monitor\\.example\\.com/rum-agent\\.js$' }),
    authoriseWith: {
      matcher: createMatcher({ hashes: [{ timestamp: new Date('2026-08-01T00:00:00.000Z'), hash: { value: AGENT_HASH } as SHA256Hash }] }),
      authorisationInfo: { description: 'RUM monitoring agent, hash-pinned release', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
    },
    requiredOn: ['detection'],
  })

  const target: Target = makeDetectionTarget(`${PROD_ORIGIN}/checkout`)
  const inventory = () => makeInventory('1.0.json', `${PROD_ORIGIN}/checkout`, { scripts: [agentEntry()] })

  it('flags the agent as missing_required_script when it is absent from the page (agent suppressed or removed)', async () => {
    const results = await service.compare(target, inventory(), {
      externalScripts: [{ source: { type: 'external', url: 'https://cdn.example.net/sdk.js', content: 'console.log("sdk")' }, hash: { value: 'b2'.repeat(32) } as SHA256Hash }],
      inlineScripts: [],
    })

    const missing = results.filter((result) => result.type === 'missing_required_script')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({
      type: 'missing_required_script',
      scriptDescription: expect.stringContaining('rum-agent'),
    })
    // The unrelated SDK stays an ordinary unknown-script finding; the agent's
    // absence is its own result, not folded into it.
    expect(results.some((result) => result.type === 'unknown_script_found')).toBe(true)
  })

  it('flags tampered agent bytes as unauthorised content — present but wrong hash, never "missing"', async () => {
    const results = await service.compare(target, inventory(), {
      externalScripts: [{ source: { type: 'external', url: AGENT_URL, content: 'tampered agent body' }, hash: { value: 'c3'.repeat(32) } as SHA256Hash }],
      inlineScripts: [],
    })

    expect(results.map((result) => result.type)).toEqual(['known_script_unauthorised_content'])
    expect(results[0]).toMatchObject({ type: 'known_script_unauthorised_content', failureReason: expect.stringContaining('not in authorized list') })
  })

  it('stays silent when the pinned agent is present with the pinned bytes', async () => {
    const results = await service.compare(target, inventory(), {
      externalScripts: [{ source: { type: 'external', url: AGENT_URL, content: 'authentic agent body' }, hash: { value: AGENT_HASH } as SHA256Hash }],
      inlineScripts: [],
    })

    expect(results.map((result) => result.type)).toEqual(['authorized_script'])
  })
})

// ---------------------------------------------------------------------------
// 3. CSP gating end-to-end (T035)
// ---------------------------------------------------------------------------

describe('RUM interlocks: CSP violation gating end-to-end', () => {
  const CSP_IDENTITY = 'script-src → https://evil.example/x.js'

  const postCspViolation = async () => {
    const harness = makeCollectorHarness()
    await harness.post(PROD_ORIGIN, fixture('csp-violation.json'))
    expect(harness.queueMessages).toHaveLength(1)
    return harness.queueMessages.map((message) => message.body)
  }

  it('alerts rum_csp_violation_reported with the violation-as-reported context for a target that activates the category', async () => {
    const bodies = await postCspViolation()

    const { counts, alerts, outcomes, source } = await drainRun(bodies, makeInventory('1.0.json', `${PROD_ORIGIN}/checkout`, { rum: { cspViolationReported: { destination: 'csp-triage-channel' } } }))

    expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted'])
    expect(alerts).toHaveLength(1)
    const { category, context, destinations } = alerts[0]!
    expect(category).toBe('rum_csp_violation_reported')
    // Violation as reported — directive, blocked URI, route, prevalence,
    // inventory ref; no matcher context (CSP observations are never matched
    // against inventory entries).
    expect(context.observation).toEqual({ kind: 'csp-violation', identity: CSP_IDENTITY })
    expect(context.first_route).toBe('/checkout')
    expect(context.prevalence.first_seen).toBe(NOW)
    expect(context.targetType).toBe('detection')
    expect(context.inventoryRef).toBe(INVENTORY_REF)
    expect(context.failureReason).toBeUndefined()
    expect(context.matcherDescription).toBeUndefined()
    expect(resolveRumAlertDestination(destinations, category)).toEqual({ destination: 'csp-triage-channel' })
    expect(source.deleted).toEqual(['msg-0'])
  })

  it('records — no alert — for a target without the opt-in destination (the permanent default, T035)', async () => {
    const bodies = await postCspViolation()

    const { counts, alerts, outcomes, source } = await drainRun(bodies, makeInventory('1.0.json', `${PROD_ORIGIN}/checkout`))

    expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
    expect(outcomes[0]!.category).toBe('rum_csp_violation_reported')
    expect(alerts).toHaveLength(0)
    // Recorded is a routed outcome: the message is deleted, never dead-lettered.
    expect(source.deleted).toEqual(['msg-0'])
    expect(source.deadLettered).toEqual([])
  })

  it("gates an activated category to recorded when the prevalence floor exceeds the first sighting's one provable session", async () => {
    const bodies = await postCspViolation()

    const { alerts, outcomes } = await drainRun(bodies, makeInventory('1.0.json', `${PROD_ORIGIN}/checkout`, { rum: { cspViolationReported: { destination: 'csp-triage-channel' }, cspViolationReportedMinSessions: 5 } }))

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
    expect(outcomes[0]!.gatedReason).toContain('cspViolationReportedMinSessions=5')
    expect(alerts).toHaveLength(0)
  })
})
