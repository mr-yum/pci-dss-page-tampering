import type { RumAlertCategory, RumAlertContext } from '../../types/alert.js'
import { RUM_ALERT_CATEGORIES } from '../../types/alert.js'
import type { AlertDestination, InventoryAlert } from '../../types/inventory/model.js'

/**
 * Resolves the destination for one RUM alert category from a target's
 * `alerts{}` config (data-model.md §8: same destinations mechanism as the
 * synthetic categories, configured per target).
 *
 * Fallback semantics mirror the existing optional detection categories
 * (`headerMismatchDetected ?? newHeaderDetected`): an unconfigured RUM
 * category routes to the closest synthetic detection destination rather than
 * silently dropping the alert — alerting must fail safe, not fail silent.
 *
 * - `rum_uninventoried_script_detected` → `rum.uninventoriedScriptDetected`
 *   falling back to `detection.newScriptDetected`
 * - `rum_mismatched_script_detected` → `rum.mismatchedScriptDetected`
 *   falling back to `detection.scriptMismatchDetected`
 * - `rum_csp_violation_reported` → `rum.cspViolationReported` falling back to
 *   `detection.headerMismatchDetected ?? detection.newHeaderDetected` (a CSP
 *   violation is a policy signal, so the header channels are the analogue)
 *
 * @throws {Error} on a category name outside {@link RUM_ALERT_CATEGORIES} —
 *   config-driven callers must fail loudly, never route to a guessed channel.
 */
export function resolveRumAlertDestination(alertDestinations: InventoryAlert, category: RumAlertCategory): AlertDestination {
  switch (category) {
    case 'rum_uninventoried_script_detected':
      return alertDestinations.rum?.uninventoriedScriptDetected ?? alertDestinations.detection.newScriptDetected
    case 'rum_mismatched_script_detected':
      return alertDestinations.rum?.mismatchedScriptDetected ?? alertDestinations.detection.scriptMismatchDetected
    case 'rum_csp_violation_reported':
      return alertDestinations.rum?.cspViolationReported ?? alertDestinations.detection.headerMismatchDetected ?? alertDestinations.detection.newHeaderDetected
    default: {
      // Exhaustiveness guard for typed callers; runtime rejection for untyped
      // (config-driven) category strings.
      const unknown: never = category
      throw new Error(`Unknown RUM alert category: ${String(unknown)} (expected one of: ${RUM_ALERT_CATEGORIES.join(', ')})`)
    }
  }
}

/** Human-readable alert title per RUM category, shared by Slack and console. */
export function rumAlertTitle(category: RumAlertCategory): string {
  switch (category) {
    case 'rum_uninventoried_script_detected':
      return 'Real-user monitoring: uninventoried script observed on a payment page!'
    case 'rum_mismatched_script_detected':
      return 'Real-user monitoring: known script failed authorisation (potential tampering)!'
    case 'rum_csp_violation_reported':
      return 'Real-user monitoring: CSP violation reported!'
  }
}

/**
 * Flattens a RUM alert context into labelled lines, shared by the console
 * service (verbatim) and the Slack service (one section per line). Keeping the
 * projection in one place means the two channels can never disagree about
 * which evidence an alert carries.
 */
export function rumAlertContextLines(category: RumAlertCategory, context: RumAlertContext): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [
    { label: 'Category', value: category },
    { label: 'Observation Kind', value: context.observation.kind },
    { label: 'Identity', value: context.observation.identity },
  ]

  if (context.observation.initiator !== undefined) lines.push({ label: 'Initiator', value: context.observation.initiator })
  if (context.observation.hash !== undefined) lines.push({ label: 'Hash (client-computed SHA-256)', value: context.observation.hash })

  lines.push({ label: 'First Seen', value: new Date(context.prevalence.first_seen).toISOString() })
  if (context.prevalence.last_seen !== undefined) lines.push({ label: 'Last Seen', value: new Date(context.prevalence.last_seen).toISOString() })
  if (context.prevalence.sessions !== undefined) lines.push({ label: 'Sessions', value: String(context.prevalence.sessions) })

  lines.push({ label: 'First Route', value: context.first_route })
  lines.push({ label: 'Target Type', value: context.targetType })
  lines.push({ label: 'Inventory Ref', value: context.inventoryRef })

  if (context.matcherDescription !== undefined) lines.push({ label: 'Authorisation Matcher', value: context.matcherDescription })
  if (context.failureReason !== undefined) lines.push({ label: 'Failure Reason', value: context.failureReason })

  return lines
}
