export const AlertType = {
  Script: 'Script',
  Header: 'Header',
  Success: 'Success',
  Rum: 'Rum',
} as const

export type AlertType = (typeof AlertType)[keyof typeof AlertType]

/**
 * Alert categories raised by the real-user monitoring comparator
 * (`--mode rum-compare`, feature 011). Extends — never replaces — the
 * synthetic categories routed through `alertForTypedResults`.
 *
 * - `rum_uninventoried_script_detected`: a script observed in a real user's
 *   browser was not identified by any inventory entry (detection pass).
 * - `rum_mismatched_script_detected`: an inline script was identified but its
 *   evidence failed authorisation (detection pass).
 * - `rum_csp_violation_reported`: a CSP violation report was observed.
 *   Recorded from phase 1; alerting activates in phase 4 (T035).
 */
export const RUM_ALERT_CATEGORIES = ['rum_uninventoried_script_detected', 'rum_mismatched_script_detected', 'rum_csp_violation_reported'] as const

export type RumAlertCategory = (typeof RUM_ALERT_CATEGORIES)[number]

/**
 * Prevalence snapshot carried on every RUM alert (data-model.md §7).
 *
 * `first_seen` comes from the queue message's novelty stamp. `sessions` and
 * `last_seen` are optional because the comparator deliberately never reads the
 * novelty store (the queue message is self-contained); they are populated only
 * when a counters snapshot is available at drain time.
 *
 * Field names mirror the wire/novelty schema (snake_case) so an alert can be
 * correlated with the archived observation without translation.
 */
export type RumPrevalence = {
  sessions?: number | undefined
  first_seen: number
  last_seen?: number | undefined
}

/** Identity of the observation an RUM alert is about. */
export type RumObservationIdentity = {
  kind: 'external-script' | 'inline-script' | 'csp-violation'
  /**
   * External scripts: the script URL. Inline scripts: the fingerprint-derived
   * name (`inline_script/rum:{hash | fingerprint}`). CSP violations: a
   * `directive → blockedUri` summary.
   */
  identity: string
  /** Initiator URL (provenance), when the observation carried one. */
  initiator?: string | undefined
  /** Client-computed SHA-256, when the observation carried one (inline only). */
  hash?: string | undefined
}

/**
 * Context every RUM alert carries, in addition to the target it concerns.
 * Additive to the existing alert plumbing: synthetic alerts keep carrying
 * typed comparison results; RUM alerts carry this instead because the
 * comparator holds an observation, not a fetched resource.
 */
export type RumAlertContext = {
  observation: RumObservationIdentity
  prevalence: RumPrevalence
  /** SPA route active at the first sighting — triage context, never identity. */
  first_route: string
  /** Which pass observed the resource. */
  targetType: 'inventory' | 'detection'
  /** Commit SHA of the inventory the observation was judged against (SC-005). */
  inventoryRef: string
  /** Mismatched alerts only: why authorisation failed. */
  failureReason?: string | undefined
  /** Mismatched alerts only: description of the authorisation matcher consulted. */
  matcherDescription?: string | undefined
}
