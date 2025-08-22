import type { ScriptComparisonSummary } from '../types/comparison'
import type { RawInventory } from '../types/inventory/raw'
import type { Inventory, InventoryDifferenceResult } from '../types/inventory/model'

export interface IInventoryStore {
  pull(): Promise<RawInventory[]>
  push(inventory: Inventory[]): Promise<void>
}

export interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}
