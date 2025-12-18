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
}
