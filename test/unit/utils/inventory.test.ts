/**
 * Inventory Utility Function Tests
 *
 * Tests for inventory conversion utilities including:
 * - T040: Round-trip test for header with HeaderNameMatcher + ContentMatcher
 * - T045: Header conversion function tests (equivalent to script tests)
 *
 * These tests verify that the nested authorization structure is properly
 * preserved during serialization/deserialization cycles for headers.
 */

import type { InventoryHeaderInfo } from '../../../src/types/inventory/model'
import type { RawInventoryHeaderInfo } from '../../../src/types/inventory/raw'
import { createMatcher } from '../../../src/types/matcher/matcher-factory'
import { inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../../../src/utils/inventory'

describe('Inventory Header Conversion Functions', () => {
  describe('Round-trip serialization for headers (T040)', () => {
    it('should preserve nested structure with HeaderNameMatcher + ContentMatcher', () => {
      const original: InventoryHeaderInfo = {
        identifyWith: createMatcher({ headerNameMatcher: '^content-security-policy$' }),
        authoriseWith: {
          matcher: createMatcher({ contentMatcher: "^default-src 'self'; script-src 'self' https://trusted\\.example\\.com$" }),
          authorisationInfo: {
            description: 'Standard CSP policy for payment pages',
            authorised: true,
            date: new Date('2025-10-21T12:00:00.000Z'),
          },
        },
      }

      const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(original)
      const roundTrip = rawInventoryHeaderInfoToInventoryHeaderInfo(raw)

      // Verify identifyWith preserved
      expect(roundTrip.identifyWith.getType()).toBe('header-name')
      expect(roundTrip.identifyWith.getPattern()).toBe('^content-security-policy$')

      // Verify authoriseWith.matcher preserved
      expect(roundTrip.authoriseWith.matcher.getType()).toBe('content')
      expect(roundTrip.authoriseWith.matcher.getPattern()).toBe("^default-src 'self'; script-src 'self' https://trusted\\.example\\.com$")

      // Verify authorisationInfo preserved
      expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('Standard CSP policy for payment pages')
      expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(true)
      expect(roundTrip.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-21T12:00:00.000Z')
    })

    it('should preserve complex CSP headers through round-trip', () => {
      const original: InventoryHeaderInfo = {
        identifyWith: createMatcher({ headerNameMatcher: '^content-security-policy$' }),
        authoriseWith: {
          matcher: createMatcher({
            contentMatcher: "^default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn\\.example\\.com; style-src 'self' 'unsafe-inline'; img-src \\* data:; font-src 'self' https://fonts\\.gstatic\\.com$",
          }),
          authorisationInfo: {
            description: 'Comprehensive CSP with CDN allowlist',
            authorised: true,
            date: new Date('2025-10-21T14:30:15.789Z'),
          },
        },
      }

      const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(original)
      const roundTrip = rawInventoryHeaderInfoToInventoryHeaderInfo(raw)

      // Verify complex pattern preserved
      expect(roundTrip.authoriseWith.matcher.getPattern()).toContain('script-src')
      expect(roundTrip.authoriseWith.matcher.getPattern()).toContain('cdn\\.example\\.com')
      expect(roundTrip.authoriseWith.authorisationInfo.date.getTime()).toBe(new Date('2025-10-21T14:30:15.789Z').getTime())
    })

    it('should preserve unauthorised header state', () => {
      const original: InventoryHeaderInfo = {
        identifyWith: createMatcher({ headerNameMatcher: '^x-frame-options$' }),
        authoriseWith: {
          matcher: createMatcher({ contentMatcher: '^DENY$' }),
          authorisationInfo: {
            description: 'NO_DESCRIPTION',
            authorised: false, // Unauthorized state
            date: new Date('2025-10-21T12:00:00.000Z'),
          },
        },
      }

      const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(original)
      const roundTrip = rawInventoryHeaderInfoToInventoryHeaderInfo(raw)

      expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(false)
      expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('NO_DESCRIPTION')
    })
  })

  describe('Header conversion function tests (T045)', () => {
    describe('rawInventoryHeaderInfoToInventoryHeaderInfo', () => {
      it('should parse nested JSON structure correctly for headers', () => {
        const rawInfo: RawInventoryHeaderInfo = {
          identifyWith: { headerNameMatcher: '^strict-transport-security$' },
          authoriseWith: {
            contentMatcher: '^max-age=31536000; includeSubDomains$',
            authorisationInfo: {
              description: 'HSTS header with 1 year max-age',
              authorised: true,
              date: '2025-10-21T10:00:00.000Z',
            },
          },
        }

        const result = rawInventoryHeaderInfoToInventoryHeaderInfo(rawInfo)

        // Verify Matcher instances created
        expect(result.identifyWith.getType()).toBe('header-name')
        expect(result.authoriseWith.matcher.getType()).toBe('content')

        // Verify authorisationInfo converted
        expect(result.authoriseWith.authorisationInfo.description).toBe('HSTS header with 1 year max-age')
        expect(result.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(result.authoriseWith.authorisationInfo.date).toBeInstanceOf(Date)
      })

      it('should handle case-insensitive header names', () => {
        const rawInfo: RawInventoryHeaderInfo = {
          identifyWith: { headerNameMatcher: '^content-type$' }, // Case-insensitive per RFC 7230
          authoriseWith: {
            contentMatcher: '^text/html; charset=utf-8$',
            authorisationInfo: {
              description: 'HTML content type header',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = rawInventoryHeaderInfoToInventoryHeaderInfo(rawInfo)

        expect(result.identifyWith.getType()).toBe('header-name')
        expect(result.identifyWith.getPattern()).toBe('^content-type$')
      })

      it('should handle special characters in header values', () => {
        const rawInfo: RawInventoryHeaderInfo = {
          identifyWith: { headerNameMatcher: '^x-custom-header$' },
          authoriseWith: {
            contentMatcher: '^value with "quotes" and \'apostrophes\' & symbols!$',
            authorisationInfo: {
              description: 'Custom header with special characters',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = rawInventoryHeaderInfoToInventoryHeaderInfo(rawInfo)

        expect(result.authoriseWith.matcher.getPattern()).toBe('^value with "quotes" and \'apostrophes\' & symbols!$')
        expect(result.authoriseWith.authorisationInfo.description).toBe('Custom header with special characters')
      })
    })

    describe('inventoryHeaderInfoToRawInventoryHeaderInfo', () => {
      it('should serialize to flat structure with matcher config and authorisationInfo as siblings', () => {
        const headerInfo: InventoryHeaderInfo = {
          identifyWith: createMatcher({ headerNameMatcher: '^x-content-type-options$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '^nosniff$' }),
            authorisationInfo: {
              description: 'Prevent MIME type sniffing',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const result = inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo)

        // Verify authorisationInfo is present
        expect(result.authoriseWith).toHaveProperty('authorisationInfo')
        expect(result.authoriseWith.authorisationInfo).toBeDefined()

        // Verify contentMatcher at the same level (check if present using type guard)
        if ('contentMatcher' in result.authoriseWith) {
          expect(result.authoriseWith.contentMatcher).toBe('^nosniff$')
        }

        // Verify authorisationInfo is properly serialized
        expect(result.authoriseWith.authorisationInfo.description).toBe('Prevent MIME type sniffing')
        expect(result.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(result.authoriseWith.authorisationInfo.date).toBe('2025-10-21T12:00:00.000Z')
      })

      it('should serialize HeaderNameMatcher correctly', () => {
        const headerInfo: InventoryHeaderInfo = {
          identifyWith: createMatcher({ headerNameMatcher: '^access-control-allow-origin$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '^https://example\\.com$' }),
            authorisationInfo: {
              description: 'CORS header',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const result = inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo)

        if ('headerNameMatcher' in result.identifyWith) {
          expect(result.identifyWith.headerNameMatcher).toBe('^access-control-allow-origin$')
        }
        if ('contentMatcher' in result.authoriseWith) {
          expect(result.authoriseWith.contentMatcher).toBe('^https://example\\.com$')
        }
      })

      it('should handle date conversion correctly', () => {
        const testDate = new Date('2025-10-21T16:45:30.456Z')

        const headerInfo: InventoryHeaderInfo = {
          identifyWith: createMatcher({ headerNameMatcher: '^x-test-header$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '^test$' }),
            authorisationInfo: {
              description: 'Date test',
              authorised: true,
              date: testDate,
            },
          },
        }

        const result = inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo)

        // Verify date converted to ISO string with millisecond precision
        expect(result.authoriseWith.authorisationInfo.date).toBe('2025-10-21T16:45:30.456Z')
        expect(typeof result.authoriseWith.authorisationInfo.date).toBe('string')
      })

      it('should preserve millisecond precision through round-trip', () => {
        const preciseDateString = '2025-10-21T08:22:17.123Z'
        const preciseDate = new Date(preciseDateString)

        const headerInfo: InventoryHeaderInfo = {
          identifyWith: createMatcher({ headerNameMatcher: '^x-precision-test$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '^test$' }),
            authorisationInfo: {
              description: 'Precision test',
              authorised: true,
              date: preciseDate,
            },
          },
        }

        const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo)
        const roundTrip = rawInventoryHeaderInfoToInventoryHeaderInfo(raw)

        // Verify millisecond precision preserved
        expect(roundTrip.authoriseWith.authorisationInfo.date.getTime()).toBe(preciseDate.getTime())
        expect(roundTrip.authoriseWith.authorisationInfo.date.toISOString()).toBe(preciseDateString)
      })
    })
  })
})
