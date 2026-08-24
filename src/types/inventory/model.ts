import type { ComparisonResultType } from '../comparison.js'
import type { SHA256Hash } from '../hash.js'
import type { ResponseResourceType } from '../header.js'
import type { Matcher } from '../matcher/matcher.interface.js'
import type { TargetDetection, TargetInventory, TargetType } from '../target.js'
import type { RawInventory } from './raw.js'

export type InventoryAuthorisationInfo = {
  description: string
  authorised: boolean
  date: Date
}

export type AuthorizeWithConfig = {
  matcher: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}

export type InventoryScriptHashInfo = {
  timestamp: Date
  hash: SHA256Hash
}

/**
 * Processed inventory script information with Matcher instances.
 *
 * Updated model (Phase 3):
 * - identifyWith: Matcher instance created from MatcherConfig (for script identification)
 * - authoriseWith: AuthorizeWithConfig composite structure (matcher + authorization metadata)
 * - No longer uses raw regex fields; matchers encapsulate all matching logic
 */
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig
  /**
   * Passes (`inventory` / `detection`) on which some detected script must be
   * identified by this entry's `identifyWith` — absence yields a
   * MissingRequiredScript finding. The script-side analogue of the header
   * `requiredOn`; used to pin monitoring controls (e.g. the RUM agent) so
   * their removal from the page alerts.
   */
  requiredOn?: TargetType[] | undefined
}

/**
 * Processed inventory header information with Matcher instances.
 *
 * Updated model (Phase 5 - US3):
 * - identifyWith: Matcher instance (typically HeaderNameMatcher for case-insensitive name matching)
 * - authoriseWith: AuthorizeWithConfig composite structure (matcher + authorization metadata)
 * - Aligns with InventoryScriptInfo structure for consistency
 *
 * @see ./header-entry.ts for schema and processing logic
 */
export type InventoryHeaderInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig
  /** Resource types on which this header must be present. */
  requiredOn?: ResponseResourceType[] | undefined
}

export type InventoryWorkflow = {
  id: string
  inventory: TargetInventory
  detection: TargetDetection
}

export type InventoryTarget =
  | {
      inventory: TargetInventory
      detection: TargetDetection
      workflows?: never
    }
  | {
      workflows: InventoryWorkflow[]
      inventory?: never
      detection?: never
    }

/** Normalize legacy single-target inventories into the multi-workflow shape. */
export function getInventoryWorkflows(target: InventoryTarget): InventoryWorkflow[] {
  if (target.workflows !== undefined) return target.workflows
  return [{ id: 'default', inventory: target.inventory, detection: target.detection }]
}

export type AlertDestination = {
  destination: string
}

export type AlertInventory = {
  newScriptIdentified: AlertDestination
  newHeaderIdentified: AlertDestination
}

export type AlertDetection = {
  newScriptDetected: AlertDestination
  scriptMismatchDetected: AlertDestination
  newHeaderDetected: AlertDestination
  headerMismatchDetected?: AlertDestination | undefined
  missingHeaderDetected?: AlertDestination | undefined
  missingScriptDetected?: AlertDestination | undefined
}

/**
 * Destinations for real-user monitoring alert categories (feature 011,
 * data-model.md §8). Each key mirrors one `rum_*` category:
 *
 * - `uninventoriedScriptDetected` → `rum_uninventoried_script_detected`
 * - `mismatchedScriptDetected` → `rum_mismatched_script_detected`
 * - `cspViolationReported` → `rum_csp_violation_reported`
 *
 * Every key is optional, as is the whole block. The two script categories
 * fall back to the analogous synthetic detection destination when
 * unconfigured (see `resolveRumAlertDestination` in
 * ../../services/alert/rum.ts) so a missing config line never silently drops
 * an alert. `cspViolationReported` deliberately does NOT fall back: the
 * category is opt-in per target (T035) — real-user CSP reports carry heavy
 * browser-extension noise, so an implicit activation via the header-channel
 * fallbacks would flood those channels the moment the feature ships. No
 * configured destination means the violation is recorded and counted, never
 * alerted (the phase-1..3 behaviour, now the permanent default).
 */
export type AlertRum = {
  uninventoriedScriptDetected?: AlertDestination | undefined
  mismatchedScriptDetected?: AlertDestination | undefined
  cspViolationReported?: AlertDestination | undefined
  /**
   * Optional prevalence gate for `rum_csp_violation_reported` (positive
   * integer): the alert fires only when the observation's available session
   * count meets this floor. HONEST LIMITATION — first-sighting queue messages
   * carry novelty context only, never live session counters, so the only
   * prevalence available at drain time is the first sighting itself (one
   * session). A value of 1 (or leaving this unset) alerts on first sighting;
   * any value above 1 therefore gates every first sighting to recorded and
   * effectively defers alerting to operator-driven re-evaluation of the
   * archive/novelty counters. Collector-side re-enqueue once counters cross
   * the threshold is the future refinement if thresholds prove needed.
   */
  cspViolationReportedMinSessions?: number | undefined
}

export type InventoryAlert = {
  inventory: AlertInventory
  detection: AlertDetection
  rum?: AlertRum | undefined
  successNotification: AlertDestination
}

/**
 * Where an inventory's on-disk representation came from.
 *
 * Retained so the auditor report can cite a file and line number for the
 * matcher that authorised a resource. Matchers keep no provenance of their own,
 * and the raw text is the only thing that can answer "which line?" — the
 * validated model has already lost formatting, key order and unknown keys.
 *
 * Never serialised back to Git: `inventoryToRawInventory` enumerates its output
 * fields, so this stays in memory only.
 */
export type InventorySource = {
  /** Path relative to the inventory repo root, e.g. `targets/2.0.json`. */
  file: string
  /** Exact file contents as read. The single source of truth for provenance. */
  text: string
}

export type Inventory = {
  fileName: string
  target: InventoryTarget
  alerts: InventoryAlert
  scripts: InventoryScriptInfo[]
  headers: InventoryHeaderInfo[]
  /** Absent for inventories not built by a repository pull (notably in tests). */
  source?: InventorySource | undefined
}

export type InventoryDifferenceResult = {
  oldInventory: Inventory
  newInventory: Inventory
  /**
   * Comparison results that actually translated into an inventory mutation
   * (new script/header added, or new hash/content matcher appended to an
   * existing entry). Used downstream to keep "Inventory updated" alerts
   * truthful — results that did NOT cause a change (e.g. unauthorised content
   * authorised by a non-hash matcher, AndMatcher entries, duplicate hashes)
   * are absent here and trigger a "manual review required" alert instead.
   */
  appliedResults?: ComparisonResultType[]
}

export type InventoryPullPayload = {
  fileName: string
  rawInventory: RawInventory
  /** Exact file contents as read. @see InventorySource */
  rawText: string
}

/**
 * The inventory revision a pull read from.
 *
 * Recorded so the auditor report can state which baseline a detection run was
 * compared against. "Detection ran against inventory commit abc1234 on branch
 * main" is what turns 11.6.1 evidence from plausible into verifiable.
 */
export type InventoryRef = {
  branch: string
  commitSha: string
  commitIsoDate: string | null
}

export type InventoryPullResult = {
  payloads: InventoryPullPayload[]
  /** Absent when the revision could not be read (e.g. a store with no Git). */
  ref?: InventoryRef | undefined
}
