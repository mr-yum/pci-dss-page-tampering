import type { ResponseResourceType } from '../header.js'
import type { RawTargetDetection, RawTargetInventory } from '../target/raw.js'
import type { RawMatcherConfig } from './matcher-config-schema.js'
import type { Inventory } from './model.js'

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
  requiredOn?: ResponseResourceType[] | undefined
}

export type RawInventoryWorkflow = {
  id: string
  inventory: RawTargetInventory
  detection: RawTargetDetection
}

export type RawInventoryTarget =
  | {
      inventory: RawTargetInventory
      detection: RawTargetDetection
      workflows?: never
    }
  | {
      workflows: RawInventoryWorkflow[]
      inventory?: never
      detection?: never
    }

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts' | 'headers'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
  headers: RawInventoryHeaderInfo[]
}
