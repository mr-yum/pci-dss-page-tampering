import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo, InventoryTarget } from './model'

export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'matcher'> & {
  matcher: string
}

export type RawInventoryTarget = Omit<InventoryTarget, 'workflow'> & {
  workflow: string
}

export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'nameMatcher' | 'contentMatcher' | 'date'> & {
  nameMatcher: string
  contentMatcher: string
  date: string
}

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts' | 'headers'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
  headers: RawInventoryHeaderInfo[]
}
