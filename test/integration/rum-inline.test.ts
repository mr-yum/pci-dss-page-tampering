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
import { ScriptComparisonService } from '../../src/services/comparison/script.js'
import type { RumAlertCategory, RumAlertContext } from '../../src/types/alert.js'
import type { Beacon } from '../../src/types/beacon.js'
import type { SHA256Hash } from '../../src/types/hash.js'
import type { Inventory, InventoryAlert, InventoryScriptInfo } from '../../src/types/inventory/model.js'
import { createMatcher } from '../../src/types/matcher/matcher-factory.js'
import type { TargetDetection } from '../../src/types/target.js'
import type { Logger } from '../../src/utils/logger.js'

/**
 * RUM inline-script content verification end-to-end (feature 011, US2 /
 * T030): drives the REAL pipeline in-process — collector ingest handler →
 * captured queue message → drainQueue → normaliseMessage → routeMessage →
 * real ScriptComparisonService and real matchers — with only the AWS
 * transports (Firehose, DynamoDB, SQS) replaced by in-memory fakes.
 *
 * Covers the US2 acceptance scenarios the tripwire test does not:
 * scenario 2 (identified inline failing authorisation → mismatch alert with
 * matcher context and reason), scenario 3 (oversize fallback is still
 * evaluated and never dropped), and scenario 4 (existing-style 64-char
 * anchored content matchers evaluate identically against the 128-char
 * head/tail windows). Scenario 1 — authorised inline via the client-computed
 * hash → recorded, no alert — is already covered end-to-end by
 * test/integration/rum-tripwire.test.ts ("authorised inline script via
 * client-computed hash") and is deliberately not duplicated here.
 */

const FIXTURES = join(__dirname, '../fixtures/beacons')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const NOW = 1755600000500
const PROD_ORIGIN = 'https://pay.example.com'
/** Fixed fake commit SHA of the inventory the drain judges against (SC-005). */
const INVENTORY_REF = '0123456789abcdef0123456789abcdef01234567'

const silentLogger: Logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined }

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The oversize fixture's inline observation, for window-derived matchers. */
const oversizeObservation = (() => {
  const beacon = JSON.parse(fixture('inline-oversize.json')) as Beacon
  const observation = beacon.observations[0]!
  if (observation.kind !== 'inline-script') throw new Error('fixture drifted: expected an inline-script observation')
  return observation
})()

// ---------------------------------------------------------------------------
// Collector harness: the REAL createHandler over in-memory transports
// (same shape as rum-tripwire.test.ts).
// ---------------------------------------------------------------------------

const collectorConfig: CollectorConfig = {
  originTargets: [{ origin: PROD_ORIGIN, target_id: '1.0', target_type: 'detection' }],
  edgeAuthMode: 'aws_iam',
  firehoseStream: 'archive-stream',
  noveltyTable: 'novelty-table',
  queueUrl: 'https://sqs.example/queue',
  noveltyTtlDays: 90,
  metricNamespace: 'Collector/RUM',
}

const makeCollectorHarness = () => {
  const noveltyStore = new Map<string, NoveltyItem>()
  const queueMessages: { queueUrl: string; body: string; attributes: Record<string, string> }[] = []

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
  const post = (body: string) => handler({ headers: { origin: PROD_ORIGIN }, body })

  return { post, queueMessages }
}

// ---------------------------------------------------------------------------
// Comparator harness: drainQueue over an in-memory QueueSource, routing via
// the real normalise → route → ScriptComparisonService pipeline.
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
  // Only the RUM entry point is ever exercised on this path; the cast keeps
  // the fake honest — any other IAlertService call would throw at runtime.
  return { alerts, service: capture as unknown as IAlertService }
}

const detectionTarget: TargetDetection = {
  type: 'detection',
  url: 'https://pay.example.com/checkout',
  workflow: { fileName: 'rum-inline-workflow.json', definition: { steps: [] } },
  logger: silentLogger,
}

const makeInventory = (scripts: InventoryScriptInfo[]): Inventory => ({
  fileName: '1.0.json',
  target: {
    inventory: { type: 'inventory', url: 'https://staging.pay.example.com/checkout', workflow: { fileName: 'rum-inline-workflow.json', definition: { steps: [] } }, logger: silentLogger },
    detection: detectionTarget,
  },
  alerts: {
    inventory: {
      newScriptIdentified: { destination: 'inventory-script-channel' },
      newHeaderIdentified: { destination: 'inventory-header-channel' },
    },
    detection: {
      newScriptDetected: { destination: 'detection-script-channel' },
      scriptMismatchDetected: { destination: 'script-mismatch-channel' },
      newHeaderDetected: { destination: 'detection-header-channel' },
    },
    successNotification: { destination: 'success-channel' },
  },
  scripts,
  headers: [],
})

/** One drain run over the given raw queue bodies against the given entries. */
const drainRun = async (bodies: string[], scripts: InventoryScriptInfo[]) => {
  const { alerts, service } = makeCapturingAlertService()
  const source = new InMemoryQueueSource(bodies.map((body, index) => ({ id: `msg-${index}`, body })))
  const outcomes: RumRouteOutcome[] = []

  const counts = await drainQueue(source, async (message) => {
    const outcome = await routeMessage(normaliseMessage(message), {
      scriptComparison: new ScriptComparisonService(),
      alertService: service,
      inventory: makeInventory(scripts),
      target: detectionTarget,
      inventoryRef: INVENTORY_REF,
      log: silentLogger,
      seen: new Set(),
    })
    outcomes.push(outcome)
    return outcome.drain
  })

  return { counts, alerts, source, outcomes }
}

/** Identifies any RUM inline observation; authoriser supplied per test. */
const inlineEntry = (authoriseWith: InventoryScriptInfo['authoriseWith']): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
  authoriseWith,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RUM inline-script content verification end-to-end (US2): collector → queue → drain → real comparison', () => {
  describe('scenario 2: identified inline script failing authorisation → rum_mismatched_script_detected with matcher context and reason', () => {
    it('carries the authorisation matcher description, the explicit failure reason, and the metadata path', async () => {
      // inline-valid.json is 139 chars long, so its content rides as head/tail
      // windows; an unanchored content matcher cannot be soundly evaluated
      // against a bounded excerpt and fails secure with its explicit reason.
      const entry = inlineEntry({
        matcher: createMatcher({ contentMatcher: 'unanchored-snippet-nowhere-in-source', authorisationInfo: { description: 'Unanchored legacy snippet', authorised: true, date: '2026-08-01T00:00:00.000Z' } }),
        authorisationInfo: { description: 'Tag-manager bootstrap', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      })
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-valid.json'))
      expect(harness.queueMessages).toHaveLength(1)

      const { counts, alerts, source, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        [entry],
      )

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted'])
      expect(alerts).toHaveLength(1)

      const { category, context } = alerts[0]!
      expect(category).toBe('rum_mismatched_script_detected')
      expect(context.matcherDescription).toContain('content:')
      expect(context.failureReason).toContain('content evidence is a bounded excerpt')
      // Never the misleading evidence-less reason when windows exist (T029).
      expect(context.failureReason).not.toContain('content is null or empty')
      expect(context.metadataPath?.map((info) => info.description)).toEqual(['Unanchored legacy snippet'])

      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })
  })

  describe('scenario 3: oversize inline script (no hash, oversize flag) is still evaluated, fails secure, and is never dropped', () => {
    it("routes the observation, alerts with the hash authoriser's truthful missing-evidence reason, and deletes the message", async () => {
      // Inventory pins this inline script by hash — evidence the oversize
      // observation honestly cannot carry. Fail-secure means a mismatched
      // alert, not a silent drop and not a dead-letter.
      const entry = inlineEntry({
        matcher: createMatcher({ hashes: [{ timestamp: new Date('2026-08-01T00:00:00.000Z'), hash: { value: 'a'.repeat(64) } as SHA256Hash }] }),
        authorisationInfo: { description: 'Bundle pinned by hash', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      })
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-oversize.json'))
      expect(harness.queueMessages).toHaveLength(1)

      const { counts, alerts, source, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        [entry],
      )

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted'])
      expect(alerts).toHaveLength(1)
      expect(alerts[0]!.category).toBe('rum_mismatched_script_detected')
      expect(alerts[0]!.context.failureReason).toContain('hash is missing')
      expect(alerts[0]!.context.observation.hash).toBeUndefined()

      // Never dropped: routed and deleted, nothing dead-lettered.
      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })
  })

  describe('scenario 4: existing-style 64-char anchored content matchers evaluate identically against the 128-char windows', () => {
    it('authorises the oversize script via a ^-anchored 64-char snippet of its head — recorded, zero alerts', async () => {
      // The exact matcher style the inventory workflow generates for inline
      // scripts: an anchored 64-char content snippet. head is a strict prefix
      // of the real source, so a ^-anchored match inside it IS a match on the
      // full content.
      const anchoredSnippet = `^${escapeRegex(oversizeObservation.head.slice(0, 64))}`
      const entry = inlineEntry({
        matcher: createMatcher({ contentMatcher: anchoredSnippet }),
        authorisationInfo: { description: 'Anchored bundle preamble', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      })
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-oversize.json'))

      const { counts, alerts, source, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        [entry],
      )

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
      expect(alerts).toHaveLength(0)
      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })

    it('authorises via a $-anchored 64-char snippet of the tail window', async () => {
      const anchoredSnippet = `${escapeRegex(oversizeObservation.tail.slice(-64))}$`
      const entry = inlineEntry({
        matcher: createMatcher({ contentMatcher: anchoredSnippet }),
        authorisationInfo: { description: 'Anchored bundle epilogue', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      })
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-oversize.json'))

      const { alerts, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        [entry],
      )

      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
      expect(alerts).toHaveLength(0)
    })
  })
})
