import type { Inventory } from '../types/inventory'
import type { Target } from '../types/target'

export function maybeGetInventoryForTarget(inventory: Inventory[], target: Target): Inventory | undefined {
  return inventory.find((inventory) => inventory.target.inventory.url === target.url)
}
