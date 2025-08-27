import type { Inventory, InventoryScriptInfo, InventoryHeaderInfo, InventoryTarget, InventoryScriptHashInfo, InventoryScriptAuthorisationInfo } from './model'

export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'matcher' | 'hashes' | 'authorisationInfo'> & {
  matcher: string
  hashes: Array<Omit<InventoryScriptHashInfo, 'timestamp'> & { timestamp: string }>
  authorisationInfo: Omit<InventoryScriptAuthorisationInfo, 'date'> & { date: string }
}

export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'nameMatcher' | 'contentMatcher' | 'date'> & {
  nameMatcher: string
  contentMatcher: string
  date: string
}

export type RawInventoryTarget = Omit<InventoryTarget, 'workflow'> & {
  workflow: string
}

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts' | 'headers'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
  headers: RawInventoryHeaderInfo[]
}
