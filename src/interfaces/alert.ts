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
   * @param alertDestinations - Inventory alert configuration (selects destination based on summary.mode)
   *
   * Behavior:
   * - Selects alert destination based on summary.mode:
   *   - ExecutionMode.Inventory → alertDestinations.inventory.newScriptIdentified
   *   - ExecutionMode.Detection → alertDestinations.detection.newScriptDetected
   *   - ExecutionMode.All → alertDestinations.detection.newScriptDetected (production priority)
   * - Formats success message with execution details
   * - Error handling: Errors logged to console, method returns normally (non-blocking per FR-009)
   */
  alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void>
}
