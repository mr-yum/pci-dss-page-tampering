import type { ComparisonResultType } from '../types/comparison'
import type { ExecutionSummary } from '../types/execution-summary'
import type { InventoryAlert } from '../types/inventory/model'
import type { Target } from '../types/target'

export interface IAlertService {
  alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void>

  /**
   * Alert for successful workflow execution.
   * Sends informational notification when workflows complete without errors.
   *
   * @param summary - Aggregated execution context (mode, targets, branches, counts, timestamp)
   * @param alertDestinations - Inventory alert configuration containing successNotification destination
   *
   * Behavior:
   * - Uses alertDestinations.successNotification for all modes (Feature 010)
   * - Routes to dedicated success destination separate from violation alerts
   * - Formats success message with execution details
   * - Error handling: Errors logged to console, method returns normally (non-blocking)
   */
  alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void>

  /**
   * Alert that the inventory push succeeded but the follow-up GitHub PR could
   * not be opened. Routed to the same inventory-review channel as
   * `newScriptIdentified` so operators can open the PR manually and keep the
   * compliance loop closed.
   *
   * Implementations should not throw on alert-delivery failures — the caller
   * is already planning to exit non-zero because the PR step itself failed,
   * and a broken Slack call should not replace the more useful error.
   */
  alertOnPullRequestFailure(context: PullRequestFailureContext, alertDestinations: InventoryAlert): Promise<void>
}

export type PullRequestFailureContext = Readonly<{
  error: unknown
  repoUrl: string
  headBranch: string
  baseBranch: string
}>
