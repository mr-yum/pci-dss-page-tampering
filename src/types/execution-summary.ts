import { ExecutionMode } from './config.js'
import type { UnansweredRequestRecord, UnreadScriptRecord } from './script.js'

/** Which pass of a run a target belongs to. */
export type ExecutionPass = 'inventory' | 'detection'

/**
 * A target whose workflow did not complete, so the run holds no observations
 * for it. Named individually: a run summary that only says "1 failed" sends a
 * reader to the logs to learn which payment page went unmonitored.
 */
export type FailedTarget = {
  /** Display name of the target (its configured name, or `<file>/<workflow>`). */
  name: string
  pass: ExecutionPass
  /** The error message, already redacted for display. */
  reason: string
}

/**
 * An alert the run produced but could not deliver.
 *
 * Counted, not swallowed: Slack answers a rejected payload with HTTP 200 and
 * `ok: false`, and a finding whose alert never arrived is an unmonitored
 * finding as far as the operator can tell. The run summary names these and
 * the process exits non-zero for them, exactly as for a failed target.
 */
export type AlertDeliveryFailure = {
  /** What was being sent, e.g. `unauthorised header alert`. */
  alert: string
  /** The target the alert concerned, or null for run-level notices. */
  target: string | null
  /** The delivery error, already redacted for display. */
  reason: string
}

/**
 * A script that arrived during a target run but whose body could not be read,
 * so it was neither hashed nor compared.
 *
 * Named, not counted, for the same reason as a failed target: the reader has
 * to learn *which* script on *which* page went unexamined. One in payment
 * scope degrades the run exactly as a failed target does — the payment page
 * was not fully monitored — while one on an earlier page the payment page
 * replaced is listed for evidence only.
 */
export type UnreadScriptEntry = UnreadScriptRecord & {
  /** Display name of the target (its configured name, or `<file>/<workflow>`). */
  target: string
  pass: ExecutionPass
  /** True only for a script attributed to an earlier page the payment page replaced. */
  outsidePaymentPage: boolean
}

/**
 * A script request a target run issued that never got a response, so the
 * script never ran on the page. Named in the run summary because the request
 * itself deserves a look — a URL the page built wrongly, or a host that has
 * stopped answering — but never counted against the run: nothing ran that
 * went unexamined. See `UnansweredScriptRequest`.
 */
export type UnansweredRequestEntry = UnansweredRequestRecord & {
  /** Display name of the target (its configured name, or `<file>/<workflow>`). */
  target: string
  pass: ExecutionPass
  /** True only for a request attributed to an earlier page the payment page replaced. */
  outsidePaymentPage: boolean
}

/** The unread scripts that count against the run: all but those on an earlier page the payment page replaced. */
export function unreadInPaymentScope(entries: readonly UnreadScriptEntry[] | undefined): UnreadScriptEntry[] {
  return (entries ?? []).filter((entry) => !entry.outsidePaymentPage)
}

/** How the run went, derived from which targets succeeded, which failed, and what could not be alerted. */
export type ExecutionOutcome = 'success' | 'partial' | 'failure'

/**
 * Summary of a completed run for the end-of-run notification.
 * Contains all information needed for audit trail confirmation (FR-002 through FR-007).
 *
 * "Completed" is not "succeeded": a run in which some targets failed still
 * completes, still monitors the targets that worked, and still sends this
 * summary — naming the failures — before exiting non-zero.
 */
export type ExecutionSummary = {
  /** Workflow execution mode (inventory, detection, or all) */
  mode: ExecutionMode

  /** Names of targets whose workflow completed and whose findings were evaluated */
  targetsProcessed: string[]

  /**
   * Targets whose workflow failed, in the order they were attempted.
   * Omitted or empty on a clean run.
   */
  targetsFailed?: FailedTarget[]

  /**
   * Alerts the run produced but could not deliver, in the order they failed.
   * Omitted or empty on a clean run.
   */
  alertsUndelivered?: AlertDeliveryFailure[]

  /**
   * Scripts whose body could not be read, in and outside payment scope, in
   * the order they were recorded. Omitted or empty when every script was read.
   */
  scriptsUnread?: UnreadScriptEntry[]

  /**
   * Script requests that never got a response, in and outside payment scope,
   * in the order they were recorded. Evidence only: they never change the
   * outcome (see `getExecutionOutcome`). Omitted or empty when none.
   */
  requestsUnanswered?: UnansweredRequestEntry[]

  /** Git repository URL that was monitored */
  repositoryUrl: string

  /** Git branch used for inventory workflow (null if not executed) */
  inventoryBranch: string | null

  /** Git branch used for detection workflow (null if not executed) */
  detectionBranch: string | null

  /** Total count of resources monitored (scripts + headers) across all targets */
  resourceCount: number

  /** Timestamp when workflow completed successfully */
  completedAt: Date

  /** Optional: Milliseconds from start to completion (P3 enhancement) */
  executionDuration?: number | null

  /**
   * Where the auditor report for this run can be found, when one was produced.
   *
   * Null when `--report-dir` was not supplied.
   */
  auditorReport?: AuditorReportLocation | null
}

/**
 * Pointer to the auditor report a run produced.
 *
 * Under GitHub Actions this is the *run page*, not a direct artifact link. The
 * artifact is uploaded by a later workflow step, so at the moment this
 * notification is sent it does not exist yet and has no URL. The run page is
 * also the better destination: it lists the artifact for download and renders
 * the job-summary digest of findings inline.
 */
export type AuditorReportLocation = {
  /** GitHub Actions run page, or null outside CI. */
  runUrl: string | null
  /** Absolute paths written, for local runs and for the console alerter. */
  htmlPaths: string[]
}

/**
 * Validates ExecutionSummary for mode-branch consistency.
 * @throws Error if validation fails
 */
export function validateExecutionSummary(summary: ExecutionSummary): void {
  // Mode-branch consistency
  if (summary.mode === ExecutionMode.Inventory && (summary.inventoryBranch === null || summary.detectionBranch !== null)) {
    throw new Error('ExecutionSummary validation failed: inventory mode requires inventoryBranch only')
  }
  if (summary.mode === ExecutionMode.Detection && (summary.detectionBranch === null || summary.inventoryBranch !== null)) {
    throw new Error('ExecutionSummary validation failed: detection mode requires detectionBranch only')
  }
  if (summary.mode === ExecutionMode.All && (summary.inventoryBranch === null || summary.detectionBranch === null)) {
    throw new Error('ExecutionSummary validation failed: all mode requires both branches')
  }

  // Non-empty targets: a run that attempted nothing has nothing to summarise.
  // A run in which every target failed is still summarised — that is the run
  // the reader most needs to hear about.
  if (summary.targetsProcessed.length === 0 && (summary.targetsFailed?.length ?? 0) === 0) {
    throw new Error('ExecutionSummary validation failed: targetsProcessed cannot be empty unless targetsFailed names what was attempted')
  }

  // Valid resource count
  if (summary.resourceCount < 0) {
    throw new Error('ExecutionSummary validation failed: resourceCount must be non-negative')
  }

  // No future timestamps
  if (summary.completedAt > new Date()) {
    throw new Error('ExecutionSummary validation failed: completedAt cannot be in the future')
  }

  // Duration consistency (optional)
  if (summary.executionDuration !== undefined && summary.executionDuration !== null && summary.executionDuration <= 0) {
    throw new Error('ExecutionSummary validation failed: executionDuration must be positive if provided')
  }
}

/**
 * Classify a run from its per-target results, its alert deliveries and the
 * scripts it could not read.
 *
 * A run is a success only when every target completed, every alert it
 * produced was delivered, AND every script in payment scope was read. An
 * undelivered alert degrades it to partial, since the finding exists but
 * nobody was told; so does an unread payment-page script, since something
 * ran on the payment page that nobody examined.
 */
export function getExecutionOutcome(summary: Pick<ExecutionSummary, 'targetsProcessed' | 'targetsFailed' | 'alertsUndelivered' | 'scriptsUnread'>): ExecutionOutcome {
  const failed = summary.targetsFailed?.length ?? 0
  const undelivered = summary.alertsUndelivered?.length ?? 0
  const unread = unreadInPaymentScope(summary.scriptsUnread).length
  if (failed === 0 && undelivered === 0 && unread === 0) return 'success'
  if (failed > 0 && summary.targetsProcessed.length === 0) return 'failure'
  return 'partial'
}
