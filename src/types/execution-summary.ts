import { ExecutionMode } from './config.js'

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

/** How the run went, derived from which targets succeeded and which failed. */
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

/** Classify a run from its per-target results. */
export function getExecutionOutcome(summary: Pick<ExecutionSummary, 'targetsProcessed' | 'targetsFailed'>): ExecutionOutcome {
  const failed = summary.targetsFailed?.length ?? 0
  if (failed === 0) return 'success'
  return summary.targetsProcessed.length === 0 ? 'failure' : 'partial'
}
