import type { IAlertService } from '../interfaces/alert.js'
import type { IScriptComparisonService } from '../interfaces/comparison.js'
import type { RumAlertCategory, RumAlertContext } from '../types/alert.js'
import { UnknownScriptFound } from '../types/comparison/unknown-script-found.js'
import type { Inventory, InventoryAuthorisationInfo } from '../types/inventory/model.js'
import type { DetectedScript } from '../types/matcher/matcher.interface.js'
import type { Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { DrainOutcome } from './drain.js'
import type { NormalisedCspObservation, NormalisedObservation, NormalisedScriptObservation } from './normalise.js'

/**
 * Per-message routing for real-user observations (data-model.md §7,
 * feature 011 US1 + US3): the detection lane raises alerts, the inventory
 * lane produces pending inventory candidates.
 *
 * Idempotency boundary: routing is stateless per message — replaying the same
 * message through a fresh run produces the same outcome and the same alert.
 * Cross-run dedupe is the novelty store's job (an observation is enqueued
 * only on its first sighting). What routing DOES own is the run-level dedupe
 * demanded by the queue contract ("routing is idempotent on novelty.pk +
 * inventory ref"): a duplicate delivery within one drain run — SQS is
 * at-least-once — must not alert twice or mint two candidates, so the caller
 * supplies one `seen` set per drain run and routing suppresses repeats of the
 * same (pk, inventory ref) pair inside it.
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
   * - `candidate`: inventory lane — the observation is not positively covered
   *   by the inventory, so `candidate` below carries the typed result the
   *   caller must feed to the existing InventoryService candidate flow.
   */
  outcome: 'alerted' | 'recorded' | 'duplicate-suppressed' | 'candidate'
  /** The alert category involved, when one applies. */
  category?: RumAlertCategory | undefined
  /**
   * Present only when a `recorded` outcome was forced by an explicit gate —
   * today solely the `cspViolationReportedMinSessions` prevalence floor
   * (T035) — so the run summary can distinguish "compliant/informational"
   * from "would have alerted but was gated" and an operator can see why an
   * activated category stayed silent.
   */
  gatedReason?: string | undefined
  /**
   * True when the alert could not be delivered. The message is still routed —
   * alert failures never block (constitution) — but the run summary must be
   * able to report the miss.
   */
  alertDeliveryFailed: boolean
  /**
   * Inventory lane only (outcome `candidate`): the typed unknown-script
   * result for `ScriptInventoryService.diff()`. Routing deliberately does NOT
   * touch the inventory itself — the caller batches all candidates from one
   * drain and runs the existing diff → push → PR flow once, so matcher-config
   * generation and pending-entry idempotency stay in the one place that has
   * always owned them (data-model.md §7, FR-012).
   */
  candidate?: UnknownScriptFound | undefined
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
 *   A client-computed hash IS evidence, and so are the anchored head/tail
 *   windows (T028): matchers are evidence-aware, so an authorised hash — or
 *   a sound anchored-window content match — authorises even though full
 *   content is never transported.
 *   Unidentified → `rum_uninventoried_script_detected`; identified but
 *   unauthorised → `rum_mismatched_script_detected` with the matcher's
 *   failure reason; identified + authorised → recorded.
 * - CSP violation: opt-in per target (T035). The category alerts ONLY when
 *   the target's alert config explicitly provides
 *   `alerts.rum.cspViolationReported`; without it the violation is recorded
 *   and counted — the phase-1..3 behaviour, now the permanent default (the
 *   fallback chain never applies: extension noise would flood the header
 *   channels). An optional `cspViolationReportedMinSessions` floor further
 *   gates an activated category by available prevalence.
 *
 * Inventory-pass messages take the candidate lane instead (data-model §7,
 * US3): identified + authorised → recorded; anything the inventory does not
 * positively cover → a `candidate` outcome carrying an UnknownScriptFound for
 * the existing InventoryService candidate flow (pending `authorised: false`
 * entry, proposed via PR). The automated system never authorises anything —
 * candidates are explicitly unauthorised until a human approves them.
 */
export async function routeMessage(normalised: NormalisedObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
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
  const outcome = normalised.rum.targetType === 'inventory' ? routeInventoryMessage(normalised, deps) : await routeScriptOrCsp(normalised, deps)
  if (!outcome.alertDeliveryFailed) {
    deps.seen.add(key)
  }
  return outcome
}

/**
 * Inventory lane (data-model §7, US3): staging observations feed the
 * inventory-candidate flow instead of alerting.
 *
 * - identified + authorised (inline, via client-computed hash or anchored
 *   head/tail window evidence — T028), or identified at all for
 *   identification-only external scripts (research R8): recorded.
 * - everything the inventory does not positively cover — unidentified
 *   scripts, and inline scripts whose evidence fails (or cannot soundly
 *   satisfy) authorisation — becomes a candidate:
 *   an UnknownScriptFound the caller hands to ScriptInventoryService.diff(),
 *   which generates the matcher config (exact-name identification; hash
 *   authorisation when a hash exists) and enforces pending-entry idempotency.
 * - CSP observations: recorded only — a policy event is not an inventory
 *   resource, and `rum_csp_violation_reported` is a detection-lane category
 *   (FR-012 assigns alerting to the detection pass; the inventory pass feeds
 *   candidates), so even a target that opts in via
 *   `alerts.rum.cspViolationReported` (T035) alerts only on detection-pass
 *   observations.
 *
 * Fail-secure and human-gated: a candidate is always written with
 * `authorised: false`; nothing on this path can mark anything authorised.
 */
function routeInventoryMessage(normalised: NormalisedObservation, deps: RumRouteDeps): RumRouteOutcome {
  if (normalised.kind === 'csp') {
    deps.log.log(
      `CSP violation recorded on the inventory pass (never a candidate — a policy event is not an inventory resource): directive '${normalised.directive}' blocked '${normalised.blockedUri}' on route '${normalised.rum.firstRoute}'`,
    )
    return { drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false }
  }

  const { matchable } = normalised

  if (normalised.identificationOnly) {
    const entry = deps.scriptComparison.identifyScript(matchable, deps.inventory.scripts)

    if (entry !== undefined) {
      // External scripts are identification-only (research R8): identified IS
      // the whole check, same as the detection lane.
      deps.log.log(`inventory pass: external script '${matchable.name}' identified by ${entry.identifyWith.getDescription()} — recorded`)
      return { drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false }
    }

    deps.log.log(`inventory pass: external script '${matchable.name}' not identified by any inventory entry — proposing a pending candidate`)
    return buildCandidateOutcome(normalised, deps)
  }

  // Inline scripts always run the full evidence-aware comparison: a
  // client-computed hash when present, and anchored head/tail window content
  // evidence either way (T028) — so a hash-less (oversize / hashing
  // unavailable) observation can still be positively authorised by an
  // anchored content matcher. The cast mirrors buildCandidateOutcome:
  // DetectedScript's required hash is a synthetic-path invariant that RUM
  // evidence legitimately may lack; matchers fail secure on missing evidence.
  const result = deps.scriptComparison.compareScriptEvidence({ ...matchable } as DetectedScript, deps.inventory.scripts, deps.target)

  switch (result.type) {
    case 'unknown_script_found':
      deps.log.log(`inventory pass: inline script '${matchable.name}' not identified by any inventory entry — proposing a pending candidate`)
      return buildCandidateOutcome(normalised, deps)
    case 'known_script_unauthorised_content':
      // Identified but the observed evidence (hash or anchored windows) is
      // not positively authorised. The synthetic
      // inventory pass would auto-append the hash to the identified entry; the
      // RUM lane must not — FR-012 forbids the automated system authorising
      // anything, and appending to an authorised entry's hash list is a de
      // facto authorisation. A pending candidate carries the same evidence to
      // the same PR while keeping it explicitly unauthorised.
      deps.log.log(`inventory pass: inline script '${matchable.name}' identified but its evidence failed authorisation (${result.failureReason}) — proposing a pending candidate instead of auto-authorising`)
      return buildCandidateOutcome(normalised, deps)
    case 'authorized_script':
      deps.log.log(`inventory pass: inline script '${matchable.name}' identified and authorised — recorded`)
      return { drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false }
    default:
      // Header result types cannot come out of a script comparison; anything
      // else is a programming error — throw so the drain counts the message
      // failed and redelivers rather than silently deleting it.
      throw new Error(`unexpected comparison result type for RUM script: ${result.type}`)
  }
}

/**
 * Builds the candidate outcome for one inventory-pass observation.
 *
 * The result's target is the pass target with `workflowId` stripped: a RUM
 * observation cannot prove which checkout variation produced it (normalise.ts
 * never sets `Matchable.workflowId`), so the generated entry must not be
 * workflow-scoped — a workflowMatcher-wrapped identifier could never match
 * the repeat observation, and the diff's covered-entry check would then
 * append a duplicate candidate on every run.
 *
 * The script is the normalised matchable as-is. External scripts carry no
 * hash (opaque client-side, research R8) — `DetectedScript` cannot express
 * that, so the cast below acknowledges it (as do the two
 * `compareScriptEvidence` call sites for hash-less inline evidence);
 * `ScriptInventoryService` handles the hash-less case by authorising the
 * pending entry with an exact-name matcher instead of a hash.
 */
function buildCandidateOutcome(normalised: NormalisedScriptObservation, deps: RumRouteDeps): RumRouteOutcome {
  const { workflowId: _unprovable, ...candidateTarget } = deps.target
  const candidate = new UnknownScriptFound(candidateTarget as Target, new Date(), { ...normalised.matchable } as DetectedScript)
  return { drain: 'routed', outcome: 'candidate', alertDeliveryFailed: false, candidate }
}

async function routeScriptOrCsp(normalised: NormalisedObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  if (normalised.kind === 'csp') {
    return routeCspViolation(normalised, deps)
  }

  return normalised.identificationOnly ? routeExternalScript(normalised, deps) : routeInlineScript(normalised, deps)
}

/**
 * Detection-lane CSP violations (T035): opt-in per target, with an optional
 * prevalence floor.
 *
 * Activation is the presence of `alerts.rum.cspViolationReported` — no
 * destination, no alert, permanently (the resolver never falls back for this
 * category; see resolveRumAlertDestination). When activated, an optional
 * `cspViolationReportedMinSessions` floor gates by available prevalence.
 *
 * HONEST THRESHOLD SEMANTICS: a first-sighting queue message carries novelty
 * context only — no live session counters (contracts/queue-message.md; the
 * comparator deliberately never reads the novelty store). The available
 * prevalence at drain time is therefore exactly the first sighting itself:
 * one session. A floor of 1 (or none) alerts on first sighting; a floor
 * above 1 gates every first sighting to `recorded` — with the gate named in
 * the outcome — and effectively defers alerting to operator-driven
 * re-evaluation of the archived counters. There is deliberately no
 * collector-side re-enqueue when the novelty counters later cross the floor;
 * that is the future refinement if thresholds prove needed (out of scope
 * here, and building it would belong in the collector, not this router).
 *
 * The alert context carries the violation as reported — directive,
 * blocked URI, route, prevalence, inventory ref — and no matcher context:
 * CSP observations are never matched against inventory entries.
 */
async function routeCspViolation(normalised: NormalisedCspObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  const violation = `directive '${normalised.directive}' blocked '${normalised.blockedUri}' on route '${normalised.rum.firstRoute}'`

  if (deps.inventory.alerts.rum?.cspViolationReported === undefined) {
    deps.log.log(`CSP violation recorded (category not activated for this target — no alerts.rum.cspViolationReported destination, T035): ${violation}`)
    return { drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false }
  }

  const minSessions = deps.inventory.alerts.rum.cspViolationReportedMinSessions
  // First sightings carry no live counters: one session is all the prevalence
  // a queue message can prove (see the function comment above).
  const availableSessions = 1
  if (minSessions !== undefined && minSessions > availableSessions) {
    const gatedReason = `cspViolationReportedMinSessions=${minSessions} exceeds the available prevalence (${availableSessions} session — first sightings carry no live counters), so alerting defers to operator-driven re-evaluation`
    deps.log.log(`CSP violation recorded, alert gated: ${gatedReason}: ${violation}`)
    return { drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false, gatedReason }
  }

  return sendRumAlert('rum_csp_violation_reported', buildCspAlertContext(normalised, deps), deps)
}

/**
 * CSP alerts carry the violation as reported — no matcher context, because
 * CSP observations are never matched against inventory entries. The identity
 * is the `directive → blockedUri` summary the RumObservationIdentity contract
 * documents for csp-violation observations.
 */
function buildCspAlertContext(normalised: NormalisedCspObservation, deps: RumRouteDeps): RumAlertContext {
  return {
    observation: { kind: 'csp-violation', identity: `${normalised.directive} → ${normalised.blockedUri}` },
    prevalence: { first_seen: normalised.rum.firstSeen },
    first_route: normalised.rum.firstRoute,
    targetType: normalised.rum.targetType,
    inventoryRef: deps.inventoryRef,
  }
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
 * actually carries — always through the full evidence-aware comparison
 * pipeline (US2, T028/T029):
 *
 * - a client-computed hash IS evidence: a hash-based authoriser compares it
 *   and can authorise (or report a hash mismatch) even though content is
 *   never transported.
 * - anchored head/tail window evidence IS evidence: a whole source that fits
 *   one window rides `Matchable.content` and evaluates exactly as full
 *   content; longer sources ride `Matchable.contentEvidence`, where a
 *   `^`/`$`-anchored ContentMatcher can soundly authorise from its window
 *   and anything else fails secure with an explicit bounded-excerpt reason.
 *   A hash-less observation (hashing unavailable or content oversize) is
 *   therefore still evaluated, never dropped or blanket-failed.
 * - each matcher fails secure on evidence the observation lacks, with its
 *   own truthful reason — yielding the mismatched alert below.
 */
async function routeInlineScript(normalised: NormalisedScriptObservation, deps: RumRouteDeps): Promise<RumRouteOutcome> {
  const { matchable } = normalised

  // Cast mirrors buildCandidateOutcome: DetectedScript's required hash is a
  // synthetic-path invariant that RUM evidence legitimately may lack.
  const result = deps.scriptComparison.compareScriptEvidence({ ...matchable } as DetectedScript, deps.inventory.scripts, deps.target)

  switch (result.type) {
    case 'unknown_script_found':
      return sendRumAlert('rum_uninventoried_script_detected', buildAlertContext(normalised, deps), deps)
    case 'known_script_unauthorised_content':
      return sendRumAlert(
        'rum_mismatched_script_detected',
        buildAlertContext(normalised, deps, { failureReason: result.failureReason, matcherDescription: result.authorizationMatcher.getDescription(), metadataPath: result.metadataPath }),
        deps,
      )
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

function buildAlertContext(normalised: NormalisedScriptObservation, deps: RumRouteDeps, failure?: { failureReason: string; matcherDescription: string; metadataPath?: InventoryAuthorisationInfo[] }): RumAlertContext {
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
    // Root → leaf authorisation metadata from the comparison result (T029):
    // composite-matcher context an operator needs to see which alternative
    // was being evaluated when authorisation failed.
    ...(failure?.metadataPath !== undefined && failure.metadataPath.length > 0 ? { metadataPath: failure.metadataPath } : {}),
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
