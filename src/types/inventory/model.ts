import type { SHA256Hash } from '../hash'
import type { Matcher } from '../matcher/matcher.interface'
import type { TargetDetection, TargetInventory } from '../target'
import type { RawInventory } from './raw'

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
}

export type InventoryTarget = {
  inventory: TargetInventory
  detection: TargetDetection
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
}

export type InventoryPullPayload = {
  fileName: string
  rawInventory: RawInventory
}

export type InventoryPullResult = {
  payloads: InventoryPullPayload[]
}
