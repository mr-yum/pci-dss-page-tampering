import type { SHA256Hash } from '../hash'
import type { Matcher } from '../matcher/matcher.interface'
import type { TargetDetection, TargetInventory } from '../target'
import type { RawInventory } from './raw'

export type InventoryAuthorisationInfo = {
  description: string
  authorised: boolean
  date: Date
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
 * - authoriseWith: Matcher instance created from MatcherConfig (for content authorization)
 * - No longer uses raw regex fields; matchers encapsulate all matching logic
 */
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}

export type InventoryHeaderInfo = {
  nameMatcher: RegExp
  contentMatcher: RegExp
  authorisationInfo: InventoryAuthorisationInfo
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
