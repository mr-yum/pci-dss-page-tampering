import type { ComparisonResultType } from '../comparison.js'
import type { SHA256Hash } from '../hash.js'
import type { ResponseResourceType } from '../header.js'
import type { Matcher } from '../matcher/matcher.interface.js'
import type { TargetDetection, TargetInventory } from '../target.js'
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
}

export type InventoryAlert = {
  inventory: AlertInventory
  detection: AlertDetection
  successNotification: AlertDestination
}

export type Inventory = {
  fileName: string
  target: InventoryTarget
  alerts: InventoryAlert
  scripts: InventoryScriptInfo[]
  headers: InventoryHeaderInfo[]
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
}

export type InventoryPullResult = {
  payloads: InventoryPullPayload[]
}
