/**
 * Header Comparison Service Contract
 *
 * Defines the interface for comparing detected headers against inventory
 * and returning typed comparison results.
 *
 * @see ../research.md R1: Typed Header Comparison Result Architecture
 * @see ../data-model.md E1-E3: Header comparison result entities
 */

import type { HeaderDetectionSummary } from '../../../src/types/header'
import type { Inventory } from '../../../src/types/inventory/model'
import type { Target } from '../../../src/types/target'
import type { HeaderComparisonResultType } from './header-comparison-results'

/**
 * Service interface for header comparison operations.
 * Updated to return typed results instead of HeaderComparisonSummary.
 */
export interface IHeaderComparisonService {
  /**
   * Compare detected headers against inventory, returning typed results.
   *
   * Algorithm:
   * 1. Extract headers Map from headerDetectionSummary
   * 2. For each header name in Map:
   *    a. Extract Set of values for that header
   *    b. For each value in Set:
   *       - Create DetectedHeader instance (name, value, target, workflow)
   *       - Attempt identification using inventory entries (first-match-wins)
   *       - If identified, attempt authorization
   *       - Return appropriate typed result (Unknown/KnownUnauthorised/Authorized)
   * 3. Return array of all typed results (one per header value)
   *
   * Example:
   * Input: Map {
   *   "Content-Security-Policy" → Set ["default-src 'self'", "script-src 'unsafe-inline'"]
   * }
   * Output: [
   *   AuthorizedHeaderFound { header: { name: "content-security-policy", value: "default-src 'self'" } },
   *   KnownHeaderWithUnauthorisedContentFound { header: { name: "content-security-policy", value: "script-src 'unsafe-inline'" } }
   * ]
   *
   * Behavior:
   * - Header names normalized to lowercase for matching (case-insensitive)
   * - Header values matched as-is (case-sensitive)
   * - Empty string values are valid (authorization determined by pattern)
   * - First-match-wins for inventory entries (iterate in array order)
   * - One result per header value (header with N values → N results)
   *
   * @param target - The target being processed
   * @param inventory - Inventory with header entries to match against
   * @param headerDetectionSummary - Detected headers from workflow execution
   * @returns Promise resolving to array of typed comparison results
   *
   * @see data-model.md BR-1: Header Value Iteration
   * @see data-model.md BR-2: First-Match-Wins Identification
   * @see data-model.md BR-3: Case-Insensitive Name Matching
   * @see data-model.md BR-4: Case-Sensitive Value Authorization
   * @see data-model.md BR-5: Empty Value Handling
   */
  compare(target: Target, inventory: Inventory, headerDetectionSummary: HeaderDetectionSummary): Promise<HeaderComparisonResultType[]>
}

/**
 * Implementation notes for compare method:
 *
 * 1. Iterate headerDetectionSummary.headers Map entries
 * 2. For each (headerName, valuesSet) entry:
 *    - Normalize headerName to lowercase
 *    - Iterate valuesSet
 *    - For each value:
 *      a. Create DetectedHeader { name: normalizedName, value, target, workflow }
 *      b. Call findMatchingInventoryEntry(normalizedName, inventory.headers)
 *      c. If no match: new UnknownHeaderFound(target, timestamp, detectedHeader)
 *      d. If match found:
 *         - Call inventoryEntry.authoriseWith.authorize({ content: value })
 *         - If authorized: new AuthorizedHeaderFound(...)
 *         - If not authorized: new KnownHeaderWithUnauthorisedContentFound(...)
 *
 * 3. Collect all results in array and return
 *
 * Helper method pattern:
 * ```typescript
 * private findMatchingInventoryEntry(
 *   headerName: string,
 *   inventoryHeaders: InventoryHeaderInfo[]
 * ): InventoryHeaderInfo | undefined {
 *   for (const entry of inventoryHeaders) {
 *     // Skip non-authorized entries (legacy compatibility)
 *     if (!entry.authorisationInfo.authorised) continue
 *
 *     // Test identifyWith matcher (NameMatcher with case-insensitive flag)
 *     if (entry.identifyWith.identify({ name: headerName })) {
 *       return entry  // First match wins
 *     }
 *   }
 *   return undefined
 * }
 * ```
 *
 * Logging pattern:
 * ```typescript
 * console.log(
 *   `[Comparison → Header]: Header '${headerName}' identified using ` +
 *   `${entry.identifyWith.getType()}Matcher with pattern '${entry.identifyWith.getPattern()}'`
 * )
 *
 * console.log(
 *   `[Comparison → Header]: Header '${headerName}' authorization via ` +
 *   `${entry.authoriseWith.getType()}Matcher: ${authResult.authorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authResult.reason})`}`
 * )
 * ```
 */
