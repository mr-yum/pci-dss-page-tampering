import type { Inventory } from '../types/inventory'

export interface IInventoryStore {
  pull(): Promise<Inventory[]>
  push(inventory: Inventory[]): Promise<void>
}
