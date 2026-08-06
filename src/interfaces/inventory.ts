import type { ComparisonResultType } from '../types/comparison.js'
import type { Inventory, InventoryDifferenceResult, InventoryPullResult, InventoryRef } from '../types/inventory/model.js'
import type { PullTarget } from '../types/target.js'

/**
 * Discriminated result describing whether a push actually produced a commit.
 *
 * Callers downstream (e.g., auto-PR creation in `main.ts`) need to distinguish
 * "we sent a commit to the remote" from "there was nothing to push" without
 * re-running the material-change check that lives inside the service.
 */
export type InventoryPushResult = { pushed: false } | { pushed: true; commitMessage: string }

export type InventoryPullOptions = Readonly<{
  // Branch from which a missing inventory branch should be created.
  baseBranchName?: string
  // Start the local inventory branch from the current base even when a stale
  // remote branch exists. The next push uses force-with-lease.
  resetToBase?: boolean
}>

export interface IInventoryStore {
  pull(target: PullTarget, branchName?: string, options?: InventoryPullOptions): Promise<InventoryPullResult>
  push(inventory: Inventory[], branchName?: string, commitMessage?: string): Promise<void>
}

export interface IInventoryService {
  pull(target: PullTarget, branchName?: string, options?: InventoryPullOptions): Promise<Inventory[]>
  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[], branchName?: string): Promise<InventoryPushResult>
  /** Revision read by the most recent pull, or null if none/unavailable. */
  getLastPullRef(): InventoryRef | null
}

export interface IScriptInventoryRepository {
  pull(target: PullTarget, branchName?: string, options?: InventoryPullOptions): Promise<Inventory[]>
  push(inventories: Inventory[], branchName?: string, commitMessage?: string): Promise<InventoryPushResult>
  /** Revision read by the most recent pull, or null if none/unavailable. */
  getLastPullRef(): InventoryRef | null
}
