/**
 * InventoryService Internal Method Contracts
 *
 * Documents the internal private methods used for processing typed comparison results.
 * These methods are not part of the public IInventoryService interface but define
 * the internal processing logic.
 */

import type { ComparisonResultType } from '../../../src/types/comparison/index'
import type { KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header } from '../../../src/types/comparison/known-header-unauthorised-content-found'
import type { KnownScriptWithUnauthorisedContentFound } from '../../../src/types/comparison/known-script-unauthorised-content-found'
import type { UnknownHeaderFound } from '../../../src/types/comparison/unknown-header-found'
import type { UnknownScriptFound } from '../../../src/types/comparison/unknown-script-found'
import type { Inventory } from '../../../src/types/inventory/model'

/**
 * Internal processing methods for InventoryService.
 *
 * Implementation note: These are private methods on ScriptInventoryService class.
 */
export interface InventoryServiceInternalMethods {
  /**
   * Processes a single comparison result and returns updated inventory.
   *
   * @param result - Typed comparison result to process
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp to use for new entries/hashes
   * @returns Updated inventory with changes applied
   *
   * Behavior:
   * - Uses exhaustive switch on result.type
   * - Delegates to specialized methods for each case
   * - Returns inventory unchanged for authorized results
   * - Throws error for unhandled result types (compile-time exhaustiveness check)
   *
   * Example:
   * ```typescript
   * private processComparisonResult(
   *   result: ComparisonResultType,
   *   inventory: Inventory,
   *   updateDate: Date
   * ): Inventory {
   *   switch (result.type) {
   *     case 'unknown_script_found':
   *       return this.addNewScript(result, inventory, updateDate)
   *     case 'known_script_unauthorised_content':
   *       return this.updateScriptWithNewHash(result, inventory, updateDate)
   *     // ... other cases
   *     default:
   *       const _exhaustive: never = result
   *       throw new Error(`Unhandled type: ${(_exhaustive as any).type}`)
   *   }
   * }
   * ```
   */
  processComparisonResult(result: ComparisonResultType, inventory: Inventory, updateDate: Date): Inventory

  /**
   * Creates a new inventory entry from an unknown script result.
   *
   * @param result - UnknownScriptFound result containing script details
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp for the new entry
   * @returns Updated inventory with new script entry appended
   *
   * Behavior:
   * - Converts DetectedScript to InventoryScriptInfo
   * - Creates identifyWith matcher based on script type:
   *   - External scripts: NameMatcher with script URL
   *   - Inline scripts: ContentMatcher with script content
   * - Creates authoriseWith with hash matcher containing detected hash
   * - Sets authorisationInfo with description indicating discovery context
   * - Appends to inventory.scripts array
   *
   * Example:
   * ```typescript
   * // Input: UnknownScriptFound with external script
   * // Output: New entry with:
   * //   identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" }
   * //   authoriseWith: {
   * //     hashes: [{ timestamp: "2025-10-24...", hash: { value: "abc123..." } }],
   * //     authorisationInfo: {
   * //       description: "Script detected during inventory run 2025-10-24",
   * //       authorised: true,
   * //       date: "2025-10-24..."
   * //     }
   * //   }
   * ```
   */
  addNewScript(result: UnknownScriptFound, inventory: Inventory, updateDate: Date): Inventory

  /**
   * Updates an existing script entry with a new hash.
   *
   * @param result - KnownScriptWithUnauthorisedContentFound result with hash mismatch
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp for the new hash
   * @returns Updated inventory with hash added to matched entry
   *
   * Behavior (FR-002a, FR-002b):
   * - Finds inventory entry using result.inventoryEntry reference
   * - Converts to RawInventoryScriptInfo for manipulation
   * - If authoriseWith is hash matcher:
   *   - Checks if hash already exists (idempotency)
   *   - Appends new hash to hashes array if not duplicate
   *   - Preserves existing authorisationInfo unchanged (FR-011)
   * - If authoriseWith is NOT hash matcher:
   *   - Converts to array syntax with original matcher + new hash matcher
   *   - Original matcher preserves its authorisationInfo
   *   - New hash matcher gets new authorisationInfo with discovery context
   * - Converts back to InventoryScriptInfo
   *
   * Example (hash matcher):
   * ```typescript
   * // Before:
   * //   authoriseWith: { hashes: [{ hash: "abc..." }], authorisationInfo: {...} }
   * // After:
   * //   authoriseWith: { hashes: [{ hash: "abc..." }, { hash: "def..." }], authorisationInfo: {...} }
   * //   (authorisationInfo unchanged)
   * ```
   *
   * Example (non-hash matcher to array):
   * ```typescript
   * // Before:
   * //   authoriseWith: { contentMatcher: "pattern", authorisationInfo: { date: "2025-01-15" } }
   * // After:
   * //   authoriseWith: [
   * //     { contentMatcher: "pattern", authorisationInfo: { date: "2025-01-15" } },
   * //     { hashes: [{ hash: "def..." }], authorisationInfo: { date: "2025-10-24" } }
   * //   ]
   * ```
   */
  updateScriptWithNewHash(result: KnownScriptWithUnauthorisedContentFound, inventory: Inventory, updateDate: Date): Inventory

  /**
   * Creates a new header inventory entry from an unknown header result.
   *
   * @param result - UnknownHeaderFound result containing header details
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp for the new entry
   * @returns Updated inventory with new header entry appended
   *
   * Behavior:
   * - Converts DetectedHeader to InventoryHeaderInfo
   * - Creates identifyWith with HeaderNameMatcher (case-insensitive)
   * - Creates authoriseWith with ContentMatcher for header value
   * - Sets authorisationInfo with description indicating discovery context
   * - Appends to inventory.headers array
   *
   * Example:
   * ```typescript
   * // Input: UnknownHeaderFound with Content-Security-Policy
   * // Output: New entry with:
   * //   identifyWith: { headerNameMatcher: "^content-security-policy$" }
   * //   authoriseWith: {
   * //     contentMatcher: "default-src 'self'",
   * //     authorisationInfo: {
   * //       description: "Header detected during inventory run 2025-10-24",
   * //       authorised: true,
   * //       date: "2025-10-24..."
   * //     }
   * //   }
   * ```
   */
  addNewHeader(result: UnknownHeaderFound, inventory: Inventory, updateDate: Date): Inventory

  /**
   * Updates an existing header entry with a new content matcher.
   *
   * @param result - KnownHeaderWithUnauthorisedContentFound result with content mismatch
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp for the new content matcher
   * @returns Updated inventory with content matcher added to matched entry
   *
   * Behavior (FR-003a, FR-003b):
   * - Finds inventory entry using result.inventoryEntry reference
   * - Converts to RawInventoryHeaderInfo for manipulation
   * - If authoriseWith is already an array:
   *   - Checks if pattern already exists (idempotency)
   *   - Appends new contentMatcher config if not duplicate
   *   - New matcher has its own authorisationInfo (FR-011a)
   * - If authoriseWith is single matcher:
   *   - Converts to array syntax with original matcher + new content matcher
   *   - Original matcher preserves its authorisationInfo
   *   - New matcher gets new authorisationInfo with discovery context (FR-011b)
   * - Converts back to InventoryHeaderInfo
   *
   * Example (array to array):
   * ```typescript
   * // Before:
   * //   authoriseWith: [
   * //     { contentMatcher: "pattern1", authorisationInfo: { date: "2025-01-15" } }
   * //   ]
   * // After:
   * //   authoriseWith: [
   * //     { contentMatcher: "pattern1", authorisationInfo: { date: "2025-01-15" } },
   * //     { contentMatcher: "pattern2", authorisationInfo: { date: "2025-10-24" } }
   * //   ]
   * ```
   *
   * Example (single to array):
   * ```typescript
   * // Before:
   * //   authoriseWith: { contentMatcher: "pattern1", authorisationInfo: { date: "2025-01-15" } }
   * // After:
   * //   authoriseWith: [
   * //     { contentMatcher: "pattern1", authorisationInfo: { date: "2025-01-15" } },
   * //     { contentMatcher: "pattern2", authorisationInfo: { date: "2025-10-24" } }
   * //   ]
   * ```
   */
  updateHeaderWithNewContent(result: KnownHeaderWithUnauthorisedContentFound_Header, inventory: Inventory, updateDate: Date): Inventory
}
