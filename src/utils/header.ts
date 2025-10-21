import type { HeaderName, HeaderValues } from '../types/header'
import type { InventoryHeaderInfo } from '../types/inventory/model'
import { createMatcher } from '../types/matcher/matcher-factory'
import { escapeRegex } from './string'

/**
 * Converts unauthorized headers to InventoryHeaderInfo entries for new header discovery.
 *
 * Updated for Phase 5 - US3:
 * - identifyWith: HeaderNameMatcher with exact header name match (case-insensitive)
 * - authoriseWith: ContentMatcher with escaped exact value match (case-sensitive)
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
        authoriseWith: createMatcher({ contentMatcher: headerValuePattern }),
        authorisationInfo: {
          description: 'NO_DESCRIPTION',
          authorised: false,
          date: date,
        },
      }
    })
  })
}
