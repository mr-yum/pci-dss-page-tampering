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
