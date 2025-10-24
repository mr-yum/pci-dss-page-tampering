/**
 * IInventoryService Interface Contract
 *
 * Updated contract for inventory service after refactoring to use typed comparison results.
 *
 * Key changes from legacy interface:
 * - diff() accepts ComparisonResultType[] instead of ScriptComparisonSummary/HeaderComparisonSummary
 * - Single parameter simplifies API and eliminates need for separate script/header summaries
 * - Type safety improved via discriminated union exhaustiveness checking
 */

import type { ComparisonResultType } from '../../../src/types/comparison/index'
import type { Inventory, InventoryDifferenceResult } from '../../../src/types/inventory/model'
import type { PullTarget } from '../../../src/types/target'

/**
 * Service interface for managing script and header inventories.
 *
 * Responsibilities:
 * - Pull inventories from storage (Git repository)
 * - Compute inventory differences from comparison results
 * - Push updated inventories back to storage with Git commits
 */
export interface IInventoryService {
  /**
   * Pulls inventory from storage for the given target.
   *
   * @param target - The pull target configuration
   * @returns Promise resolving to array of inventories (one per target)
   *
   * Behavior:
   * - Clones/pulls Git repository containing inventories
   * - Parses inventory JSON files
   * - Validates against Zod schema
   * - Returns InventoryScriptInfo with Matcher instances
   */
  pull(target: PullTarget): Promise<Inventory[]>

  /**
   * Computes inventory differences by processing typed comparison results.
   *
   * @param inventory - Current inventory to update
   * @param comparisonResults - Array of typed comparison results from ComparisonService
   * @returns Promise resolving to difference result (old and new inventory)
   *
   * Behavior:
   * - Validates all results are from inventory workflow (target.type === 'inventory')
   * - Processes each result based on discriminated type:
   *   - unknown_script_found → Add new inventory entry
   *   - known_script_unauthorised_content → Update existing entry with new hash
   *   - unknown_header_found → Add new header entry
   *   - known_header_unauthorised_content → Update existing header with new content matcher
   *   - authorized_script / authorized_header → No change
   * - Returns immutable update with before/after snapshots
   *
   * Validation:
   * - Throws error if any result has target.type !== 'inventory'
   * - Idempotent: duplicate results don't create duplicate hashes/matchers
   *
   * Example:
   * ```typescript
   * const results: ComparisonResultType[] = await comparisonService.compare(...)
   * const diff = await inventoryService.diff(currentInventory, results)
   * // diff.oldInventory === original
   * // diff.newInventory === updated with new scripts/hashes/headers
   * ```
   */
  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult>

  /**
   * Pushes inventory differences to storage.
   *
   * @param diffs - Array of inventory difference results to commit
   * @returns Promise resolving when all inventories are pushed
   *
   * Behavior:
   * - Serializes updated inventories to JSON
   * - Creates Git commits with descriptive messages
   * - Pushes to remote repository
   * - No-op if diffs array is empty
   */
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}
