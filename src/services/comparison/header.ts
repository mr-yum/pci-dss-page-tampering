/**
 * Header Comparison Service
 *
 * Compares detected headers against inventory using typed comparison results.
 * Implements first-match-wins logic with case-insensitive name matching and case-sensitive value matching.
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 * @see specs/002-continuing-our-refactor/research.md (R2, R3, R4) for design decisions
 */

import type { IHeaderComparisonService } from '../../interfaces/comparison.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found.js'
import { KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header } from '../../types/comparison/known-header-unauthorised-content-found.js'
import { MissingRequiredHeader } from '../../types/comparison/missing-required-header.js'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import type { DetectedHeader, HeaderDetectionSummary } from '../../types/header.js'
import type { Inventory, InventoryHeaderInfo } from '../../types/inventory/model.js'
import type { Target } from '../../types/target.js'
import { extractHost, redactUrl } from '../../utils/url.js'

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

    // Iterate detected headers — nested Map of name → value → Set<url>.
    // Fan out one DetectedHeader per (name, value, url) triple so a CSP
    // directive emitted by multiple responses produces an alert per URL
    // (each is its own provenance question for compliance purposes —
    // HostMatcher / UrlMatcher use this URL to discriminate).
    for (const [headerName, valuesByUrl] of detectedHeaders.entries()) {
      const normalizedName = headerName.toLowerCase() // BR-3: Case-insensitive name matching

      for (const [value, urls] of valuesByUrl.entries()) {
        for (const url of urls) {
          const detectedHeader: DetectedHeader = {
            name: normalizedName,
            value, // May be empty string per FR-013a
            target,
            workflow: target.workflow,
            url,
          }

          const result = this.compareSingleHeader(detectedHeader, inventoryHeaders, target, timestamp)
          results.push(result)
        }
      }
    }

    results.push(...this.findMissingRequiredHeaders(target, inventoryHeaders, headerDetectionSummary, timestamp))

    return Promise.resolve(results)
  }

  private findMissingRequiredHeaders(target: Target, inventoryHeaders: InventoryHeaderInfo[], summary: HeaderDetectionSummary, timestamp: Date): MissingRequiredHeader[] {
    const responses = summary.responses ?? []
    const missing: MissingRequiredHeader[] = []
    const seen = new Set<string>()

    for (const entry of inventoryHeaders) {
      if (!entry.authoriseWith.authorisationInfo.authorised || !entry.requiredOn?.length) continue

      const headerName = this.getRequiredHeaderName(entry)
      if (headerName === null) {
        target.logger.error(`Required header entry '${entry.identifyWith.getDescription()}' must contain one exact anchored HeaderNameMatcher and only presence-safe HeaderName/Host/URL matchers.`)
        continue
      }

      for (const response of responses) {
        if (!entry.requiredOn.includes(response.resourceType)) continue
        if (!entry.identifyWith.identify({ name: headerName, content: '', url: response.url })) continue

        const wasObserved = response.headerNames.has(headerName)
        const key = `${headerName}\u0000${response.resourceType}\u0000${response.url}`
        if (!wasObserved && !seen.has(key)) {
          seen.add(key)
          target.logger.log(`Required header '${headerName}' missing from ${response.resourceType} response '${redactUrl(response.url)}'.`)
          missing.push(new MissingRequiredHeader(target, timestamp, headerName, response.url, response.resourceType, entry))
        }
      }
    }

    return missing
  }

  private getRequiredHeaderName(entry: InventoryHeaderInfo): string | null {
    const isPresenceSafeMatcher = (matcher: InventoryHeaderInfo['identifyWith']): boolean => {
      const matcherType = matcher.getType()
      if (matcherType === 'header-name' || matcherType === 'host' || matcherType === 'url') return true
      if (matcherType !== 'and') return false
      return (matcher.getPattern() as InventoryHeaderInfo['identifyWith'][]).every(isPresenceSafeMatcher)
    }

    if (!isPresenceSafeMatcher(entry.identifyWith)) return null

    const findNames = (matcher: InventoryHeaderInfo['identifyWith']): string[] => {
      if (matcher.getType() === 'header-name') {
        const match = /^\^([a-z0-9-]+)\$$/i.exec(matcher.getPattern() as string)
        return match?.[1] ? [match[1].toLowerCase()] : []
      }
      if (matcher.getType() !== 'and') return []
      return (matcher.getPattern() as InventoryHeaderInfo['identifyWith'][]).flatMap(findNames)
    }

    const names = findNames(entry.identifyWith)
    return names.length === 1 ? names[0]! : null
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

    // Lead every log line with `Header '<host>':'<name>'` so operators can
    // correlate each line back to the response that emitted the header
    // without diffing the Slack table against the run log. The display host
    // is derived from the full URL stored in `header.url`.
    const headerLabel = `Header '${extractHost(header.url)}':'${header.name}'`

    // No match → unknown header
    if (!matchedEntry) {
      target.logger.log(`${headerLabel} not identified in inventory.`)
      return new UnknownHeaderFound(target, timestamp, header)
    }

    // Log identification (T065: use matcher.getDescription() for human-readable output)
    const identifyDescription = matchedEntry.identifyWith.getDescription()
    target.logger.log(`${headerLabel} identified using ${identifyDescription}.`)

    // T064: Authorize value using authoriseWith matcher (BR-4: case-sensitive value matching)
    // T031: Use Matchable interface (hash is optional, no type cast workaround needed)
    // Note: Matcher interface uses Matchable shape, so map header fields:
    // - name stays as name
    // - value → content (matcher expects content field)
    // - hash is omitted for headers (optional field with exactOptionalPropertyTypes)
    const authorizationResult = matchedEntry.authoriseWith.matcher.authorize({
      name: header.name,
      content: header.value,
      ...(header.url !== undefined ? { url: header.url } : {}),
      // hash is omitted for headers (optional field in Matchable interface)
    })
    const isAuthorized = matchedEntry.authoriseWith.authorisationInfo.authorised && authorizationResult.authorized

    // T065: Log authorization result with matcher details
    const authorizeDescription = matchedEntry.authoriseWith.matcher.getDescription()
    const authStatus = isAuthorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authorizationResult.reason || 'authorization failed'})`
    target.logger.log(`${headerLabel}='${header.value}' authorization via ${authorizeDescription}: ${authStatus}.`)

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

      // Pass both canonical content and provenance. Structured Set-Cookie
      // entries use content to distinguish cookie names, while ordinary
      // security headers generally identify by header name + host.
      if (entry.identifyWith.identify({ name: header.name, content: header.value, ...(header.url !== undefined ? { url: header.url } : {}) })) {
        return entry // First match wins (BR-2)
      }
    }
    return undefined
  }
}
