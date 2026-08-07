import { ExecutionMode } from './config.js'

/**
 * Summary of completed workflow execution for success notifications.
 * Contains all information needed for audit trail confirmation (FR-002 through FR-007).
 */
export type ExecutionSummary = {
  /** Workflow execution mode (inventory, detection, or all) */
  mode: ExecutionMode

  /** Names of targets that were processed (from inventory filename or target.name) */
  targetsProcessed: string[]

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

  // Non-empty targets
  if (summary.targetsProcessed.length === 0) {
    throw new Error('ExecutionSummary validation failed: targetsProcessed cannot be empty')
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
