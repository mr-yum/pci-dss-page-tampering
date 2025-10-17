/**
 * Header Comparison Service
 *
 * Compares detected headers against inventory using typed comparison results.
 * Implements first-match-wins logic with case-insensitive name matching and case-sensitive value matching.
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 * @see specs/002-continuing-our-refactor/research.md (R2, R3, R4) for design decisions
 */

import type { IHeaderComparisonService } from '../../interfaces/comparison'
import type { ComparisonResultType } from '../../types/comparison'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found'
import { KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header } from '../../types/comparison/known-header-unauthorised-content-found'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found'
import type { DetectedHeader, HeaderDetectionSummary } from '../../types/header'
import type { Inventory, InventoryHeaderInfo } from '../../types/inventory/model'
import type { Matcher } from '../../types/matcher/matcher.interface'
import type { Target } from '../../types/target'

export class HeaderComparisonService implements IHeaderComparisonService {
  /**
   * Compare detected headers against inventory and return typed results.
   *
   * Implementation notes:
   * - Iterates header Map entries and expands Set<values> to individual DetectedHeader instances (T018)
   * - One result per header name-value pair (BR-1)
   * - Case-insensitive name matching (BR-3)
   * - Case-sensitive value matching (BR-4)
   * - Empty string values are valid input (BR-5)
   *
   * @param target - The target being processed
   * @param inventory - The inventory with authorized headers
   * @param headerDetectionSummary - Headers detected during workflow execution
   * @returns Array of typed comparison results
   */
  compare(target: Target, inventory: Inventory, headerDetectionSummary: HeaderDetectionSummary): Promise<ComparisonResultType[]> {
    const inventoryHeaders = inventory.headers
    const detectedHeaders = headerDetectionSummary.headers
    const results: ComparisonResultType[] = []
    const timestamp = new Date()

    // Iterate detected headers (Map of name → Set<values>)
    for (const [headerName, valuesSet] of detectedHeaders.entries()) {
      const normalizedName = headerName.toLowerCase() // BR-3: Case-insensitive name matching

      // Iterate each value separately (one result per value per BR-1)
      for (const value of valuesSet) {
        // T022: Handle empty string values - do NOT skip, pass to ContentMatcher
        const detectedHeader: DetectedHeader = {
          name: normalizedName,
          value, // May be empty string per FR-013a
          target,
          workflow: target.workflow,
        }

        const result = this.compareSingleHeader(detectedHeader, inventoryHeaders, target, timestamp)
        results.push(result)
      }
    }

    return Promise.resolve(results)
  }

  /**
   * Compare a single header name-value pair against inventory entries.
   *
   * Logic (T019):
   * - Normalize name to lowercase (BR-3)
   * - Find matching inventory entry using first-match-wins (BR-2, FR-010c)
   * - Create appropriate typed result based on identification and authorization
   *
   * @param header - Single detected header (name-value pair)
   * @param inventoryHeaders - Array of authorized headers
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @returns Typed comparison result
   */
  private compareSingleHeader(
    header: DetectedHeader,
    inventoryHeaders: InventoryHeaderInfo[],
    target: Target,
    timestamp: Date,
  ): ComparisonResultType {
    // T020: Find matching inventory entry (first-match-wins per BR-2)
    const matchedEntry = this.findMatchingInventoryEntry(header.name, inventoryHeaders)

    // No match → unknown header
    if (!matchedEntry) {
      this.log(`Header '${header.name}' not identified in inventory for target '${target.url}'.`)
      return new UnknownHeaderFound(target, timestamp, header)
    }

    // Log identification (T021)
    this.log(`Header '${header.name}' identified using nameMatcher pattern '${matchedEntry.nameMatcher.source}'.`)

    // Authorize value using contentMatcher (BR-4: case-sensitive value matching)
    const isAuthorized =
      matchedEntry.authorisationInfo.authorised && matchedEntry.contentMatcher.test(header.value)

    // Log authorization result (T021)
    const authStatus = isAuthorized
      ? 'AUTHORIZED'
      : `UNAUTHORIZED (value does not match pattern: ${matchedEntry.contentMatcher.source})`
    this.log(`Header '${header.name}' authorization via contentMatcher: ${authStatus}.`)

    // Return appropriate result
    if (!isAuthorized) {
      // Create a temporary Matcher-like object for compatibility (will be replaced in US3)
      const tempMatcher: Matcher = {
        identify: () => false,
        authorize: () => ({ authorized: false, reason: `value does not match pattern: ${matchedEntry.contentMatcher.source}` }),
        getType: () => 'content',
        getPattern: () => matchedEntry.contentMatcher.source,
      }

      return new KnownHeaderWithUnauthorisedContentFound_Header(
        target,
        timestamp,
        header,
        matchedEntry,
        tempMatcher,
        `value does not match pattern: ${matchedEntry.contentMatcher.source}`,
      )
    }

    return new AuthorizedHeaderFound(target, timestamp, header, matchedEntry)
  }

  /**
   * Find the first matching inventory entry for a header name.
   *
   * Implementation (T020):
   * - First-match-wins logic (BR-2, FR-010c)
   * - Iterate inventory entries in array order
   * - Skip non-authorized entries (legacy compatibility)
   * - Test nameMatcher against header name (case-insensitive via normalization)
   *
   * @param headerName - Normalized header name (lowercase)
   * @param inventoryHeaders - Array of authorized headers
   * @returns First matching entry or undefined
   */
  private findMatchingInventoryEntry(headerName: string, inventoryHeaders: InventoryHeaderInfo[]): InventoryHeaderInfo | undefined {
    for (const entry of inventoryHeaders) {
      // Skip non-authorized entries (legacy compatibility)
      if (!entry.authorisationInfo.authorised) continue

      // Test nameMatcher (case-insensitive due to pre-normalization of headerName)
      if (entry.nameMatcher.test(headerName)) {
        return entry // First match wins (BR-2)
      }
    }
    return undefined
  }

  /**
   * Log comparison events.
   *
   * Format: `[Comparison → Header]: <message>`
   */
  private log(message: string): void {
    console.log(`[Comparison → Header]: ${message}`)
  }
}
