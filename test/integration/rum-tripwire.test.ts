import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectorConfig, CollectorDeps, NoveltyItem } from '../../collector/src/ingest.js'
import { createHandler } from '../../collector/src/ingest.js'
import type { IAlertService } from '../../src/interfaces/alert.js'
import type { QueueSource, RawQueueEntry } from '../../src/rum/drain.js'
import { drainQueue } from '../../src/rum/drain.js'
import { normaliseMessage } from '../../src/rum/normalise.js'
import type { RumRouteOutcome } from '../../src/rum/route.js'
import { routeDetectionMessage } from '../../src/rum/route.js'
import { ScriptComparisonService } from '../../src/services/comparison/script.js'
import type { RumAlertCategory, RumAlertContext } from '../../src/types/alert.js'
import type { Beacon } from '../../src/types/beacon.js'
import type { SHA256Hash } from '../../src/types/hash.js'
import type { Inventory, InventoryAlert, InventoryScriptInfo } from '../../src/types/inventory/model.js'
import { createMatcher } from '../../src/types/matcher/matcher-factory.js'
import type { TargetDetection } from '../../src/types/target.js'
import type { Logger } from '../../src/utils/logger.js'

/**
 * RUM tripwire end-to-end (feature 011, US1): drives the REAL pipeline
 * in-process — collector ingest handler → captured queue message → drainQueue
 * → normaliseMessage → routeDetectionMessage → real ScriptComparisonService —
 * with only the AWS transports (Firehose, DynamoDB, SQS) replaced by
 * in-memory fakes. No network, no Puppeteer.
 */

const FIXTURES = join(__dirname, '../fixtures/beacons')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const NOW = 1755600000500
const PROD_ORIGIN = 'https://pay.example.com'
const SKIMMER_URL = 'https://evil.example/skimmer.js'
const SKIMMER_PK = `1.0#${SKIMMER_URL}#pay.example.com`
const COVERED_URL = 'https://cdn.example.net/sdk.js'
/** Fixed fake commit SHA of the inventory the drain judges against (SC-005). */
const INVENTORY_REF = '0123456789abcdef0123456789abcdef01234567'

const silentLogger: Logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined }

// ---------------------------------------------------------------------------
// Collector harness: the REAL createHandler over in-memory transports.
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

type SentQueueMessage = { queueUrl: string; body: string; attributes: Record<string, string> }

const makeCollectorHarness = () => {
  const archived: string[] = []
  const noveltyStore = new Map<string, NoveltyItem>()
  const counterUpdates: { pk: string; lastSeen: number }[] = []
  const queueMessages: SentQueueMessage[] = []

  const deps: CollectorDeps = {
    firehose: {
      putRecord: async ({ data }) => {
        archived.push(data)
      },
    },
    dynamo: {
      // Conditional PutItem semantics of the real adapter: reject with
      // ConditionalCheckFailedException when the pk already exists.
      putItemIfAbsent: async ({ item }) => {
        if (noveltyStore.has(item.pk)) {
          throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
        }
        noveltyStore.set(item.pk, { ...item })
      },
      updateCounters: async ({ pk, lastSeen }) => {
        counterUpdates.push({ pk, lastSeen })
        const existing = noveltyStore.get(pk)
        if (existing !== undefined) {
          existing.last_seen = lastSeen
          existing.sessions += 1
        }
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

  return { post, archived, noveltyStore, counterUpdates, queueMessages }
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
  workflow: { fileName: 'rum-tripwire-workflow.json', definition: { steps: [] } },
  logger: silentLogger,
}

// Fixture pattern mirrors src/rum/route.test.ts (itself mirroring
// src/services/comparison/script.test.ts): entries are built with the real
// matcher factory, never hand-rolled matcher fakes.
const coveredCdnEntry = (): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: '^https://cdn\\.example\\.net/sdk\\.js$' }),
  authoriseWith: {
    matcher: createMatcher({ hashes: [{ timestamp: new Date('2026-08-01T00:00:00.000Z'), hash: { value: 'a'.repeat(64) } as SHA256Hash }] }),
    authorisationInfo: { description: 'Payment SDK pinned by hash', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
  },
})

/** Fixture inventory for target 1.0: covers the CDN SDK, never the skimmer. */
const makeInventory = (): Inventory => ({
  fileName: '1.0.json',
  target: {
    inventory: { type: 'inventory', url: 'https://staging.pay.example.com/checkout', workflow: { fileName: 'rum-tripwire-workflow.json', definition: { steps: [] } }, logger: silentLogger },
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
  scripts: [coveredCdnEntry()],
  headers: [],
})

/**
 * One drain run over the given raw queue bodies: fresh alert capture, fresh
 * comparison service, and — unless the caller passes one to model a duplicate
 * within the same run — a fresh per-run `seen` set (new-run semantics).
 */
const drainRun = async (bodies: string[], seen: Set<string> = new Set(), extraScripts: InventoryScriptInfo[] = []) => {
  const { alerts, service } = makeCapturingAlertService()
  const inventory = makeInventory()
  inventory.scripts.push(...extraScripts)
  const source = new InMemoryQueueSource(bodies.map((body, index) => ({ id: `msg-${index}`, body })))
  const outcomes: RumRouteOutcome[] = []

  const counts = await drainQueue(source, async (message) => {
    const outcome = await routeDetectionMessage(normaliseMessage(message), {
      scriptComparison: new ScriptComparisonService(),
      alertService: service,
      inventory,
      target: detectionTarget,
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
// Tests
// ---------------------------------------------------------------------------

describe('RUM tripwire end-to-end: collector → queue → drain → real comparison → alert', () => {
  describe('collector ingest of the unknown-script beacon', () => {
    it('returns 204, archives the beacon verbatim, and enqueues exactly one first-sighting message keyed on the novelty pk', async () => {
      const harness = makeCollectorHarness()
      const rawBeacon = fixture('external-unknown.json')

      const result = await harness.post(rawBeacon)

      expect(result).toEqual({ statusCode: 204, body: '' })

      expect(harness.archived).toHaveLength(1)
      const archived = JSON.parse(harness.archived[0]!)
      expect(archived.beacon).toEqual(JSON.parse(rawBeacon))
      expect(archived.stamp).toEqual({ target_id: '1.0', target_type: 'detection', received_at: NOW })

      expect(harness.queueMessages).toHaveLength(1)
      const message = JSON.parse(harness.queueMessages[0]!.body)
      expect(message.novelty.pk).toBe(SKIMMER_PK)
      expect(message.target_id).toBe('1.0')
      expect(message.target_type).toBe('detection')
      expect(message.observation.url).toBe(SKIMMER_URL)
    })

    it('re-posting the same beacon updates the novelty counters without enqueueing a second message', async () => {
      const harness = makeCollectorHarness()
      const rawBeacon = fixture('external-unknown.json')

      await harness.post(rawBeacon)
      await harness.post(rawBeacon)

      // The conditional write failed on the repeat, so the UpdateItem path ran
      // instead — counters move, the queue does not.
      expect(harness.queueMessages).toHaveLength(1)
      expect(harness.counterUpdates).toEqual([{ pk: SKIMMER_PK, lastSeen: NOW }])
      expect(harness.noveltyStore.get(SKIMMER_PK)?.sessions).toBe(2)
      expect(harness.noveltyStore.get(SKIMMER_PK)?.last_seen).toBe(NOW)
    })
  })

  describe('detection-lane drain of the captured queue message', () => {
    it('alerts rum_uninventoried_script_detected exactly once with observation identity, provenance, and inventory ref — and deletes the message only after routing', async () => {
      const harness = makeCollectorHarness()
      await harness.post(fixture('external-unknown.json'))

      const { counts, alerts, source, outcomes } = await drainRun(harness.queueMessages.map((message) => message.body))

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted'])

      expect(alerts).toHaveLength(1)
      const { category, context } = alerts[0]!
      expect(category).toBe('rum_uninventoried_script_detected')
      expect(context.observation).toEqual({ kind: 'external-script', identity: SKIMMER_URL, initiator: 'https://pay.example.com/checkout' })
      expect(context.first_route).toBe('/checkout')
      expect(context.prevalence.first_seen).toBe(NOW)
      expect(context.targetType).toBe('detection')
      expect(context.inventoryRef).toBe(INVENTORY_REF)

      // Delete-after-route discipline: routed → deleted, nothing dead-lettered.
      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })

    it('routes a beacon for the covered CDN script as recorded — zero alerts (identification-only for external scripts)', async () => {
      // Built in-test from the canonical fixture's external observation, which
      // points at the URL the fixture inventory covers by nameMatcher.
      const canonical = JSON.parse(fixture('canonical.json')) as Beacon
      const externalObservation = canonical.observations.find((observation) => observation.kind === 'external-script')!
      expect(externalObservation).toMatchObject({ kind: 'external-script', url: COVERED_URL })
      const coveredBeacon: Beacon = { ...canonical, observations: [externalObservation] }

      const harness = makeCollectorHarness()
      await harness.post(JSON.stringify(coveredBeacon))
      // Accepted by the same parseBeacon gate as the unknown-script beacon.
      expect(harness.queueMessages).toHaveLength(1)

      const { counts, alerts, source, outcomes } = await drainRun(harness.queueMessages.map((message) => message.body))

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
      expect(alerts).toHaveLength(0)
      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })
  })

  describe('authorised inline script via client-computed hash (evidence-aware, T029 pulled forward)', () => {
    /** Hash carried by the inline-valid.json fixture beacon. */
    const INLINE_HASH = 'e6fd3e32432da11443aadf6bd83d5464588956cec02521e635d56f11f7bfcffb'

    const authorisedInlineEntry = (): InventoryScriptInfo => ({
      identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
      authoriseWith: {
        matcher: createMatcher({ hashes: [{ timestamp: new Date('2026-08-01T00:00:00.000Z'), hash: { value: INLINE_HASH } as SHA256Hash }] }),
        authorisationInfo: { description: 'Tag-manager bootstrap pinned by hash', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      },
    })

    it('routes the observation as recorded with zero alerts — the hash is compared even though content never travels', async () => {
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-valid.json'))
      expect(harness.queueMessages).toHaveLength(1)

      const { counts, alerts, source, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        new Set(),
        [authorisedInlineEntry()],
      )

      expect(counts).toEqual({ received: 1, routed: 1, invalid: 0, failed: 0 })
      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['recorded'])
      expect(alerts).toHaveLength(0)
      expect(source.deleted).toEqual(['msg-0'])
      expect(source.deadLettered).toEqual([])
    })

    it('alerts rum_mismatched_script_detected with a hash-mismatch reason when the inventory authorises a different hash', async () => {
      const tamperedEntry: InventoryScriptInfo = {
        identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
        authoriseWith: {
          matcher: createMatcher({ hashes: [{ timestamp: new Date('2026-08-01T00:00:00.000Z'), hash: { value: 'f'.repeat(64) } as SHA256Hash }] }),
          authorisationInfo: { description: 'Different pinned hash', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
        },
      }
      const harness = makeCollectorHarness()
      await harness.post(fixture('inline-valid.json'))

      const { alerts, outcomes } = await drainRun(
        harness.queueMessages.map((message) => message.body),
        new Set(),
        [tamperedEntry],
      )

      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted'])
      expect(alerts).toHaveLength(1)
      expect(alerts[0]!.category).toBe('rum_mismatched_script_detected')
      expect(alerts[0]!.context.failureReason).toContain('not in authorized list')
    })
  })

  describe('idempotency boundaries', () => {
    it('a re-delivered copy alerts again in a fresh run, but a duplicate within one run is suppressed', async () => {
      const harness = makeCollectorHarness()
      await harness.post(fixture('external-unknown.json'))
      const body = harness.queueMessages[0]!.body

      // Fresh run over a re-delivered copy (new seen set = new-run semantics):
      // the alert fires again by design. Routing is stateless per message —
      // cross-run dedupe is owned by the novelty store, which only enqueues a
      // pk on its first sighting; the comparator never suppresses across runs
      // so that DLQ redrive replays produce the same outcome.
      const runOne = await drainRun([body])
      const runTwo = await drainRun([body])

      expect(runOne.alerts).toHaveLength(1)
      expect(runTwo.alerts).toHaveLength(1)
      expect(runTwo.alerts[0]).toEqual(runOne.alerts[0])

      // Same run, duplicate delivery (SQS is at-least-once): the second copy
      // is suppressed by the in-run (novelty pk, inventory ref) dedupe key,
      // yet still counted routed and deleted — a suppressed duplicate is a
      // delivered outcome, not a failure.
      const sameRun = await drainRun([body, body])

      expect(sameRun.alerts).toHaveLength(1)
      expect(sameRun.outcomes.map((outcome) => outcome.outcome)).toEqual(['alerted', 'duplicate-suppressed'])
      expect(sameRun.counts).toEqual({ received: 2, routed: 2, invalid: 0, failed: 0 })
      expect(sameRun.source.deleted).toEqual(['msg-0', 'msg-1'])
    })
  })
})
