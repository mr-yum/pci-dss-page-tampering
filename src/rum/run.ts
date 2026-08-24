import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { IAlertService } from '../interfaces/alert.js'
import type { IScriptComparisonService } from '../interfaces/comparison.js'
import type { IInventoryService } from '../interfaces/inventory.js'
import type { RumAlertCategory } from '../types/alert.js'
import type { UnknownScriptFound } from '../types/comparison/unknown-script-found.js'
import { getInventoryWorkflows, type Inventory, type InventoryAlert, type InventoryDifferenceResult } from '../types/inventory/model.js'
import { PullTarget, type Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import { drainQueue, type QueueSource } from './drain.js'
import { normaliseMessage } from './normalise.js'
import { routeMessage } from './route.js'

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
  /**
   * Opens (or reuses) the inventory pull request after a candidate push,
   * exactly as `--mode inventory` does — main.ts supplies a closure over
   * `ensureInventoryPullRequest` with the real coordinators, so the skip
   * conditions (file:// repos, non-GitHub hosts, same branch, no token) stay
   * in one place. Returns the PR URL, or null when skipped. A throw fails the
   * run (exit 2): the commit is already on the remote, so a missing PR is a
   * compliance gap an operator must see.
   */
  ensurePullRequest: (commitMessage: string, alertDestinations: InventoryAlert | null) => Promise<string | null>
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
    /** Inventory-pass messages routed to the candidate lane (US3). */
    candidate: number
    duplicateSuppressed: number
  }
  alertedByCategory: Partial<Record<RumAlertCategory, number>>
  /** Alerts that could not be delivered (routing still completed). */
  alertDeliveryFailures: number
  /** Inventory-candidate flow results for this run (US3, data-model §7). */
  candidates: {
    /** Candidate-lane messages per queue `target_id`. */
    byTarget: Record<string, number>
    /**
     * Pending entries the diff actually appended — candidates already covered
     * by an existing (authorised or pending) entry are deduplicated away, so
     * this can be lower than the candidate outcome tally.
     */
    entriesAppended: number
    /** Whether the appended entries were pushed to the inventory branch. */
    pushed: boolean
    /** PR opened/reused for the push, or null (not pushed, or PR skipped). */
    prUrl: string | null
  }
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
  // inventory branch is what inventory-pass observations feed. Pull order is
  // load-bearing: each pull re-clones, so pulling the inventory branch LAST
  // leaves the working clone checked out on it — the same clone state
  // `--mode inventory` pushes candidates from.
  log.log('Pulling inventory for the detection pass.')
  const detectionInventories = await deps.inventoryService.pull(PullTarget.Detection, deps.branches.detection)
  const detectionRef = passRef(deps, deps.branches.detection)

  log.log('Pulling inventory for the inventory pass.')
  // Same base semantics as --mode inventory: a missing inventory branch is
  // started from the detection branch, never a hardcoded default.
  const inventoryInventories = await deps.inventoryService.pull(PullTarget.Inventory, deps.branches.inventory, { baseBranchName: deps.branches.detection })
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
    outcomes: { alerted: 0, recorded: 0, candidate: 0, duplicateSuppressed: 0 },
    alertedByCategory: {},
    alertDeliveryFailures: 0,
    candidates: { byTarget: {}, entriesAppended: 0, pushed: false, prUrl: null },
    inventoryRefs: { inventory: inventoryRef, detection: detectionRef },
  }

  // One dedupe set per drain run — the (novelty pk, inventory ref) idempotency
  // boundary routeMessage documents. Never reused across runs.
  const seen = new Set<string>()

  // Candidates from the inventory lane, batched per inventory file so the
  // existing diff (which owns matcher generation and pending-entry
  // idempotency) runs exactly once per inventory after the drain — mirroring
  // how --mode inventory diffs the complete observation set per file.
  const candidatesByInventory = new Map<Inventory, UnknownScriptFound[]>()

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

      const outcome = await routeMessage(normaliseMessage(message), {
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
        case 'candidate': {
          summary.outcomes.candidate++
          summary.candidates.byTarget[message.target_id] = (summary.candidates.byTarget[message.target_id] ?? 0) + 1
          if (outcome.candidate !== undefined) {
            const pending = candidatesByInventory.get(context.inventory) ?? []
            pending.push(outcome.candidate)
            candidatesByInventory.set(context.inventory, pending)
          }
          break
        }
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

  // The candidate flow may legitimately fail (push conflict, PR creation) —
  // that must fail the run (exit 2, same as --mode inventory), but only after
  // the summary is logged and persisted: the drained messages are already
  // deleted from the queue, so the summary is the surviving evidence of what
  // was routed.
  let candidateFlowError: unknown = null
  try {
    await processCandidates(candidatesByInventory, summary, deps)
  } catch (error) {
    candidateFlowError = error
  }

  logSummary(summary, log)
  await writeSummaryArtefact(summary, deps.reportDir, log)

  if (candidateFlowError !== null) {
    throw candidateFlowError
  }

  return summary
}

/**
 * Feed the drained candidates through the EXISTING inventory-candidate flow:
 * `ScriptInventoryService.diff()` generates the matcher configs (exact-name
 * identification; hash authorisation when the observation carried one) and
 * skips scripts an existing entry — authorised or pending — already covers,
 * then push + PR run with the same branch semantics as `--mode inventory`
 * (commit to `--inventory-branch`, PR into `--detection-branch` for GitHub
 * HTTPS repos; file:// repos push without a PR).
 *
 * Nothing on this path authorises anything: appended entries are always
 * `authorised: false`, and no-op diffs (every candidate already covered)
 * produce no commit at all — `push` detects the absence of material change
 * and skips, which is what keeps repeat observations from re-opening PRs.
 */
async function processCandidates(candidatesByInventory: Map<Inventory, UnknownScriptFound[]>, summary: RumCompareSummary, deps: RumCompareDeps): Promise<void> {
  if (candidatesByInventory.size === 0) return

  const { log } = deps

  const diffs: InventoryDifferenceResult[] = []
  let alertDestinations: InventoryAlert | null = null
  for (const [inventory, candidates] of candidatesByInventory) {
    const diff = await deps.inventoryService.diff(inventory, candidates)
    summary.candidates.entriesAppended += diff.appliedResults?.length ?? 0
    diffs.push(diff)
    alertDestinations ??= inventory.alerts
  }

  log.log(`RUM inventory candidates: ${summary.outcomes.candidate} observation(s) produced ${summary.candidates.entriesAppended} pending entrie(s) after dedupe against existing coverage.`)

  const pushResult = await deps.inventoryService.push(diffs, deps.branches.inventory)
  summary.candidates.pushed = pushResult.pushed

  if (!pushResult.pushed) return

  log.log(`RUM inventory candidates pushed to '${deps.branches.inventory}'.`)
  summary.candidates.prUrl = await deps.ensurePullRequest(pushResult.commitMessage, alertDestinations)
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
  log.log(`RUM outcomes: alerted=${summary.outcomes.alerted} recorded=${summary.outcomes.recorded} candidate=${summary.outcomes.candidate} duplicate-suppressed=${summary.outcomes.duplicateSuppressed}`)
  for (const [category, count] of Object.entries(summary.alertedByCategory)) {
    log.log(`RUM alerts (${category}): ${count}`)
  }
  if (summary.outcomes.candidate > 0) {
    const perTarget = Object.entries(summary.candidates.byTarget)
      .map(([targetId, count]) => `${targetId}=${count}`)
      .join(' ')
    log.log(`RUM candidates: ${perTarget} | entries appended: ${summary.candidates.entriesAppended} | pushed: ${summary.candidates.pushed ? 'yes' : 'no'}${summary.candidates.prUrl === null ? '' : ` | PR: ${summary.candidates.prUrl}`}`)
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
