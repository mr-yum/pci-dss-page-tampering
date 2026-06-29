import type { ComparisonResultType } from '../types/comparison.js'
import type { Inventory, InventoryDifferenceResult, InventoryPullResult } from '../types/inventory/model.js'
import type { PullTarget } from '../types/target.js'

/**
 * Discriminated result describing whether a push actually produced a commit.
 *
 * Callers downstream (e.g., auto-PR creation in `main.ts`) need to distinguish
 * "we sent a commit to the remote" from "there was nothing to push" without
 * re-running the material-change check that lives inside the service.
 */
export type InventoryPushResult = { pushed: false } | { pushed: true; commitMessage: string }

export interface IInventoryStore {
  pull(target: PullTarget, branchName?: string): Promise<InventoryPullResult>
  push(inventory: Inventory[], branchName?: string, commitMessage?: string): Promise<void>
}

export interface IInventoryService {
  pull(target: PullTarget, branchName?: string): Promise<Inventory[]>
  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[], branchName?: string): Promise<InventoryPushResult>
}

export interface IScriptInventoryRepository {
  pull(target: PullTarget, branchName?: string): Promise<Inventory[]>
  push(inventories: Inventory[], branchName?: string, commitMessage?: string): Promise<InventoryPushResult>
}
