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

import { MatcherConfigSchema } from './matcher-config-schema'
import { RawInventoryScriptInfoSchema } from './zod'

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
        },
        authorisationInfo: {
          description: 'External CDN script with hash verification',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
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
        },
        authorisationInfo: {
          description: 'Inline script identified by content pattern',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
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
        authoriseWith: { nameMatcher: '^https://example\\.com/script\\.js\\?v=[0-9]+$' },
        authorisationInfo: {
          description: 'Script identified and authorized by name pattern',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
        },
      }

      const result = RawInventoryScriptInfoSchema.safeParse(validSchema)

      expect(result.success).toBe(true)
    })

    it('should accept contentMatcher for both identifyWith and authoriseWith', () => {
      const validSchema = {
        identifyWith: { contentMatcher: '__NEXT_DATA__' },
        authoriseWith: { contentMatcher: '__NEXT_DATA__.*"environment":"production"' },
        authorisationInfo: {
          description: 'Next.js data script with production environment check',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
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
        },
        authorisationInfo: {
          description: 'Script with hash-based identification and authorization',
          authorised: true,
          date: '2025-10-15T00:00:00.000Z',
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
})
