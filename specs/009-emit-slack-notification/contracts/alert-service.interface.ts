/**
 * Contract: IAlertService Interface Extension for Success Notifications
 *
 * This contract defines the new method signature added to IAlertService
 * to support success execution notifications.
 *
 * Location: src/interfaces/alert.ts
 */

import type { ComparisonResultType } from '../../types/comparison'
import type { ExecutionSummary } from '../../types/execution-summary'
import type { InventoryAlert } from '../../types/inventory/model'
import type { Target } from '../../types/target'

export interface IAlertService {
  /**
   * EXISTING METHOD: Alert for typed comparison results (scripts/headers).
   * Handles violation alerts during inventory and detection workflows.
   */
  alertForTypedResults(
    comparisonResults: ComparisonResultType[],
    target: Target,
    alertDestinations: InventoryAlert
  ): Promise<void>

  /**
   * NEW METHOD: Alert for successful workflow execution.
   * Sends informational notification when workflows complete without errors.
   *
   * @param summary - Aggregated execution context (mode, targets, branches, counts, timestamp)
   * @param alertDestinations - Inventory alert configuration (selects destination based on summary.mode)
   *
   * @throws Never - Errors logged to console, method returns normally (non-blocking per FR-009)
   *
   * Behavior:
   * - Selects alert destination based on summary.mode:
   *   - ExecutionMode.Inventory → alertDestinations.inventory.newScriptIdentified
   *   - ExecutionMode.Detection → alertDestinations.detection.newScriptDetected
   *   - ExecutionMode.All → alertDestinations.detection.newScriptDetected (production priority)
   * - Formats success message with:
   *   - Green success emoji (🟢) for visual distinction from violation alerts (⚠️)
   *   - Execution mode, target list (truncated if > 5), repository URL, branches, resource count, timestamp
   * - SlackAlertService: Sends Slack Block Kit message
   * - ConsoleAlertService: Logs structured text to console
   * - Error handling: Wrap in try-catch at invocation site (main.ts), log error, continue execution
   */
  alertOnSuccess(
    summary: ExecutionSummary,
    alertDestinations: InventoryAlert
  ): Promise<void>
}

/**
 * Implementation Notes:
 *
 * 1. SlackAlertService.alertOnSuccess():
 *    - Validate summary (mode-branch consistency, non-empty targets)
 *    - Select destination based on summary.mode
 *    - Format Slack Block Kit payload:
 *      - Title: "🟢 Workflow Execution Completed Successfully"
 *      - Metadata sections: mode, targets, repository, branch(es), resource count, timestamp
 *      - Truncate target list if > 5: "target1, target2, target3, and 2 more"
 *      - Branch display for mode=all: "updates/scripts (inventory), main (detection)"
 *    - Send message via axios to Slack API
 *    - Catch errors, log to console with [Alert Error] prefix
 *
 * 2. ConsoleAlertService.alertOnSuccess():
 *    - Parallel implementation for local testing
 *    - Log structured text with same information
 *    - Same validation and error handling
 *
 * 3. Invocation in main.ts:
 *    - After workflow completion (after inventory push or detection completion)
 *    - Construct ExecutionSummary from config and execution results
 *    - Get alert destinations from first processed inventory
 *    - Call alertService.alertOnSuccess(summary, alertDestinations)
 *    - Wrap in try-catch: log error on failure, continue to process.exit(ExitCode.Success)
 */
