import type { ScriptComparisonSummary } from '../types/comparison'
import type { Inventory, InventoryDifferenceResult, InventoryPullResult } from '../types/inventory/model'
import type { PullTarget } from '../types/target'

export interface IInventoryStore {
  pull(target: PullTarget): Promise<InventoryPullResult>
  push(inventory: Inventory[]): Promise<void>
}

export interface IScriptInventoryService {
  pull(target: PullTarget): Promise<Inventory[]>
  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}

export interface IScriptInventoryRepository {
  pull(target: PullTarget): Promise<Inventory[]>
  push(inventories: Inventory[]): Promise<void>
}
