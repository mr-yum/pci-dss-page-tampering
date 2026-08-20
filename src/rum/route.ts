import type { IAlertService } from '../interfaces/alert.js'
import type { IScriptComparisonService } from '../interfaces/comparison.js'
import type { RumAlertCategory, RumAlertContext } from '../types/alert.js'
import type { Inventory } from '../types/inventory/model.js'
import type { DetectedScript } from '../types/matcher/matcher.interface.js'
import type { Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { DrainOutcome } from './drain.js'
import type { NormalisedObservation, NormalisedScriptObservation } from './normalise.js'

/**
 * Detection-lane routing for real-user observations (data-model.md §7,
 * feature 011 US1).
 *
 * Idempotency boundary: routing is stateless per message — replaying the same
 * message through a fresh run produces the same outcome and the same alert.
 * Cross-run dedupe is the novelty store's job (an observation is enqueued
 * only on its first sighting). What routing DOES own is the run-level dedupe
 * demanded by the queue contract ("routing is idempotent on novelty.pk +
 * inventory ref"): a duplicate delivery within one drain run — SQS is
 * at-least-once — must not alert twice, so the caller supplies one `seen` set
 * per drain run and routing suppresses repeats of the same (pk, inventory
 * ref) pair inside it.
 */
export type RumRouteDeps = {
  scriptComparison: IScriptComparisonService
  alertService: IAlertService
  /** The pass's inventory: entries to compare against and alert destinations. */
  inventory: Inventory
  /** The pass's target — comparison results and alert routing both key on it. */
  target: Target
  /** Commit SHA of the inventory being judged against (SC-005). */
  inventoryRef: string
  log: Logger
  /**
   * In-run dedupe state, keyed by {@link rumDedupeKey}. Create one Set per
   * drain run; sharing it across runs would break the "same message, same
   * alert" replay contract that DLQ redrive relies on.
   */
  seen: Set<string>
}

export type RumRouteOutcome = {
  /** Always `'routed'`: every delivered outcome below releases the message. */
  drain: DrainOutcome
  /**
   * - `alerted`: an alert was dispatched (see `alertDeliveryFailed`).
   * - `recorded`: compliant or informational — logged, counted, no alert.
   * - `duplicate-suppressed`: same (pk, inventory ref) already routed this run.
   * - `recorded-pending`: inventory-lane stub — see routeDetectionMessage.
   */
  outcome: 'alerted' | 'recorded' | 'duplicate-suppressed' | 'recorded-pending'
  /** The alert category involved, when one applies. */
  category?: RumAlertCategory | undefined
  /**
   * True when the alert could not be delivered. The message is still routed —
   * alert failures never block (constitution) — but the run summary must be
   * able to report the miss.
   */
  alertDeliveryFailed: boolean
}

/** Run-level dedupe key: the queue contract's (novelty pk, inventory ref) pair. */
export const rumDedupeKey = (pk: string, inventoryRef: string): string => `${pk}@${inventoryRef}`

/**
 * Routes one normalised observation per the detection rows of data-model §7:
 *
 * - external script (identification-only, R8): identified → recorded, no
 *   authorisation attempt (content is unverifiable, so there is nothing an
 *   authorisation failure could truthfully assert); unidentified →
 *   `rum_uninventoried_script_detected`. Identification judges the script by
 *   its own URL (`Matchable.name`/`url`); the initiator travels only as
 *   alert provenance.
 * - inline script: full identify → authorise with whatever evidence exists.
 *   A client-computed hash IS evidence: matchers are evidence-aware, so an
 *   authorised hash authorises even though content is never transported.
 *   Unidentified → `rum_uninventoried_script_detected`; identified but
 *   unauthorised → `rum_mismatched_script_detected` with the matcher's
 *   failure reason; identified + authorised → recorded.
 * - CSP violation: recorded only — the category activates in phase 4 (T035).
 *
 * Inventory-pass messages are NOT dropped: they return a loud
 * `recorded-pending` stub until T031 lands the inventory-candidate lane.
 */
export async function routeDetectionMessage(normalised: NormalisedObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  if (normalised.rum.targetType === 'inventory') {
    // =====================================================================
    // T031 STUB — inventory lane not yet implemented.
    // The inventory-candidate flow (pending `authorised: false` entries via
    // InventoryService → PR) is T031's task. Until then the message is
    // acknowledged and counted, never dead-lettered: dropping it to the DLQ
    // would alarm operators about well-formed messages.
    // =====================================================================
    deps.log.log(`inventory lane not yet implemented (T031): recording observation ${normalised.rum.pk} as pending, no candidate produced`)
    return { drain: 'routed', outcome: 'recorded-pending', alertDeliveryFailed: false }
  }

  const key = rumDedupeKey(normalised.rum.pk, deps.inventoryRef)
  if (deps.seen.has(key)) {
    deps.log.log(`duplicate delivery within this drain run (${key}) — already routed, suppressing`)
    return { drain: 'routed', outcome: 'duplicate-suppressed', alertDeliveryFailed: false }
  }

  // The key is marked seen only AFTER the outcome is determined. Marking it
  // up front would let a throw mid-routing (message redelivered by the queue)
  // hit the has() suppression on the in-run redelivery — deleting the message
  // with no alert ever sent, and the novelty store silencing the pk for 90
  // days. Same reasoning for a failed alert delivery: leave the key unmarked
  // so an in-run redelivery retries the alert instead of suppressing it.
  const outcome = await routeScriptOrCsp(normalised, deps)
  if (!outcome.alertDeliveryFailed) {
    deps.seen.add(key)
  }
  return outcome
}

async function routeScriptOrCsp(normalised: NormalisedObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  if (normalised.kind === 'csp') {
    deps.log.log(`CSP violation recorded (alerting activates in phase 4 / T035): directive '${normalised.directive}' blocked '${normalised.blockedUri}' on route '${normalised.rum.firstRoute}'`)
    return { drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false }
  }

  return normalised.identificationOnly ? routeExternalScript(normalised, deps) : routeInlineScript(normalised, deps)
}

/** External scripts: identification-only (research R8). */
async function routeExternalScript(normalised: NormalisedScriptObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  const { matchable } = normalised
  const entry = deps.scriptComparison.identifyScript(matchable, deps.inventory.scripts)

  if (entry !== undefined) {
    deps.log.log(`external script '${matchable.name}' identified by ${entry.identifyWith.getDescription()} — recorded (identification-only: content is unverifiable client-side, no authorisation attempted)`)
    return { drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false }
  }

  return sendRumAlert('rum_uninventoried_script_detected', buildAlertContext(normalised, deps), deps)
}

/**
 * Inline scripts: identify, then authorise with the evidence the observation
 * actually carries. US1 keeps this minimal-but-correct:
 *
 * - hash present → the full comparison pipeline runs. Matchers are
 *   evidence-aware: a hash-based authoriser compares the client-computed
 *   hash and can authorise (or report a hash mismatch) even though content
 *   is never transported; matchers whose evidence is content (ContentMatcher,
 *   CspDirectiveMatcher) still fail secure with their own reason.
 * - hash absent (hashing unavailable or content oversize) → the observation
 *   carries no verifiable evidence at all, so an identified entry cannot be
 *   authorised: fail secure with an explicit reason, without asking matchers
 *   to evaluate evidence that does not exist.
 *
 * T029 refines the hash-absent branch with head/tail anchored-window matching.
 */
async function routeInlineScript(normalised: NormalisedScriptObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  const { matchable } = normalised
  const { hash } = matchable

  if (hash === undefined) {
    const entry = deps.scriptComparison.identifyScript(matchable, deps.inventory.scripts)
    if (entry === undefined) {
      return sendRumAlert('rum_uninventoried_script_detected', buildAlertContext(normalised, deps), deps)
    }

    const failureReason = 'inline script carried no hash (hashing unavailable or content oversize) and content is never transported — authorisation impossible, failing secure'
    deps.log.log(`inline script '${matchable.name}' identified by ${entry.identifyWith.getDescription()} but ${failureReason}`)
    return sendRumAlert('rum_mismatched_script_detected', buildAlertContext(normalised, deps, { failureReason, matcherDescription: entry.authoriseWith.matcher.getDescription() }), deps)
  }

  const detectedScript: DetectedScript = { ...matchable, hash }
  const result = deps.scriptComparison.compareScriptEvidence(detectedScript, deps.inventory.scripts, deps.target)

  switch (result.type) {
    case 'unknown_script_found':
      return sendRumAlert('rum_uninventoried_script_detected', buildAlertContext(normalised, deps), deps)
    case 'known_script_unauthorised_content':
      return sendRumAlert('rum_mismatched_script_detected', buildAlertContext(normalised, deps, { failureReason: result.failureReason, matcherDescription: result.authorizationMatcher.getDescription() }), deps)
    case 'authorized_script':
      deps.log.log(`inline script '${matchable.name}' identified and authorised — recorded`)
      return { drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false }
    default:
      // Header result types cannot come out of a script comparison; anything
      // else is a programming error — throw so the drain counts the message
      // failed and redelivers rather than silently deleting it.
      throw new Error(`unexpected comparison result type for RUM script: ${result.type}`)
  }
}

function buildAlertContext(normalised: NormalisedScriptObservation, deps: RumRouteDeps, failure?: { failureReason: string; matcherDescription: string }): RumAlertContext {
  const { matchable, rum } = normalised
  return {
    observation: {
      kind: normalised.identificationOnly ? 'external-script' : 'inline-script',
      identity: matchable.name,
      // Provenance comes from the rum context, not matchable.url — for
      // external scripts matchable.url is the script's own URL, not who
      // inserted it.
      ...(rum.initiator !== undefined ? { initiator: rum.initiator } : {}),
      ...(matchable.hash !== undefined ? { hash: matchable.hash.value } : {}),
    },
    // sessions / last_seen are unknown at drain time in US1: the queue
    // message is self-contained and the comparator never reads the novelty
    // store. They stay optional in the contract for when a counters snapshot
    // becomes available.
    prevalence: { first_seen: rum.firstSeen },
    first_route: rum.firstRoute,
    targetType: rum.targetType,
    inventoryRef: deps.inventoryRef,
    ...(failure !== undefined ? { failureReason: failure.failureReason, matcherDescription: failure.matcherDescription } : {}),
  }
}

async function sendRumAlert(category: RumAlertCategory, context: RumAlertContext, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  try {
    await deps.alertService.alertForRumObservation(category, context, deps.inventory.alerts)
    return { drain: 'routed', outcome: 'alerted', category, alertDeliveryFailed: false }
  } catch (error) {
    // Constitution: an alert-delivery failure never blocks routing — the
    // message is still released. The failure is logged and surfaced in the
    // outcome so the run summary can report it.
    deps.log.error(`failed to deliver ${category} alert for '${context.observation.identity}': ${error instanceof Error ? error.message : String(error)}`)
    return { drain: 'routed', outcome: 'alerted', category, alertDeliveryFailed: true }
  }
}
