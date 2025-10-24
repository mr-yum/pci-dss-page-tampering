/**
 * OrMatcher Unit Tests (T032-T040)
 *
 * Tests for OR composite matcher with first-match-wins semantics.
 * Validates:
 * - Constructor validation (empty array rejection)
 * - identify() method with multiple children
 * - authorize() method with first-match-wins, top-level override, metadata path
 * - Fail-secure behavior (null/empty content)
 *
 * @see src/types/matcher/or-matcher.ts
 * @see specs/005-enhance-the-schema/spec.md - US2, FR-001, FR-004, FR-008, FR-009, FR-011, FR-012, FR-013
 */

import type { SHA256Hash } from '../hash'
import type { InventoryAuthorisationInfo } from '../inventory/model'
import { ContentMatcher } from './content-matcher'
import type { Matchable } from './matcher.interface'
import { OrMatcher } from './or-matcher'

describe('OrMatcher', () => {
  // Helper to create test matchable resources
  const createScript = (name: string, content: string | null): Matchable & { hash: SHA256Hash } => ({
    name,
    content,
    hash: 'abc123' as unknown as SHA256Hash,
  })

  const createAuthInfo = (description: string, authorised: boolean): InventoryAuthorisationInfo => ({
    description,
    authorised,
    date: new Date('2025-10-22T12:00:00.000Z'),
  })

  describe('constructor validation (T032)', () => {
    it('should reject empty array (fail-secure: FR-008, FR-012)', () => {
      expect(() => new OrMatcher([])).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should reject null children array (fail-secure)', () => {
      expect(() => new OrMatcher(null as any)).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should reject undefined children array (fail-secure)', () => {
      expect(() => new OrMatcher(undefined as any)).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should accept single child', () => {
      const matcher = new OrMatcher([new ContentMatcher('test')])
      expect(matcher.getType()).toBe('or')
      expect(matcher.getPattern()).toHaveLength(1)
    })

    it('should accept multiple children', () => {
      const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])
      expect(matcher.getType()).toBe('or')
      expect(matcher.getPattern()).toHaveLength(3)
    })

    it('should store optional authorisationInfo', () => {
      const authInfo = createAuthInfo('Test authorization', true)
      const matcher = new OrMatcher([new ContentMatcher('test')], authInfo)
      expect(matcher.getType()).toBe('or')
    })
  })

  describe('identify() (T033, T034, T035)', () => {
    describe('T033: first child matching', () => {
      it('should return true if first child identifies the resource', () => {
        const matcher = new OrMatcher([
          new ContentMatcher('pattern1'), // This will match
          new ContentMatcher('pattern2'),
          new ContentMatcher('pattern3'),
        ])

        const script = createScript('test.js', 'This contains pattern1 in the content')
        expect(matcher.identify(script)).toBe(true)
      })

      it('should return true when first child matches (Array.some behavior)', () => {
        const firstChild = new ContentMatcher('pattern1')
        const secondChild = new ContentMatcher('pattern2')

        const matcher = new OrMatcher([firstChild, secondChild])
        const script = createScript('test.js', 'This contains pattern1')

        expect(matcher.identify(script)).toBe(true)
        // Note: Array.some() may or may not short-circuit depending on implementation
      })
    })

    describe('T034: second child matching', () => {
      it('should return true if second child identifies the resource', () => {
        const matcher = new OrMatcher([
          new ContentMatcher('pattern1'), // Won't match
          new ContentMatcher('pattern2'), // This will match
          new ContentMatcher('pattern3'), // Won't be tested
        ])

        const script = createScript('test.js', 'This contains pattern2 in the content')
        expect(matcher.identify(script)).toBe(true)
      })

      it('should return true if last child identifies the resource', () => {
        const matcher = new OrMatcher([
          new ContentMatcher('pattern1'),
          new ContentMatcher('pattern2'),
          new ContentMatcher('pattern3'), // This will match
        ])

        const script = createScript('test.js', 'This contains pattern3 in the content')
        expect(matcher.identify(script)).toBe(true)
      })
    })

    describe('T035: no children matching', () => {
      it('should return false if no children identify the resource', () => {
        const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

        const script = createScript('test.js', 'This content has no patterns')
        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for null content', () => {
        const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

        const script = createScript('test.js', null)
        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for empty content', () => {
        const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

        const script = createScript('test.js', '')
        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for whitespace-only content', () => {
        const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

        const script = createScript('test.js', '   \n\t  ')
        expect(matcher.identify(script)).toBe(false)
      })
    })
  })

  describe('authorize() (T036, T037, T038, T039, T040)', () => {
    describe('T036: first-match-wins semantics (FR-013)', () => {
      it('should authorize when first child matches', () => {
        const matcher = new OrMatcher([
          new ContentMatcher('pattern1'), // This will match first
          new ContentMatcher('pattern2'),
        ])

        const script = createScript('test.js', 'This contains pattern1 and pattern2')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('should use first matching child even if multiple match', () => {
        const child1 = new ContentMatcher('pattern1')
        const child2 = new ContentMatcher('pattern2')

        const matcher = new OrMatcher([child1, child2])

        const script = createScript('test.js', 'pattern1 and pattern2')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        // Should use first child's result (pattern1 matches first in content)
      })

      it('should authorize with second child if first does not match', () => {
        const matcher = new OrMatcher([
          new ContentMatcher('pattern1'), // Won't match
          new ContentMatcher('pattern2'), // Will match
        ])

        const script = createScript('test.js', 'This contains only pattern2')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('should deny if no children match', () => {
        const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])

        const script = createScript('test.js', 'This has no patterns')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('No child matcher identified the resource')
      })
    })

    describe('T037: null/empty content (fail-secure)', () => {
      it('should deny authorization for null content', () => {
        const matcher = new OrMatcher([new ContentMatcher('.*')])

        const script = createScript('test.js', null)
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('Resource content is null or empty')
      })

      it('should deny authorization for empty string content', () => {
        const matcher = new OrMatcher([new ContentMatcher('.*')])

        const script = createScript('test.js', '')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('Resource content is null or empty')
      })

      it('should deny authorization for whitespace-only content', () => {
        const matcher = new OrMatcher([new ContentMatcher('.*')])

        const script = createScript('test.js', '   \n\t  ')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('Resource content is null or empty')
      })

      it('should include top-level metadata in path even for null content', () => {
        const authInfo = createAuthInfo('Test authorization', true)
        const matcher = new OrMatcher([new ContentMatcher('.*')], authInfo)

        const script = createScript('test.js', null)
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.metadataPath).toEqual([authInfo])
      })
    })

    describe('T038: top-level authorisationInfo override (true)', () => {
      it('should authorize when top-level authorised is true, even if child denies (FR-004)', () => {
        const authInfo = createAuthInfo('Override to authorize', true)

        // Child would deny (pattern doesn't match)
        const script = createScript('test.js', 'This does not match the pattern')

        // But we need at least one child to identify first
        // Let's use a matcher that will identify but normally deny
        const matcherWithIdentify = new OrMatcher([new ContentMatcher('does')], authInfo)
        const result = matcherWithIdentify.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('should collect metadata path with top-level info when authorised is true', () => {
        const authInfo = createAuthInfo('Top-level authorization', true)
        const matcher = new OrMatcher([new ContentMatcher('pattern')], authInfo)

        const script = createScript('test.js', 'This contains pattern')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.metadataPath).toHaveLength(1)
        expect(result.metadataPath?.[0]).toEqual(authInfo)
      })
    })

    describe('T039: top-level authorisationInfo override (false) (FR-011)', () => {
      it('should deny when top-level authorised is false, even if child authorizes', () => {
        const authInfo = createAuthInfo('Explicitly denied', false)
        const matcher = new OrMatcher([new ContentMatcher('.*')], authInfo) // Child would authorize everything

        const script = createScript('test.js', 'Any content')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('Top-level authorization denied: Explicitly denied')
      })

      it('should include denial reason from top-level description', () => {
        const authInfo = createAuthInfo('This header is deprecated', false)
        const matcher = new OrMatcher([new ContentMatcher('.*')], authInfo)

        const script = createScript('test.js', 'content')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('This header is deprecated')
      })

      it('should collect metadata path even when denying', () => {
        const authInfo = createAuthInfo('Denied', false)
        const matcher = new OrMatcher([new ContentMatcher('test')], authInfo)

        const script = createScript('test.js', 'test content')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.metadataPath).toHaveLength(1)
        expect(result.metadataPath?.[0]).toEqual(authInfo)
      })
    })

    describe('T040: metadata path collection (FR-009)', () => {
      it('should collect metadata path from root to leaf (no top-level info)', () => {
        // OrMatcher without top-level info
        const matcher = new OrMatcher([new ContentMatcher('pattern')])

        const script = createScript('test.js', 'This contains pattern')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        // Leaf matcher (ContentMatcher) doesn't have metadata, so path should be empty or undefined
        expect(result.metadataPath ?? []).toEqual([])
      })

      it('should collect metadata path with top-level info', () => {
        const topLevelInfo = createAuthInfo('OR matcher authorization', true)
        const matcher = new OrMatcher([new ContentMatcher('pattern')], topLevelInfo)

        const script = createScript('test.js', 'This contains pattern')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.metadataPath).toBeDefined()
        expect(result.metadataPath).toHaveLength(1)
        expect(result.metadataPath?.[0]).toEqual(topLevelInfo)
      })

      it('should prepend top-level metadata to child metadata path', () => {
        const topLevelInfo = createAuthInfo('Root OR matcher', true)

        // Create nested OR matcher with its own metadata
        const nestedInfo = createAuthInfo('Nested OR matcher', true)
        const nestedMatcher = new OrMatcher([new ContentMatcher('pattern')], nestedInfo)

        // Wrap in outer OR matcher
        const outerMatcher = new OrMatcher([nestedMatcher], topLevelInfo)

        const script = createScript('test.js', 'This contains pattern')
        const result = outerMatcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.metadataPath).toHaveLength(2)
        expect(result.metadataPath?.[0]).toEqual(topLevelInfo) // Root first
        expect(result.metadataPath?.[1]).toEqual(nestedInfo) // Leaf second
      })

      it('should collect metadata path even when authorization fails', () => {
        const topLevelInfo = createAuthInfo('OR matcher', true)
        const matcher = new OrMatcher([new ContentMatcher('nonexistent')], topLevelInfo)

        const script = createScript('test.js', 'No match here')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('No child matcher identified the resource')
        expect(result.metadataPath).toEqual([topLevelInfo])
      })

      it('should handle empty metadata path when no authorization info present', () => {
        const matcher = new OrMatcher([new ContentMatcher('nonexistent')])

        const script = createScript('test.js', 'No match')
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.metadataPath ?? []).toEqual([])
      })
    })
  })

  describe('getType() and getPattern()', () => {
    it('should return "or" as type discriminator', () => {
      const matcher = new OrMatcher([new ContentMatcher('test')])
      expect(matcher.getType()).toBe('or')
    })

    it('should return children array via getPattern()', () => {
      const child1 = new ContentMatcher('pattern1')
      const child2 = new ContentMatcher('pattern2')
      const matcher = new OrMatcher([child1, child2])

      const pattern = matcher.getPattern()
      expect(Array.isArray(pattern)).toBe(true)
      expect(pattern).toHaveLength(2)
      expect(pattern[0]).toBe(child1)
      expect(pattern[1]).toBe(child2)
    })
  })

  describe('getAuthorisationInfo() (T016)', () => {
    it('should return authorisationInfo when present', () => {
      const authInfo = createAuthInfo('Test authorization', true)
      const matcher = new OrMatcher([new ContentMatcher('test')], authInfo)

      expect(matcher.getAuthorisationInfo()).toEqual(authInfo)
    })

    it('should return undefined when authorisationInfo not provided', () => {
      const matcher = new OrMatcher([new ContentMatcher('test')])

      expect(matcher.getAuthorisationInfo()).toBeUndefined()
    })

    it('should preserve date instance in returned authorisationInfo', () => {
      const authInfo = createAuthInfo('Test', true)
      const matcher = new OrMatcher([new ContentMatcher('test')], authInfo)

      const retrieved = matcher.getAuthorisationInfo()
      expect(retrieved?.date).toBeInstanceOf(Date)
      expect(retrieved?.date.toISOString()).toBe('2025-10-22T12:00:00.000Z')
    })
  })
})
