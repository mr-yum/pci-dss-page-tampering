import type { Target } from '../types/target'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventory } from '../types/inventory/raw'

export function maybeGetInventoryForTarget(inventory: Inventory[], target: Target): Inventory | undefined {
  return inventory.find((inventory) => inventory.target.inventory.url === target.url)
}

export function copyInventory(inventory: Inventory, args?: { newScripts: InventoryScriptInfo[] }): Inventory {
  return {
    fileName: inventory.fileName,
    target: inventory.target,
    scripts: args ? args.newScripts : inventory.scripts,
  }
}

export function inventoryToRawInventory(inventory: Inventory): RawInventory {
  return {
    target: {
      inventory: inventory.target.inventory,
      detection: inventory.target.detection,
      workflow: inventory.target.workflow.fileName,
    },
    scripts: inventory.scripts,
  }
}
