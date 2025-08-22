import type { ScriptComparisonSummary } from '../types/comparison'
import type { Inventory, InventoryDifferenceResult, InventoryPullResult } from '../types/inventory/model'

export interface IInventoryStore {
  pull(): Promise<InventoryPullResult>
  push(inventory: Inventory[]): Promise<void>
}

export interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}

export interface IScriptInventoryRepository {
  pull(): Promise<Inventory[]>
  push(inventories: Inventory[]): Promise<void>
}
