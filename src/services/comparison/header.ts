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

    // Iterate detected headers — nested Map of name → value → Set<host>.
    // Fan out one DetectedHeader per (name, value, host) triple so a CSP
    // directive emitted by multiple hosts produces an alert per host (each
    // is its own provenance question for compliance purposes).
    for (const [headerName, valuesByHost] of detectedHeaders.entries()) {
      const normalizedName = headerName.toLowerCase() // BR-3: Case-insensitive name matching

      for (const [value, hosts] of valuesByHost.entries()) {
        for (const host of hosts) {
          const detectedHeader: DetectedHeader = {
            name: normalizedName,
            value, // May be empty string per FR-013a
            target,
            workflow: target.workflow,
            host,
          }

          const result = this.compareSingleHeader(detectedHeader, inventoryHeaders, target, timestamp)
          results.push(result)
        }
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
  private compareSingleHeader(header: DetectedHeader, inventoryHeaders: InventoryHeaderInfo[], target: Target, timestamp: Date): ComparisonResultType {
    // T020: Find matching inventory entry (first-match-wins per BR-2)
    const matchedEntry = this.findMatchingInventoryEntry(header, inventoryHeaders)

    // No match → unknown header
    if (!matchedEntry) {
      target.logger.log(`Header '${header.name}' not identified in inventory.`)
      return new UnknownHeaderFound(target, timestamp, header)
    }

    // Log identification (T065: use matcher.getDescription() for human-readable output)
    const identifyDescription = matchedEntry.identifyWith.getDescription()
    target.logger.log(`Header '${header.name}' identified using ${identifyDescription}.`)

    // T064: Authorize value using authoriseWith matcher (BR-4: case-sensitive value matching)
    // T031: Use Matchable interface (hash is optional, no type cast workaround needed)
    // Note: Matcher interface uses Matchable shape, so map header fields:
    // - name stays as name
    // - value → content (matcher expects content field)
    // - hash is omitted for headers (optional field with exactOptionalPropertyTypes)
    const authorizationResult = matchedEntry.authoriseWith.matcher.authorize({
      name: header.name,
      content: header.value,
      ...(header.host !== undefined ? { host: header.host } : {}),
      // hash is omitted for headers (optional field in Matchable interface)
    })
    const isAuthorized = matchedEntry.authoriseWith.authorisationInfo.authorised && authorizationResult.authorized

    // T065: Log authorization result with matcher details
    const authorizeDescription = matchedEntry.authoriseWith.matcher.getDescription()
    const authStatus = isAuthorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authorizationResult.reason || 'authorization failed'})`
    target.logger.log(`Header '${header.name}'='${header.value}' authorization via ${authorizeDescription}: ${authStatus}.`)

    // Return appropriate result
    // T030: Pass metadataPath from AuthorizationResult for composite matcher support
    if (!isAuthorized) {
      target.logger.log(`\t Suggested regex:'${header.value.replace(/[.*+?^${}()/|[\]\\]/g, '\\$&').replace(/\\/g, '\\\\')}'`)
      return new KnownHeaderWithUnauthorisedContentFound_Header(
        target,
        timestamp,
        header,
        matchedEntry,
        matchedEntry.authoriseWith.matcher, // T064: Use the actual matcher instance
        authorizationResult.reason || 'authorization failed',
        authorizationResult.metadataPath ?? [], // NEW (T030): Pass metadata path from authorization result
      )
    }

    // T030: Pass metadataPath from AuthorizationResult for composite matcher support
    return new AuthorizedHeaderFound(target, timestamp, header, matchedEntry, authorizationResult.metadataPath ?? [])
  }

  /**
   * Find the first matching inventory entry for a header name (T063).
   *
   * Implementation (T020, updated in US3):
   * - First-match-wins logic (BR-2, FR-010c)
   * - Iterate inventory entries in array order
   * - Skip non-authorized entries (legacy compatibility)
   * - Use entry.identifyWith.identify() instead of inline regex test (FR-010)
   *
   * @param headerName - Normalized header name (lowercase)
   * @param inventoryHeaders - Array of authorized headers
   * @returns First matching entry or undefined
   */
  private findMatchingInventoryEntry(header: DetectedHeader, inventoryHeaders: InventoryHeaderInfo[]): InventoryHeaderInfo | undefined {
    for (const entry of inventoryHeaders) {
      // Skip non-authorized entries (legacy compatibility)
      if (!entry.authoriseWith.authorisationInfo.authorised) continue

      // Pass host so identifyWith can include a HostMatcher (typically combined
      // with HeaderNameMatcher under an AndMatcher) — e.g. "match CSP from
      // *.meandu.app only". Empty content is fine for header identification.
      if (entry.identifyWith.identify({ name: header.name, content: '', ...(header.host !== undefined ? { host: header.host } : {}) })) {
        return entry // First match wins (BR-2)
      }
    }
    return undefined
  }
}
