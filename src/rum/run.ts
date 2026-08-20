import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { IAlertService } from '../interfaces/alert.js'
import type { IScriptComparisonService } from '../interfaces/comparison.js'
import type { IInventoryService } from '../interfaces/inventory.js'
import type { RumAlertCategory } from '../types/alert.js'
import { getInventoryWorkflows, type Inventory } from '../types/inventory/model.js'
import { PullTarget, type Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import { drainQueue, type QueueSource } from './drain.js'
import { normaliseMessage } from './normalise.js'
import { routeDetectionMessage } from './route.js'

/**
 * `--mode rum-compare` runner (feature 011, contracts/cli-rum-compare.md).
 *
 * Deliberately a plain function over injected services rather than logic
 * inlined in main.ts: the integration test (T024) drives exactly this entry
 * point with a file:// queue and a fixture inventory, and main.ts stays a
 * thin dispatch that builds the real services the same way every other mode
 * does.
 */

/** One pass's resolved routing context for a `target_id`. */
export type RumTargetContext = {
  inventory: Inventory
  target: Target
  /** Ref the pass's comparisons are judged against (SHA, or branch fallback). */
  inventoryRef: string
}

export type RumCompareDeps = {
  inventoryService: IInventoryService
  scriptComparison: IScriptComparisonService
  alertService: IAlertService
  queueSource: QueueSource
  branches: { inventory: string; detection: string }
  /** Directory for the run-summary artefact, or null when reporting is off. */
  reportDir: string | null
  log: Logger
}

/** The inventory revision one pass read, as recorded in the run summary. */
export type RumPassRef = {
  branch: string
  /** Null when the store could not report a commit (e.g. non-Git fixture). */
  commitSha: string | null
}

export type RumCompareSummary = {
  /** Queue messages received this run (including invalid and failed ones). */
  processed: number
  /** Messages whose outcome was routed (deleted from the queue). */
  routed: number
  /** Messages dead-lettered before routing (unparseable / schema-invalid). */
  invalid: number
  /** Messages dead-lettered or left for redelivery after a handler failure. */
  failed: number
  /** Messages naming a target_id neither pass's inventory knows (subset of failed). */
  unknownTargetIds: number
  outcomes: {
    alerted: number
    recorded: number
    recordedPending: number
    duplicateSuppressed: number
  }
  alertedByCategory: Partial<Record<RumAlertCategory, number>>
  /** Alerts that could not be delivered (routing still completed). */
  alertDeliveryFailures: number
  inventoryRefs: {
    inventory: RumPassRef
    detection: RumPassRef
  }
}

/**
 * Batches are capped so a queue that refills faster than we drain cannot pin
 * the scheduled run forever; anything left is picked up by the next hourly
 * run. 500 batches × 10 messages is far beyond any expected novelty volume.
 */
const MAX_BATCHES = 500

export async function runRumCompare(deps: RumCompareDeps): Promise<RumCompareSummary> {
  const { log } = deps

  // Load both passes' baselines exactly as the synthetic modes do: full
  // deserialization (Zod + createMatcher) via the inventory service. The
  // detection branch is what production observations are judged against; the
  // inventory branch is what inventory-pass observations will feed (T031).
  log.log('Pulling inventory for the detection pass.')
  const detectionInventories = await deps.inventoryService.pull(PullTarget.Detection, deps.branches.detection)
  const detectionRef = passRef(deps, deps.branches.detection)

  log.log('Pulling inventory for the inventory pass.')
  const inventoryInventories = await deps.inventoryService.pull(PullTarget.Inventory, deps.branches.inventory)
  const inventoryRef = passRef(deps, deps.branches.inventory)

  const contexts: Record<'inventory' | 'detection', Map<string, RumTargetContext>> = {
    detection: buildTargetContexts(detectionInventories, 'detection', detectionRef.commitSha ?? detectionRef.branch),
    inventory: buildTargetContexts(inventoryInventories, 'inventory', inventoryRef.commitSha ?? inventoryRef.branch),
  }

  const summary: RumCompareSummary = {
    processed: 0,
    routed: 0,
    invalid: 0,
    failed: 0,
    unknownTargetIds: 0,
    outcomes: { alerted: 0, recorded: 0, recordedPending: 0, duplicateSuppressed: 0 },
    alertedByCategory: {},
    alertDeliveryFailures: 0,
    inventoryRefs: { inventory: inventoryRef, detection: detectionRef },
  }

  // One dedupe set per drain run — the (novelty pk, inventory ref) idempotency
  // boundary routeDetectionMessage documents. Never reused across runs.
  const seen = new Set<string>()

  log.log('Draining the novel-observations queue.')
  const counts = await drainQueue(
    deps.queueSource,
    async (message) => {
      const context = contexts[message.target_type].get(message.target_id)
      if (context === undefined) {
        // An unknown target_id means the origin map and the inventory have
        // drifted. Dead-letter rather than delete: the message is evidence an
        // operator must see, not noise to discard.
        summary.unknownTargetIds++
        log.warn(`unknown target_id '${message.target_id}' (${message.target_type} pass) — no matching inventory target; dead-lettering for operator attention`)
        return 'skip-dlq'
      }

      const outcome = await routeDetectionMessage(normaliseMessage(message), {
        scriptComparison: deps.scriptComparison,
        alertService: deps.alertService,
        inventory: context.inventory,
        target: context.target,
        inventoryRef: context.inventoryRef,
        log,
        seen,
      })

      switch (outcome.outcome) {
        case 'alerted':
          summary.outcomes.alerted++
          if (outcome.category !== undefined) {
            summary.alertedByCategory[outcome.category] = (summary.alertedByCategory[outcome.category] ?? 0) + 1
          }
          break
        case 'recorded':
          summary.outcomes.recorded++
          break
        case 'recorded-pending':
          summary.outcomes.recordedPending++
          break
        case 'duplicate-suppressed':
          summary.outcomes.duplicateSuppressed++
          break
      }
      if (outcome.alertDeliveryFailed) summary.alertDeliveryFailures++

      return outcome.drain
    },
    { maxBatches: MAX_BATCHES },
  )

  summary.processed = counts.received
  summary.routed = counts.routed
  summary.invalid = counts.invalid
  summary.failed = counts.failed

  logSummary(summary, log)
  await writeSummaryArtefact(summary, deps.reportDir, log)

  return summary
}

/** Snapshot the ref of the pull that just completed. */
function passRef(deps: RumCompareDeps, branch: string): RumPassRef {
  const ref = deps.inventoryService.getLastPullRef()
  return { branch: ref?.branch ?? branch, commitSha: ref?.commitSha ?? null }
}

/**
 * Map every name a queue message's `target_id` may legitimately carry to the
 * routing context for one pass. A target is addressable by its inventory file
 * name (e.g. `1.0` from `1.0.json`) and by any named workflow variation —
 * the same identifiers `--target` accepts. First registration wins, matching
 * the first-match-wins convention used throughout comparison.
 */
export function buildTargetContexts(inventories: Inventory[], pass: 'inventory' | 'detection', inventoryRef: string): Map<string, RumTargetContext> {
  const contexts = new Map<string, RumTargetContext>()

  for (const inventory of inventories) {
    const fileKey = inventory.fileName.replace(/\.json$/, '')
    for (const workflow of getInventoryWorkflows(inventory.target)) {
      const target = pass === 'inventory' ? workflow.inventory : workflow.detection
      const context: RumTargetContext = { inventory, target, inventoryRef }
      if (!contexts.has(fileKey)) contexts.set(fileKey, context)
      if (target.name !== undefined && !contexts.has(target.name)) contexts.set(target.name, context)
    }
  }

  return contexts
}

function logSummary(summary: RumCompareSummary, log: Logger): void {
  log.log(`RUM run summary: processed=${summary.processed} routed=${summary.routed} invalid=${summary.invalid} failed=${summary.failed} (unknown target_ids: ${summary.unknownTargetIds})`)
  log.log(`RUM outcomes: alerted=${summary.outcomes.alerted} recorded=${summary.outcomes.recorded} recorded-pending=${summary.outcomes.recordedPending} duplicate-suppressed=${summary.outcomes.duplicateSuppressed}`)
  for (const [category, count] of Object.entries(summary.alertedByCategory)) {
    log.log(`RUM alerts (${category}): ${count}`)
  }
  if (summary.alertDeliveryFailures > 0) {
    log.error(`RUM alert delivery failures: ${summary.alertDeliveryFailures} alert(s) could not be delivered (messages were still routed)`)
  }
  log.log(
    `RUM inventory refs: detection=${summary.inventoryRefs.detection.commitSha ?? '(no SHA)'} on ${summary.inventoryRefs.detection.branch}, inventory=${summary.inventoryRefs.inventory.commitSha ?? '(no SHA)'} on ${summary.inventoryRefs.inventory.branch}`,
  )
}

/**
 * Persist the run summary under `--report-dir` as
 * `rum-compare/rum-summary.json`.
 *
 * Deliberately not routed through the auditor ReportService: that pipeline is
 * a census of comparison results fed per synthetic target run, while this is
 * a queue-drain tally. Like the auditor report, a write failure is logged and
 * never fails the run — the summary already reached the log.
 */
async function writeSummaryArtefact(summary: RumCompareSummary, reportDir: string | null, log: Logger): Promise<void> {
  if (reportDir === null) return

  const path = join(reportDir, 'rum-compare', 'rum-summary.json')
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify({ ...summary, completedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    log.log(`RUM run summary written: ${path}`)
  } catch (error) {
    log.error(`Failed to write the RUM run summary (the run continues): ${error instanceof Error ? error.message : String(error)}`)
  }
}
