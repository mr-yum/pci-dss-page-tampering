import type { Inventory, InventoryTarget } from './model'

export type RawInventoryTarget = Omit<InventoryTarget, 'workflow'> & {
  workflow: string
}

export type RawInventory = Omit<Inventory, 'target'> & {
  target: RawInventoryTarget
}
