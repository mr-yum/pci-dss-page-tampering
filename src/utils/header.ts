import type { DetectedHeader, HeaderName, HeaderValues } from '../types/header.js'
import type { InventoryHeaderInfo } from '../types/inventory/model.js'
import type { Matchable } from '../types/matcher/matcher.interface.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { Target } from '../types/target.js'
import { escapeRegex } from './string.js'

/**
 * Map a detected header onto the `Matchable` shape used for authorisation.
 *
 * Headers do not line up with the interface field-for-field: the header *value*
 * is the content, and there is no hash. Extracted so the auditor report can
 * replay an authorisation through the very same mapping the comparison service
 * used — a second, hand-rolled copy would silently drift and produce a report
 * that disagrees with what the system actually decided.
 *
 * @see ../services/comparison/header.ts for the original call site
 */
export function detectedHeaderToMatchable(header: DetectedHeader, target: Target): Matchable {
  return {
    name: header.name,
    content: header.value,
    workflowId: target.workflowId ?? 'default',
    ...(header.url !== undefined ? { url: header.url } : {}),
    // hash is omitted for headers (optional field in Matchable interface)
  }
}

/**
 * Converts unauthorized headers to InventoryHeaderInfo entries for new header discovery.
 *
 * Updated for Phase 5 - US3:
 * - identifyWith: HeaderNameMatcher with exact header name match (case-insensitive)
 * - authoriseWith: AuthorizeWithConfig with ContentMatcher and authorization metadata
 * - This is used during inventory workflow when discovering new headers
 */
export function unauthorisedHeadersToInventoryHeaderInfo(headers: Map<HeaderName, HeaderValues>, date: Date): InventoryHeaderInfo[] {
  return [...headers].flatMap(([headerName, headerValues]) => {
    const headerValuesArray = [...headerValues.values()]
    return headerValuesArray.map<InventoryHeaderInfo>((headerValue) => {
      // Use lowercase for header name pattern (HeaderNameMatcher normalizes to lowercase anyway)
      const headerNamePattern = `^${headerName.toLowerCase()}$`
      const headerValuePattern = `^${escapeRegex(headerValue)}$`

      return {
        identifyWith: createMatcher({ headerNameMatcher: headerNamePattern }),
        authoriseWith: {
          matcher: createMatcher({ contentMatcher: headerValuePattern }),
          authorisationInfo: {
            description: 'NO_DESCRIPTION',
            authorised: false,
            date: date,
          },
        },
      }
    })
  })
}
