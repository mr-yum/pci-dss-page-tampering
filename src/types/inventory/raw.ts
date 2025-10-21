import type { RawTargetDetection, RawTargetInventory } from '../target/raw'
import type { RawMatcherConfig } from './matcher-config-schema'
import type { Inventory, InventoryTarget } from './model'

export type RawAuthorizeWithConfig = RawMatcherConfig & {
  authorisationInfo: {
    description: string
    authorised: boolean
    date: string // ISO 8601 format
  }
}

/**
 * Raw (JSON-serializable) version of InventoryScriptInfo.
 *
 * Updated schema (Phase 3):
 * - Uses identifyWith/authoriseWith instead of nameMatcher/contentMatcher/hashes
 * - authoriseWith is RawAuthorizeWithConfig (matcher config + authorization metadata)
 */
export type RawInventoryScriptInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig
}

/**
 * Raw (JSON-serializable) version of InventoryHeaderInfo.
 *
 * Updated schema (Phase 5 - US3):
 * - Uses identifyWith/authoriseWith matcher-based structure (aligned with scripts)
 * - authoriseWith is RawAuthorizeWithConfig (matcher config + authorization metadata)
 */
export type RawInventoryHeaderInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig
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
