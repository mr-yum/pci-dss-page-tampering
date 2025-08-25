import type { Inventory, InventoryScriptInfo, InventoryTarget } from './model'

export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'matcher'> & {
  matcher: string
}

export type RawInventoryTarget = Omit<InventoryTarget, 'workflow'> & {
  workflow: string
}

export type RawInventory = Omit<Inventory, 'target' | 'fileName' | 'scripts'> & {
  target: RawInventoryTarget
  scripts: RawInventoryScriptInfo[]
}
