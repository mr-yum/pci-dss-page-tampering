import type { ComparisonResultType } from '../types/comparison'
import type { Inventory, InventoryDifferenceResult, InventoryPullResult } from '../types/inventory/model'
import type { PullTarget } from '../types/target'

export interface IInventoryStore {
  pull(target: PullTarget, branchName?: string): Promise<InventoryPullResult>
  push(inventory: Inventory[], branchName?: string): Promise<void>
}

export interface IInventoryService {
  pull(target: PullTarget, branchName?: string): Promise<Inventory[]>
  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[], branchName?: string): Promise<void>
}

export interface IScriptInventoryRepository {
  pull(target: PullTarget, branchName?: string): Promise<Inventory[]>
  push(inventories: Inventory[], branchName?: string): Promise<void>
}
