import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo, InventoryTarget } from './model'
import type { RawTargetDetection, RawTargetInventory } from '../target/raw'

export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'nameMatcher'> & {
  nameMatcher: string
}

export type RawInventoryTarget = Omit<InventoryTarget, 'inventory' | 'detection'> & {
  inventory: RawTargetInventory
  detection: RawTargetDetection
}

export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'nameMatcher' | 'contentMatcher'> & {
  nameMatcher: string
  contentMatcher: string
}

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts' | 'headers'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
  headers: RawInventoryHeaderInfo[]
}
