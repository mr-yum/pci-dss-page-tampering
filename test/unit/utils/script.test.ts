/**
 * Script Conversion Function Tests
 *
 * Tests for script conversion utilities including:
 * - T036-T039: Round-trip serialization tests
 * - T041: Round-trip test for authorised:false entries
 * - T042-T044: Conversion function tests
 * - T046: Date conversion tests
 *
 * These tests verify that the nested authorization structure is properly
 * preserved during serialization/deserialization cycles.
 */

import type { InventoryScriptInfo } from '../../../src/types/inventory/model'
import type { RawInventoryScriptInfo } from '../../../src/types/inventory/raw'
import { AndMatcher } from '../../../src/types/matcher/and-matcher'
import { ContentMatcher } from '../../../src/types/matcher/content-matcher'
import { HashMatcher } from '../../../src/types/matcher/hash-matcher'
import { createMatcher } from '../../../src/types/matcher/matcher-factory'
import { OrMatcher } from '../../../src/types/matcher/or-matcher'
import type { ScriptInfo } from '../../../src/types/script'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo, scriptInfoToInventoryScriptInfo } from '../../../src/utils/script'

describe('Script Conversion Functions', () => {
  describe('Round-trip serialization (T036-T041)', () => {
    describe('T037: Round-trip test for script with NameMatcher + HashMatcher', () => {
      it('should preserve nested structure with NameMatcher + HashMatcher', () => {
        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/script\\.js$' }),
          authoriseWith: {
            matcher: createMatcher({
              hashes: [
                {
                  timestamp: new Date('2025-10-21T12:00:00.000Z'),
                  hash: { value: 'abc123'.padEnd(64, '0') },
                },
              ],
            }),
            authorisationInfo: {
              description: 'Analytics script for conversion tracking',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        // Verify identifyWith preserved
        expect(roundTrip.identifyWith.getType()).toBe('name')
        expect(roundTrip.identifyWith.getPattern()).toBe('^https://example\\.com/script\\.js$')

        // Verify authoriseWith.matcher preserved
        expect(roundTrip.authoriseWith.matcher.getType()).toBe('hash')

        // Verify authorisationInfo preserved
        expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('Analytics script for conversion tracking')
        expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(roundTrip.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-21T12:00:00.000Z')
      })

      it('should preserve hash details through round-trip', () => {
        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://cdn\\.example\\.com/.*$' }),
          authoriseWith: {
            matcher: createMatcher({
              hashes: [
                {
                  timestamp: new Date('2025-10-21T10:30:45.123Z'),
                  hash: { value: 'deadbeef'.padEnd(64, 'a') },
                },
              ],
            }),
            authorisationInfo: {
              description: 'CDN script with hash verification',
              authorised: true,
              date: new Date('2025-10-21T10:30:45.123Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        const hashes = roundTrip.authoriseWith.matcher.getPattern() as Array<{
          timestamp: Date
          hash: { value: string }
        }>

        expect(hashes).toHaveLength(1)
        expect(hashes[0]!.hash.value).toBe('deadbeef'.padEnd(64, 'a'))
        expect(hashes[0]!.timestamp.toISOString()).toBe('2025-10-21T10:30:45.123Z')
      })
    })

    describe('T038: Round-trip test for script with ContentMatcher', () => {
      it('should preserve nested structure with ContentMatcher', () => {
        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ contentMatcher: '__NEXT_DATA__' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '__NEXT_DATA__.*"environment":"production"' }),
            authorisationInfo: {
              description: 'Next.js data script with production environment',
              authorised: true,
              date: new Date('2025-10-21T15:45:30.000Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        // Verify identifyWith preserved
        expect(roundTrip.identifyWith.getType()).toBe('content')
        expect(roundTrip.identifyWith.getPattern()).toBe('__NEXT_DATA__')

        // Verify authoriseWith.matcher preserved
        expect(roundTrip.authoriseWith.matcher.getType()).toBe('content')
        expect(roundTrip.authoriseWith.matcher.getPattern()).toBe('__NEXT_DATA__.*"environment":"production"')

        // Verify authorisationInfo preserved
        expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('Next.js data script with production environment')
        expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(true)
      })
    })

    describe('T039: Round-trip test verifying authorisationInfo preservation', () => {
      it('should preserve all authorisationInfo fields', () => {
        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^inline-script-[0-9]+$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: 'analytics\\.track\\(' }),
            authorisationInfo: {
              description: 'Inline analytics tracking script with special characters: "quotes", \'apostrophes\', & symbols',
              authorised: true,
              date: new Date('2025-10-21T08:15:22.456Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        // Verify description with special characters preserved
        expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('Inline analytics tracking script with special characters: "quotes", \'apostrophes\', & symbols')

        // Verify authorised flag preserved
        expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(true)

        // Verify date precision preserved (milliseconds)
        expect(roundTrip.authoriseWith.authorisationInfo.date.getTime()).toBe(new Date('2025-10-21T08:15:22.456Z').getTime())
      })

      it('should preserve long descriptions', () => {
        const longDescription = 'A'.repeat(1000) // Very long description

        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: 'test' }),
            authorisationInfo: {
              description: longDescription,
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        expect(roundTrip.authoriseWith.authorisationInfo.description).toBe(longDescription)
        expect(roundTrip.authoriseWith.authorisationInfo.description.length).toBe(1000)
      })
    })

    describe('T041: Round-trip test for authorised:false entries', () => {
      it('should preserve unauthorised state (authorised:false)', () => {
        const original: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://new\\.com/script\\.js$' }),
          authoriseWith: {
            matcher: createMatcher({
              hashes: [
                {
                  timestamp: new Date('2025-10-21T12:00:00.000Z'),
                  hash: { value: 'new'.padEnd(64, '0') },
                },
              ],
            }),
            authorisationInfo: {
              description: 'NO_DESCRIPTION',
              authorised: false, // Unauthorized state
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        // Verify unauthorised state preserved
        expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(false)
        expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('NO_DESCRIPTION')
      })
    })
  })

  describe('Conversion function tests (T042-T044, T046)', () => {
    describe('T042: scriptInfoToInventoryScriptInfo creates nested structure', () => {
      it('should create nested authoriseWith structure for external script', () => {
        const scriptInfo: ScriptInfo = {
          source: { type: 'external', url: 'https://cdn.example.com/analytics.js' },
          hash: { value: 'test'.padEnd(64, '0') },
        }

        const date = new Date('2025-10-21T12:00:00.000Z')
        const result = scriptInfoToInventoryScriptInfo(scriptInfo, date)

        // Verify nested structure created
        expect(result.authoriseWith).toHaveProperty('matcher')
        expect(result.authoriseWith).toHaveProperty('authorisationInfo')

        // Verify matcher is hash-based
        expect(result.authoriseWith.matcher.getType()).toBe('hash')

        // Verify authorisationInfo has correct default values
        expect(result.authoriseWith.authorisationInfo.description).toBe('NO_DESCRIPTION')
        expect(result.authoriseWith.authorisationInfo.authorised).toBe(false)
        expect(result.authoriseWith.authorisationInfo.date).toEqual(date)
      })

      it('should create nested authoriseWith structure for inline script', () => {
        const scriptInfo: ScriptInfo = {
          source: { type: 'inline', id: 'inline-script-123', content: 'console.log("inline")' },
          hash: { value: 'inline'.padEnd(64, '0') },
        }

        const date = new Date('2025-10-21T14:30:00.000Z')
        const result = scriptInfoToInventoryScriptInfo(scriptInfo, date)

        // Verify identifyWith uses inline ID
        expect(result.identifyWith.getPattern()).toBe('^inline-script-123$')

        // Verify nested structure
        expect(result.authoriseWith.matcher).toBeDefined()
        expect(result.authoriseWith.authorisationInfo).toBeDefined()
        expect(result.authoriseWith.authorisationInfo.date).toEqual(date)
      })
    })

    describe('T043: rawInventoryScriptInfoToInventoryScriptInfo parses nested JSON', () => {
      it('should parse nested JSON structure correctly', () => {
        const rawInfo: RawInventoryScriptInfo = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: new Date('2025-10-21T12:00:00.000Z'),
                hash: { value: 'abc'.padEnd(64, '0') },
              },
            ],
            authorisationInfo: {
              description: 'Test script from JSON',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = rawInventoryScriptInfoToInventoryScriptInfo(rawInfo)

        // Verify Matcher instances created
        expect(result.identifyWith.getType()).toBe('name')
        expect(result.authoriseWith.matcher.getType()).toBe('hash')

        // Verify authorisationInfo converted
        expect(result.authoriseWith.authorisationInfo.description).toBe('Test script from JSON')
        expect(result.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(result.authoriseWith.authorisationInfo.date).toBeInstanceOf(Date)
      })

      it('should handle contentMatcher in nested structure', () => {
        const rawInfo: RawInventoryScriptInfo = {
          identifyWith: { contentMatcher: 'fbq\\(' },
          authoriseWith: {
            contentMatcher: 'fbq\\(.*init',
            authorisationInfo: {
              description: 'Facebook Pixel script',
              authorised: true,
              date: '2025-10-21T10:00:00.000Z',
            },
          },
        }

        const result = rawInventoryScriptInfoToInventoryScriptInfo(rawInfo)

        expect(result.identifyWith.getType()).toBe('content')
        expect(result.authoriseWith.matcher.getType()).toBe('content')
        expect(result.authoriseWith.authorisationInfo.description).toBe('Facebook Pixel script')
      })
    })

    describe('T044: inventoryScriptInfoToRawInventoryScriptInfo serializes flat structure', () => {
      it('should serialize to flat structure with matcher config and authorisationInfo as siblings', () => {
        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://test\\.com/.*$' }),
          authoriseWith: {
            matcher: createMatcher({
              hashes: [
                {
                  timestamp: new Date('2025-10-21T12:00:00.000Z'),
                  hash: { value: 'test'.padEnd(64, '0') },
                },
              ],
            }),
            authorisationInfo: {
              description: 'Test for serialization',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const result = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)

        // Verify authorisationInfo is present
        expect(result.authoriseWith).toHaveProperty('authorisationInfo')
        expect(result.authoriseWith.authorisationInfo).toBeDefined()

        // Verify authorisationInfo is properly serialized
        expect(result.authoriseWith.authorisationInfo.description).toBe('Test for serialization')
        expect(result.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(result.authoriseWith.authorisationInfo.date).toBe('2025-10-21T12:00:00.000Z')

        // Verify hashes are at the same level (check if present using type guard)
        if ('hashes' in result.authoriseWith) {
          expect(result.authoriseWith.hashes).toBeDefined()
        }
      })

      it('should serialize NameMatcher correctly', () => {
        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/script\\.js$' }),
          authoriseWith: {
            matcher: createMatcher({ nameMatcher: '^https://example\\.com/script\\.js\\?v=[0-9]+$' }),
            authorisationInfo: {
              description: 'Versioned script',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const result = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)

        expect(result.identifyWith).toHaveProperty('nameMatcher')
        if ('nameMatcher' in result.authoriseWith) {
          expect(result.authoriseWith.nameMatcher).toBe('^https://example\\.com/script\\.js\\?v=[0-9]+$')
        }
      })

      it('should serialize ContentMatcher correctly', () => {
        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ contentMatcher: 'analytics' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: 'analytics\\.track' }),
            authorisationInfo: {
              description: 'Analytics tracking',
              authorised: true,
              date: new Date('2025-10-21T12:00:00.000Z'),
            },
          },
        }

        const result = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)

        expect(result.identifyWith).toHaveProperty('contentMatcher')
        if ('contentMatcher' in result.authoriseWith) {
          expect(result.authoriseWith.contentMatcher).toBe('analytics\\.track')
        }
      })
    })

    describe('T046: Date conversion (ISO string ↔ Date)', () => {
      it('should convert Date to ISO string during serialization', () => {
        const testDate = new Date('2025-10-21T15:45:30.123Z')

        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: 'test' }),
            authorisationInfo: {
              description: 'Date conversion test',
              authorised: true,
              date: testDate,
            },
          },
        }

        const result = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)

        // Verify date converted to ISO string
        expect(result.authoriseWith.authorisationInfo.date).toBe('2025-10-21T15:45:30.123Z')
        expect(typeof result.authoriseWith.authorisationInfo.date).toBe('string')
      })

      it('should convert ISO string to Date during deserialization', () => {
        const rawInfo: RawInventoryScriptInfo = {
          identifyWith: { nameMatcher: '^test$' },
          authoriseWith: {
            contentMatcher: 'test',
            authorisationInfo: {
              description: 'Date conversion test',
              authorised: true,
              date: '2025-10-21T15:45:30.123Z',
            },
          },
        }

        const result = rawInventoryScriptInfoToInventoryScriptInfo(rawInfo)

        // Verify date converted to Date instance
        expect(result.authoriseWith.authorisationInfo.date).toBeInstanceOf(Date)
        expect(result.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-21T15:45:30.123Z')
      })

      it('should preserve millisecond precision through round-trip', () => {
        const preciseDateString = '2025-10-21T10:30:45.789Z'
        const preciseDate = new Date(preciseDateString)

        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: 'test' }),
            authorisationInfo: {
              description: 'Precision test',
              authorised: true,
              date: preciseDate,
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)
        const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

        // Verify millisecond precision preserved
        expect(roundTrip.authoriseWith.authorisationInfo.date.getTime()).toBe(preciseDate.getTime())
        expect(roundTrip.authoriseWith.authorisationInfo.date.toISOString()).toBe(preciseDateString)
      })
    })
  })

  describe('Composite matcher serialization (T018-T022)', () => {
    describe('T018: serializeAuthorisationInfo() date conversion', () => {
      it('should convert Date to ISO string with millisecond precision', () => {
        const date = new Date('2025-10-24T12:34:56.789Z')
        const inventoryInfo: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: new OrMatcher([new ContentMatcher('pattern')], {
              description: 'Test',
              authorised: true,
              date,
            }),
            authorisationInfo: {
              description: 'Outer',
              authorised: true,
              date,
            },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryInfo)

        expect(raw.authoriseWith.authorisationInfo.date).toBe('2025-10-24T12:34:56.789Z')
        expect(typeof raw.authoriseWith.authorisationInfo.date).toBe('string')
      })
    })

    describe('T019: OrMatcher serialization with HashMatcher children', () => {
      it('should serialize OrMatcher with two HashMatcher children', () => {
        const inventoryScript: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/.*$' }),
          authoriseWith: {
            matcher: new OrMatcher(
              [
                new HashMatcher([{ timestamp: new Date('2025-10-01T00:00:00.000Z'), hash: { value: 'abc123'.padEnd(64, '0') } }]),
                new HashMatcher([{ timestamp: new Date('2025-10-15T00:00:00.000Z'), hash: { value: 'def456'.padEnd(64, '0') } }]),
              ],
              {
                description: 'Accept version 1.0 or 1.1',
                authorised: true,
                date: new Date('2025-10-24T12:00:00.000Z'),
              },
            ),
            authorisationInfo: { description: 'Analytics', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

        expect(raw.authoriseWith).toHaveProperty('orMatcher')
        expect((raw.authoriseWith as any).orMatcher).toHaveLength(2)
        expect((raw.authoriseWith as any).orMatcher[0]).toHaveProperty('hashes')
        expect((raw.authoriseWith as any).orMatcher[1]).toHaveProperty('hashes')
        expect(raw.authoriseWith.authorisationInfo.date).toBe('2025-10-24T00:00:00.000Z')
      })
    })

    describe('T020: AndMatcher serialization with ContentMatcher children', () => {
      it('should serialize AndMatcher with ContentMatcher children', () => {
        const inventoryScript: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: new AndMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')]),
            authorisationInfo: { description: 'Test', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

        expect(raw.authoriseWith).toHaveProperty('andMatcher')
        expect((raw.authoriseWith as any).andMatcher).toHaveLength(2)
        expect((raw.authoriseWith as any).andMatcher[0]).toHaveProperty('contentMatcher')
        expect((raw.authoriseWith as any).andMatcher[1]).toHaveProperty('contentMatcher')
      })
    })

    describe('T021: Composite matcher serialization WITH authorisationInfo', () => {
      it('should serialize OrMatcher with nested authorisationInfo', () => {
        const inventoryScript: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')], {
              description: 'OR matcher authorization',
              authorised: true,
              date: new Date('2025-10-24T12:00:00.000Z'),
            }),
            authorisationInfo: { description: 'Outer', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

        expect((raw.authoriseWith as any).authorisationInfo).toBeDefined()
        expect((raw.authoriseWith as any).authorisationInfo.description).toBe('OR matcher authorization')
        expect((raw.authoriseWith as any).authorisationInfo.date).toBe('2025-10-24T12:00:00.000Z')
      })
    })

    describe('T022: Composite matcher serialization WITHOUT authorisationInfo', () => {
      it('should serialize OrMatcher without nested authorisationInfo', () => {
        const inventoryScript: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^test$' }),
          authoriseWith: {
            matcher: new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')]),
            authorisationInfo: { description: 'Outer', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

        expect((raw.authoriseWith as any).orMatcher).toBeDefined()
        // The orMatcher's authorisationInfo should be undefined (not present at nested level)
        // Only the outer authorisationInfo should be present
        expect(raw.authoriseWith.authorisationInfo).toBeDefined()
        expect(raw.authoriseWith.authorisationInfo.description).toBe('Outer')
      })
    })
  })
})
