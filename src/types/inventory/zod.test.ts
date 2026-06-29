/**
 * Zod Schema Validation Tests
 *
 * Tests for MatcherConfig schema validation and RawInventoryScriptInfo schema.
 * Covers:
 * - Invalid regex patterns (T027)
 * - Missing required fields (T027)
 * - Empty hashes array (T027)
 * - Old schema format rejection (T028)
 * - Valid nameMatcher + hashes combination (T029)
 * - Same matcher type for both identifyWith and authoriseWith (T030)
 *
 * @see ../../../specs/001-refactor-script-identification/research.md R6 for error message requirements
 */

import { MatcherConfigSchema } from './matcher-config-schema.js'
import { AlertDestinationSchema, InventoryAlertSchema, RawInventoryScriptInfoSchema } from './zod.js'

describe('MatcherConfigSchema', () => {
  describe('Invalid regex patterns (T027)', () => {
    it('should reject nameMatcher with invalid regex (unclosed bracket)', () => {
      const result = MatcherConfigSchema.safeParse({ nameMatcher: '^https://example.com/[' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('Invalid regex in nameMatcher')
        expect(result.error.issues[0]!.message).toContain('^https://example.com/[')
        expect(result.error.issues[0]!.message).toContain('Ensure all brackets are closed')
      }
    })

    it('should reject contentMatcher with invalid regex (unclosed parenthesis)', () => {
      const result = MatcherConfigSchema.safeParse({ contentMatcher: "fbq('init" })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('Invalid regex in contentMatcher')
        expect(result.error.issues[0]!.message).toContain('fbq')
      }
    })

    it('should reject nameMatcher with unbalanced parentheses', () => {
      const result = MatcherConfigSchema.safeParse({ nameMatcher: '^(https://example.com' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('Invalid regex in nameMatcher')
      }
    })
  })

  describe('Empty or missing values (T027)', () => {
    it('should reject empty nameMatcher string', () => {
      const result = MatcherConfigSchema.safeParse({ nameMatcher: '' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('must not be empty')
      }
    })

    it('should reject empty contentMatcher string', () => {
      const result = MatcherConfigSchema.safeParse({ contentMatcher: '' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('must not be empty')
      }
    })

    it('should reject empty hashes array', () => {
      const result = MatcherConfigSchema.safeParse({ hashes: [] })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('at least 1 hash')
      }
    })
  })

  describe('Valid patterns', () => {
    it('should accept valid nameMatcher', () => {
      const result = MatcherConfigSchema.safeParse({ nameMatcher: '^https://example\\.com/.*$' })

      expect(result.success).toBe(true)
    })

    it('should accept valid contentMatcher', () => {
      const result = MatcherConfigSchema.safeParse({ contentMatcher: "fbq\\('init'" })

      expect(result.success).toBe(true)
    })

    it('should accept hashes array with valid hash', () => {
      const result = MatcherConfigSchema.safeParse({
        hashes: [
          {
            timestamp: '2025-10-15T00:00:00.000Z',
            hash: { value: 'a'.repeat(64) }, // Valid 64-character hex
          },
        ],
      })

      expect(result.success).toBe(true)
    })
  })
})

describe('RawInventoryScriptInfoSchema', () => {
  describe('Old schema format rejection (T028)', () => {
    it('should reject old schema format with nameMatcher/contentMatcher/hashes fields', () => {
      const oldFormat = {
        nameMatcher: '^https://example\\.com/.*$',
        contentMatcher: 'fbq',
        hashes: [
          {
            timestamp: '2025-10-15T00:00:00.000Z',
            hash: { value: 'a'.repeat(64) },
          },
        ],
        authorisationInfo: {
          description: 'Test script',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(oldFormat)

      expect(result.success).toBe(false)
      if (!result.success) {
        // Should fail because identifyWith and authoriseWith are missing
        const issues = result.error.issues.map((issue) => issue.path.join('.'))
        expect(issues).toContain('identifyWith')
        expect(issues).toContain('authoriseWith')
      }
    })

    it('should reject schema with only identifyWith (missing authoriseWith)', () => {
      const result = RawInventoryScriptInfoSchema.safeParse({
        identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
        authorisationInfo: {
          description: 'Test script',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
        },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        const issues = result.error.issues.map((issue) => issue.path.join('.'))
        expect(issues).toContain('authoriseWith')
      }
    })

    it('should reject schema with only authoriseWith (missing identifyWith)', () => {
      const result = RawInventoryScriptInfoSchema.safeParse({
        authoriseWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'a'.repeat(64) },
            },
          ],
        },
        authorisationInfo: {
          description: 'Test script',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
        },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        const issues = result.error.issues.map((issue) => issue.path.join('.'))
        expect(issues).toContain('identifyWith')
      }
    })
  })

  describe('Valid nameMatcher + hashes schema (T029)', () => {
    it('should accept nameMatcher for identify and hashes for authorize', () => {
      const validSchema = {
        identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/.*$' },
        authoriseWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'abc123'.padEnd(64, '0') },
            },
          ],
          authorisationInfo: {
            description: 'External CDN script with hash verification',
            authorised: true,
            date: '2025-10-15T00:00:00.000Z',
          },
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.identifyWith).toHaveProperty('nameMatcher')
        expect(result.data.authoriseWith).toHaveProperty('hashes')
      }
    })

    it('should accept contentMatcher for identify and hashes for authorize', () => {
      const validSchema = {
        identifyWith: { contentMatcher: "fbq\\('init'" },
        authoriseWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'def456'.padEnd(64, '0') },
            },
          ],
          authorisationInfo: {
            description: 'Inline script identified by content pattern',
            authorised: true,
            date: '2025-10-15T00:00:00.000Z',
          },
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
    })
  })

  describe('Same matcher type for both fields (T030)', () => {
    it('should accept nameMatcher for both identifyWith and authoriseWith', () => {
      const validSchema = {
        identifyWith: { nameMatcher: '^https://example\\.com/script\\.js.*$' },
        authoriseWith: {
          nameMatcher: '^https://example\\.com/script\\.js\\?v=[0-9]+$',
          authorisationInfo: {
            description: 'Script identified and authorized by name pattern',
            authorised: true,
            date: '2025-10-15T00:00:00.000Z',
          },
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
    })

    it('should accept contentMatcher for both identifyWith and authoriseWith', () => {
      const validSchema = {
        identifyWith: { contentMatcher: '__NEXT_DATA__' },
        authoriseWith: {
          contentMatcher: '__NEXT_DATA__.*"environment":"production"',
          authorisationInfo: {
            description: 'Next.js data script with production environment check',
            authorised: true,
            date: '2025-10-15T00:00:00.000Z',
          },
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
    })

    it('should accept hashes for both identifyWith and authoriseWith', () => {
      const validSchema = {
        identifyWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'a'.repeat(64) },
            },
          ],
        },
        authoriseWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'a'.repeat(64) },
            },
          ],
          authorisationInfo: {
            description: 'Script with hash-based identification and authorization',
            authorised: true,
            date: '2025-10-15T00:00:00.000Z',
          },
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
    })
  })

  describe('Error messages provide debugging context (T027)', () => {
    it('should include pattern and field name in error message', () => {
      const result = RawInventoryScriptInfoSchema.safeParse({
        identifyWith: { nameMatcher: '^[unclosed' },
        authoriseWith: {
          hashes: [
            {
              timestamp: '2025-10-15T00:00:00.000Z',
              hash: { value: 'a'.repeat(64) },
            },
          ],
        },
        authorisationInfo: {
          description: 'Test',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
        },
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        const errorMessage = result.error.issues[0]!.message
        // Error message includes the matcher type and the invalid pattern
        expect(errorMessage).toContain('nameMatcher')
        expect(errorMessage).toContain('^[unclosed')
        expect(errorMessage).toContain('Invalid regex')
      }
    })
  })

  describe('Phase 4 Schema Validation Tests (T030-T035)', () => {
    describe('T030: Valid nested structure', () => {
      it('should validate correct nested structure with nameMatcher', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            nameMatcher: '^https://example\\.com/script\\.js$',
            authorisationInfo: {
              description: 'Test script',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should validate correct nested structure with hashes', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: '2025-10-21T12:00:00.000Z',
                hash: { value: 'a'.repeat(64) },
              },
            ],
            authorisationInfo: {
              description: 'Test script',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should validate correct nested structure with contentMatcher', () => {
        const validSchema = {
          identifyWith: { contentMatcher: '__NEXT_DATA__' },
          authoriseWith: {
            contentMatcher: '__NEXT_DATA__.*"environment":"production"',
            authorisationInfo: {
              description: 'Next.js data script',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })
    })

    describe('T031: Missing authorisationInfo fails validation', () => {
      it('should reject authoriseWith without authorisationInfo', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            nameMatcher: '^https://example\\.com/script\\.js$',
            // authorisationInfo missing
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          const issues = result.error.issues.map((issue) => issue.path.join('.'))
          // After FR-006 (array syntax support), authoriseWith is a union (single or array)
          // Error path is now 'authoriseWith' (union didn't match) instead of 'authoriseWith.authorisationInfo'
          expect(issues).toContain('authoriseWith')
        }
      })
    })

    describe('T032: Missing matcher field fails validation', () => {
      it('should reject authoriseWith with only authorisationInfo (no matcher)', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            // No nameMatcher/contentMatcher/hashes/headerNameMatcher
            authorisationInfo: {
              description: 'Test script',
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0)
        }
      })
    })

    describe('T033: Empty description fails validation', () => {
      it('should reject empty description string', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            nameMatcher: '^https://example\\.com/script\\.js$',
            authorisationInfo: {
              description: '', // Empty string
              authorised: true,
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          // Verify that one of the issues is about the description field
          const descriptionIssues = result.error.issues.filter((issue) => issue.path.join('.').includes('description'))
          expect(descriptionIssues.length).toBeGreaterThan(0)
        }
      })
    })

    describe('T034: Invalid date format fails validation', () => {
      it('should reject invalid date format', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            nameMatcher: '^https://example\\.com/script\\.js$',
            authorisationInfo: {
              description: 'Test script',
              authorised: true,
              date: 'not-a-valid-date',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map((issue) => issue.message)
          expect(errorMessages.some((msg) => msg.includes('datetime') || msg.includes('Invalid'))).toBe(true)
        }
      })

      it('should reject non-ISO date format', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            nameMatcher: '^https://example\\.com/script\\.js$',
            authorisationInfo: {
              description: 'Test script',
              authorised: true,
              date: '10/21/2025',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
      })
    })

    describe('T035: Unauthorized entry (authorised:false) passes validation', () => {
      it('should accept authorised:false as valid state', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: '2025-10-21T12:00:00.000Z',
                hash: { value: 'a'.repeat(64) },
              },
            ],
            authorisationInfo: {
              description: 'NO_DESCRIPTION',
              authorised: false, // Unauthorized state
              date: '2025-10-21T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.authoriseWith.authorisationInfo.authorised).toBe(false)
        }
      })
    })
  })

  describe('Phase 5: Array Syntax Support (T052)', () => {
    describe('Array syntax for authoriseWith', () => {
      it('should accept array with two content matchers', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              contentMatcher: 'pattern-one',
              authorisationInfo: {
                description: 'First pattern',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
            {
              contentMatcher: 'pattern-two',
              authorisationInfo: {
                description: 'Second pattern',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should accept array with single matcher (edge case)', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              contentMatcher: 'single-pattern',
              authorisationInfo: {
                description: 'Single element array',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should accept array with mixed matcher types', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              contentMatcher: 'content-pattern',
              authorisationInfo: {
                description: 'Content matcher',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
            {
              nameMatcher: '^https://example\\.com/specific\\.js$',
              authorisationInfo: {
                description: 'Name matcher',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should reject empty array (fail-secure)', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          const errorMessages = result.error.issues.map((issue) => issue.message)
          expect(errorMessages.some((msg) => msg.includes('at least 1'))).toBe(true)
        }
      })

      it('should reject array element without authorisationInfo', () => {
        const invalidSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              contentMatcher: 'pattern-one',
              // Missing authorisationInfo
            },
            {
              contentMatcher: 'pattern-two',
              authorisationInfo: {
                description: 'Second pattern',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
      })

      it('should accept array with composite matchers (andMatcher)', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              andMatcher: [{ contentMatcher: 'required-1' }, { contentMatcher: 'required-2' }],
              authorisationInfo: {
                description: 'AND matcher in array',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
            {
              contentMatcher: 'fallback',
              authorisationInfo: {
                description: 'Fallback pattern',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })

      it('should accept array with nested orMatcher', () => {
        const validSchema = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              orMatcher: [{ contentMatcher: 'option-a' }, { contentMatcher: 'option-b' }],
              authorisationInfo: {
                description: 'OR matcher in array',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
            {
              contentMatcher: 'option-c',
              authorisationInfo: {
                description: 'Alternative option',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
        }

        const result = RawInventoryScriptInfoSchema.safeParse(validSchema)
        expect(result.success).toBe(true)
      })
    })
  })

  describe('T061: Recursive composite matcher validation', () => {
    describe('Nested OR containing AND', () => {
      it('should accept deeply nested OR containing AND matchers', () => {
        const nestedSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              {
                andMatcher: [{ contentMatcher: 'default-src' }, { contentMatcher: 'script-src' }],
                authorisationInfo: {
                  description: 'AND group: default-src and script-src',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
              {
                andMatcher: [{ contentMatcher: 'report-uri' }, { contentMatcher: 'frame-ancestors' }],
                authorisationInfo: {
                  description: 'AND group: report-uri and frame-ancestors',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'OR matcher with nested AND groups',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(nestedSchema)
        expect(result.success).toBe(true)
      })

      it('should reject nested OR with empty AND matcher array', () => {
        const invalidSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              {
                andMatcher: [], // Invalid: empty array
                authorisationInfo: {
                  description: 'Empty AND group',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'OR matcher',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]!.message).toContain('andMatcher must contain at least 1 child')
        }
      })
    })

    describe('Nested AND containing OR', () => {
      it('should accept deeply nested AND containing OR matchers', () => {
        const nestedSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            andMatcher: [
              {
                orMatcher: [{ contentMatcher: 'default-src.*self' }, { contentMatcher: 'default-src.*unsafe-inline' }],
                authorisationInfo: {
                  description: 'OR group: self or unsafe-inline',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
              { contentMatcher: 'script-src' },
            ],
            authorisationInfo: {
              description: 'AND matcher with nested OR group',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(nestedSchema)
        expect(result.success).toBe(true)
      })

      it('should reject nested AND with empty OR matcher array', () => {
        const invalidSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            andMatcher: [
              {
                orMatcher: [], // Invalid: empty array
                authorisationInfo: {
                  description: 'Empty OR group',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'AND matcher',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(invalidSchema)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]!.message).toContain('orMatcher must contain at least 1 child')
        }
      })
    })

    describe('Deep nesting (5+ levels)', () => {
      it('should accept 5 levels of nested composite matchers', () => {
        const deeplyNestedSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              {
                andMatcher: [
                  {
                    orMatcher: [
                      {
                        andMatcher: [
                          {
                            orMatcher: [{ contentMatcher: 'level-5-pattern-a' }, { contentMatcher: 'level-5-pattern-b' }],
                            authorisationInfo: {
                              description: 'Level 5 OR',
                              authorised: true,
                              date: '2025-10-22T12:00:00.000Z',
                            },
                          },
                        ],
                        authorisationInfo: {
                          description: 'Level 4 AND',
                          authorised: true,
                          date: '2025-10-22T12:00:00.000Z',
                        },
                      },
                    ],
                    authorisationInfo: {
                      description: 'Level 3 OR',
                      authorised: true,
                      date: '2025-10-22T12:00:00.000Z',
                    },
                  },
                ],
                authorisationInfo: {
                  description: 'Level 2 AND',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'Level 1 OR (root)',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(deeplyNestedSchema)
        expect(result.success).toBe(true)
      })

      it('should accept 10 levels of nesting (performance boundary test)', () => {
        // Build a 10-level deep alternating OR/AND structure
        let currentLevel: any = { contentMatcher: 'deepest-level' }

        // Wrap in 10 levels of alternating OR and AND matchers
        for (let i = 10; i >= 1; i--) {
          const matcherType = i % 2 === 0 ? 'andMatcher' : 'orMatcher'
          currentLevel = {
            [matcherType]: [currentLevel],
            authorisationInfo: {
              description: `Level ${i} ${matcherType}`,
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          }
        }

        const deepSchema = {
          identifyWith: { headerNameMatcher: '^test-header$' },
          authoriseWith: currentLevel,
        }

        const result = RawInventoryScriptInfoSchema.safeParse(deepSchema)
        expect(result.success).toBe(true)
      })
    })

    describe('Validation of recursive structures', () => {
      it('should validate authorisationInfo at all nesting levels', () => {
        const schemaWithInvalidNestedAuth = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              {
                andMatcher: [{ contentMatcher: 'test' }],
                authorisationInfo: {
                  description: 'Valid description',
                  authorised: true,
                  date: 'invalid-date-format', // Invalid: not ISO 8601
                },
              },
            ],
            authorisationInfo: {
              description: 'Root level',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(schemaWithInvalidNestedAuth)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]!.message).toContain('Invalid')
        }
      })

      it('should reject invalid matcher types within nested structures', () => {
        const schemaWithInvalidMatcher = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              {
                andMatcher: [
                  { invalidMatcher: 'this should not be accepted' }, // Invalid matcher type
                ],
                authorisationInfo: {
                  description: 'Nested AND',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'Root OR',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(schemaWithInvalidMatcher)
        expect(result.success).toBe(false)
      })

      it('should accept mixing all matcher types within nested composites', () => {
        const mixedSchema = {
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            orMatcher: [
              { nameMatcher: '^https://cdn.example.com/.*' },
              { contentMatcher: 'default-src' },
              {
                andMatcher: [{ contentMatcher: 'script-src' }, { contentMatcher: 'connect-src' }],
                authorisationInfo: {
                  description: 'AND group',
                  authorised: true,
                  date: '2025-10-22T12:00:00.000Z',
                },
              },
            ],
            authorisationInfo: {
              description: 'Mixed matcher types in OR',
              authorised: true,
              date: '2025-10-22T12:00:00.000Z',
            },
          },
        }

        const result = RawInventoryScriptInfoSchema.safeParse(mixedSchema)
        expect(result.success).toBe(true)
      })
    })
  })
})

/**
 * Feature 010: Dedicated successNotification destination
 * Schema validation tests for InventoryAlertSchema with successNotification field.
 */
describe('InventoryAlertSchema (Feature 010)', () => {
  // Helper to create valid alert destinations for testing
  const createValidAlertDestinations = (overrides: Record<string, unknown> = {}) => ({
    inventory: {
      newScriptIdentified: { destination: 'inventory-script-channel' },
      newHeaderIdentified: { destination: 'inventory-header-channel' },
    },
    detection: {
      newScriptDetected: { destination: 'detection-script-channel' },
      scriptMismatchDetected: { destination: 'script-mismatch-channel' },
      newHeaderDetected: { destination: 'detection-header-channel' },
    },
    successNotification: { destination: 'success-channel' },
    ...overrides,
  })

  describe('T012: Missing successNotification field', () => {
    it('should reject InventoryAlertSchema when successNotification is missing', () => {
      const alertsWithoutSuccess = {
        inventory: {
          newScriptIdentified: { destination: 'inventory-script-channel' },
          newHeaderIdentified: { destination: 'inventory-header-channel' },
        },
        detection: {
          newScriptDetected: { destination: 'detection-script-channel' },
          scriptMismatchDetected: { destination: 'script-mismatch-channel' },
          newHeaderDetected: { destination: 'detection-header-channel' },
        },
        // successNotification intentionally omitted
      }

      const result = InventoryAlertSchema.safeParse(alertsWithoutSuccess)
      expect(result.success).toBe(false)
      if (!result.success) {
        const issues = result.error.issues.map((issue) => issue.path.join('.'))
        expect(issues).toContain('successNotification')
      }
    })
  })

  describe('T013: Empty destination string validation', () => {
    it('should reject AlertDestinationSchema with empty destination string', () => {
      const result = AlertDestinationSchema.safeParse({ destination: '' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('Alert destination cannot be empty')
      }
    })

    it('should reject successNotification with empty destination string', () => {
      const alertsWithEmptyDestination = createValidAlertDestinations({
        successNotification: { destination: '' },
      })

      const result = InventoryAlertSchema.safeParse(alertsWithEmptyDestination)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('Alert destination cannot be empty'))).toBe(true)
      }
    })

    it('should accept AlertDestinationSchema with valid non-empty destination', () => {
      const result = AlertDestinationSchema.safeParse({ destination: 'valid-channel' })
      expect(result.success).toBe(true)
    })
  })

  describe('T014: Valid successNotification field', () => {
    it('should accept InventoryAlertSchema with valid successNotification', () => {
      const validAlerts = createValidAlertDestinations()

      const result = InventoryAlertSchema.safeParse(validAlerts)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.successNotification.destination).toBe('success-channel')
      }
    })

    it('should accept successNotification with any valid non-empty string', () => {
      const alertsWithCustomDestination = createValidAlertDestinations({
        successNotification: { destination: '#my-custom-slack-channel' },
      })

      const result = InventoryAlertSchema.safeParse(alertsWithCustomDestination)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.successNotification.destination).toBe('#my-custom-slack-channel')
      }
    })
  })
})
