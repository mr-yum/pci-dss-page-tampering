import type { Target } from '../types/target'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model'

export function maybeGetInventoryForTarget(inventory: Inventory[], target: Target): Inventory | undefined {
  return inventory.find((inventory) => inventory.target.inventory.url === target.url)
}

export function copyInventory(inventory: Inventory, args?: { newScripts: InventoryScriptInfo[] }): Inventory {
  return {
    target: inventory.target,
    scripts: args ? args.newScripts : inventory.scripts,
  }
}
