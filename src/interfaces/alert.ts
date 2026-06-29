import type { ComparisonResultType } from '../types/comparison.js'
import type { ExecutionSummary } from '../types/execution-summary.js'
import type { InventoryAlert } from '../types/inventory/model.js'
import type { Target } from '../types/target.js'

export interface IAlertService {
  /**
   * Send violation alerts for a batch of typed comparison results.
   *
   * @param inventoryUpdatedResults - Optional set of results that translated
   *   into an actual inventory mutation during diff. When provided (inventory
   *   mode), `known_*_unauthorised_content` results in this set are reported
   *   as "Inventory updated"; those not in the set are reported as needing
   *   manual review because the diff intentionally did not auto-update (e.g.
   *   AndMatcher entries, non-hash/content authorisers). When omitted
   *   (detection mode), all results are surfaced via their detection-mode
   *   message regardless.
   */
  alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert, inventoryUpdatedResults?: ReadonlySet<ComparisonResultType>): Promise<void>

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

  /**
   * Override the URL used for the "Review changes" button in inventory-mode
   * alerts. Set this to the auto-opened PR URL so reviewers land on the PR
   * (with diff + validate CI gate) instead of GitHub's "create PR" page.
   *
   * Pass `null` to clear the override (alerts fall back to a branch-compare
   * URL). Implementations that don't render review buttons (console) may
   * implement this as a no-op.
   */
  setReviewUrl(url: string | null): void
}

export type PullRequestFailureContext = Readonly<{
  error: unknown
  repoUrl: string
  headBranch: string
  baseBranch: string
}>
