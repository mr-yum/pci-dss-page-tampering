import type { RumAlertCategory, RumAlertContext } from '../types/alert.js'
import type { ComparisonResultType } from '../types/comparison.js'
import type { AlertDeliveryFailure, ExecutionSummary } from '../types/execution-summary.js'
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
   * Send one real-user monitoring alert (feature 011, `--mode rum-compare`).
   *
   * Separate from `alertForTypedResults` because a RUM alert is about a single
   * observation the tool never fetched — the context carries the observation
   * identity, prevalence snapshot, first-seen route, and the inventory commit
   * it was judged against instead of a typed comparison result.
   *
   * The destination is resolved per category from `alertDestinations.rum`,
   * falling back to the analogous synthetic detection destination
   * (see resolveRumAlertDestination in ../services/alert/rum.js).
   *
   * Implementations may throw on delivery failure; the RUM router catches,
   * logs, and counts the failure — an alert failure never blocks routing.
   */
  alertForRumObservation(category: RumAlertCategory, context: RumAlertContext, alertDestinations: InventoryAlert): Promise<void>

  /**
   * Summarise a completed run: which targets were monitored, which failed and
   * why, and where the evidence is.
   *
   * Sent at the end of every run that attempted at least one target — clean,
   * partially failed, or failed on every target. A partial run is the one this
   * message matters most for: the per-finding alerts only speak for the targets
   * that completed, so this is the only place a reader learns that a payment
   * page went unmonitored. Implementations must make the outcome unmistakable
   * in the headline and name each failed target with its pass and reason.
   *
   * @param summary - Aggregated execution context (mode, targets succeeded and failed, branches, counts, timestamp)
   * @param alertDestinations - Inventory alert configuration containing the successNotification destination
   *
   * Behavior:
   * - Uses alertDestinations.successNotification for all modes and all outcomes (Feature 010)
   * - Error handling: Errors logged to console, method returns normally (non-blocking)
   */
  alertOnRunCompletion(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void>

  /**
   * Alerts this service tried to send and could not, in order.
   *
   * The per-finding alert paths of the synthetic passes swallow their own
   * delivery errors so one bad message cannot block the next; this is where
   * those errors are kept so the run can still account for them — in the run
   * summary and in its exit code. A finding whose alert never arrived must not
   * leave the run looking clean. The RUM lane is different by design: its
   * alerts propagate delivery errors to the router, which counts them in its
   * own summary and keeps draining, so they do not appear here.
   */
  getDeliveryFailures(): readonly AlertDeliveryFailure[]

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
