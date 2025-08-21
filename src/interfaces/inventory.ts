import type { Inventory, InventoryDifferenceResult } from '../types/inventory'
import type { ScriptComparisonSummary } from '../types/comparison'

export interface IInventoryStore {
  pull(): Promise<Inventory[]>
  push(inventory: Inventory[]): Promise<void>
}

export interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}
