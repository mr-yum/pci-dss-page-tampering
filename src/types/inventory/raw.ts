import type { RawTargetDetection, RawTargetInventory } from '../target/raw'
import type { RawMatcherConfig } from './matcher-config-schema'
import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo, InventoryTarget } from './model'

/**
 * Raw (JSON-serializable) version of InventoryScriptInfo.
 *
 * Updated schema (Phase 3):
 * - Uses identifyWith/authoriseWith instead of nameMatcher/contentMatcher/hashes
 * - Each field is a RawMatcherConfig union type (before conversion to Matcher instances)
 */
export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
}

/**
 * Raw (JSON-serializable) version of InventoryHeaderInfo.
 *
 * Updated schema (Phase 5 - US3):
 * - Uses identifyWith/authoriseWith matcher-based structure (aligned with scripts)
 * - Each field is a RawMatcherConfig union type (before conversion to Matcher instances)
 * - Replaces old nameMatcher/contentMatcher RegExp structure
 */
export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
}

export type RawInventoryTarget = Omit<InventoryTarget, 'inventory' | 'detection'> & {
  inventory: RawTargetInventory
  detection: RawTargetDetection
}

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts' | 'headers'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
  headers: RawInventoryHeaderInfo[]
}
