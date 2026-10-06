import type { ResponseResourceType } from '../header.js'
import type { TargetType } from '../target.js'
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
  requiredOn?: TargetType[] | undefined
  /** Trust grant for what this entry's script loads; see `LoadGrant`. */
  authorisesLoads?: 'direct' | 'transitive' | undefined
  /** Only with `authorisesLoads: "transitive"`: furthest hop that inherits (1..8, default 8). */
  maxDepth?: number | undefined
  /** Required with `authorisesLoads`: which loaded scripts may inherit. */
  loadsMatching?: RawMatcherConfig | undefined
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
