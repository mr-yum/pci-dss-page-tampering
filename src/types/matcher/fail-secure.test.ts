/**
 * Fail-Secure Edge Case Tests (T065-T070)
 *
 * Validates fail-secure behavior for composite matchers across edge cases.
 * These tests ensure the system denies access in ambiguous or invalid scenarios.
 *
 * @see specs/005-enhance-the-schema/spec.md - Edge cases and fail-secure requirements
 */

import type { SHA256Hash } from '../hash.js'
import type { InventoryAuthorisationInfo } from '../inventory/model.js'
import { AndMatcher } from './and-matcher.js'
import { ContentMatcher } from './content-matcher.js'
import type { DetectedScript } from './matcher.interface.js'
import { OrMatcher } from './or-matcher.js'

describe('Fail-Secure Edge Cases (T065-T070)', () => {
  const mockScript = (name: string, content: string | null): DetectedScript => ({
    name,
    content,
    hash: 'mock-hash' as unknown as SHA256Hash,
  })

  const authInfo = (description: string, authorised: boolean = true): InventoryAuthorisationInfo => ({
    description,
    authorised,
    date: new Date(),
  })

  describe('T065: Single-child composite matchers (valid edge case)', () => {
    it('should accept OrMatcher with single child', () => {
      const singleChildOr = new OrMatcher([new ContentMatcher('test-pattern')], authInfo('Single child OR'))

      const resource = mockScript('test', 'test-pattern content')

      const result = singleChildOr.authorize(resource)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1)
    })

    it('should accept AndMatcher with single child', () => {
      const singleChildAnd = new AndMatcher([new ContentMatcher('test-pattern')], authInfo('Single child AND'))

      const resource = mockScript('test', 'test-pattern content')

      const result = singleChildAnd.authorize(resource)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1)
    })

    it('should deny OrMatcher with single non-matching child', () => {
      const singleChildOr = new OrMatcher([new ContentMatcher('missing-pattern')], authInfo('Single child OR'))

      const resource = mockScript('test', 'different content')

      const result = singleChildOr.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('No child matcher identified')
    })

    it('should deny AndMatcher with single non-matching child', () => {
      const singleChildAnd = new AndMatcher([new ContentMatcher('missing-pattern')], authInfo('Single child AND'))

      const resource = mockScript('test', 'different content')

      const result = singleChildAnd.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Not all child matchers identified')
    })
  })

  describe('T066: authorisationInfo.authorised: false always denying', () => {
    describe('OrMatcher with authorised: false', () => {
      it('should deny even when child matcher succeeds', () => {
        const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Explicitly denied', false))

        const resource = mockScript('test', 'any content matches')

        const result = orMatcher.authorize(resource)
        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('Top-level authorization denied')
        expect(result.reason).toContain('Explicitly denied')
      })

      it('should include metadata path even when denying', () => {
        const denialInfo = authInfo('Deprecated policy', false)
        const orMatcher = new OrMatcher([new ContentMatcher('test')], denialInfo)

        const resource = mockScript('test', 'test content')

        const result = orMatcher.authorize(resource)
        expect(result.authorized).toBe(false)
        expect(result.metadataPath).toBeDefined()
        expect(result.metadataPath![0]).toEqual(denialInfo)
      })
    })

    describe('AndMatcher with authorised: false', () => {
      it('should deny even when all children succeed', () => {
        const andMatcher = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('Explicitly denied', false))

        const resource = mockScript('test', 'content with foo and bar')

        const result = andMatcher.authorize(resource)
        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('Top-level authorization denied')
        expect(result.reason).toContain('Explicitly denied')
      })
    })

    describe('Nested composite with authorised: false at different levels', () => {
      it('should deny when root has authorised: false', () => {
        const andGroup = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('Inner AND', true))

        const orMatcher = new OrMatcher([andGroup], authInfo('Root OR - denied', false))

        const resource = mockScript('test', 'foo and bar')

        const result = orMatcher.authorize(resource)
        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('Top-level authorization denied')
      })

      it('should deny when nested child has authorised: false', () => {
        const andGroup = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('Inner AND - denied', false))

        const orMatcher = new OrMatcher([andGroup]) // No top-level override

        const resource = mockScript('test', 'foo and bar')

        const result = orMatcher.authorize(resource)
        expect(result.authorized).toBe(false)
        expect(result.metadataPath).toBeDefined()
        expect(result.metadataPath![0]!.description).toContain('Inner AND - denied')
      })
    })
  })

  describe('T067: Whitespace-only content triggering unauthorized', () => {
    it('should deny OrMatcher when content is only spaces', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', '   ')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should deny AndMatcher when content is only tabs', () => {
      const andMatcher = new AndMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', '\t\t\t')

      const result = andMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should deny when content is newlines and spaces', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', '\n  \n\t  \n')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should authorize when content has actual characters with surrounding whitespace', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('test')], authInfo('Should match test'))

      const resource = mockScript('test', '  \n test \n  ')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(true)
    })
  })

  describe('T068: Undefined content triggering unauthorized', () => {
    it('should deny OrMatcher when content is null', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', null)

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should deny AndMatcher when content is null', () => {
      const andMatcher = new AndMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', null)

      const result = andMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should deny nested composite when content is null', () => {
      const andGroup = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND group'))

      const orMatcher = new OrMatcher([andGroup], authInfo('OR wrapper'))

      const resource = mockScript('test', null)

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should deny when content is empty string', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Should match anything'))

      const resource = mockScript('test', '')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })
  })

  describe("T069: Top-level override when matchers don't match", () => {
    it("should NOT override when OrMatcher children don't identify", () => {
      const orMatcher = new OrMatcher([new ContentMatcher('pattern-that-wont-match')], authInfo('Top-level override', true))

      const resource = mockScript('test', 'different content')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('No child matcher identified')
      // Top-level override should NOT apply when no child matches
    })

    it("should NOT override when AndMatcher children don't all identify", () => {
      const andMatcher = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('Top-level override', true))

      const resource = mockScript('test', 'only foo here')

      const result = andMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Not all child matchers identified')
    })

    it('should apply override when OrMatcher child identifies', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('test')], authInfo('Override applies', true))

      const resource = mockScript('test', 'test content')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(true) // Override applied because child identified
    })

    it('should apply override (deny) when AndMatcher children all identify', () => {
      const andMatcher = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('Override denies', false))

      const resource = mockScript('test', 'foo and bar')

      const result = andMatcher.authorize(resource)
      expect(result.authorized).toBe(false) // Override applied because all children identified
      expect(result.reason).toContain('Top-level authorization denied')
    })

    it('should include metadata path when override does not apply', () => {
      const authInfoObj = authInfo('Top-level that does not apply', true)
      const orMatcher = new OrMatcher([new ContentMatcher('missing')], authInfoObj)

      const resource = mockScript('test', 'different content')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toEqual([authInfoObj]) // Metadata still included
    })
  })

  describe('T070: Validate Array.every() is never used without empty array check', () => {
    it('should reject AndMatcher with empty array at construction', () => {
      expect(() => {
        new AndMatcher([], authInfo('Empty array'))
      }).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should reject OrMatcher with empty array at construction', () => {
      expect(() => {
        new OrMatcher([], authInfo('Empty array'))
      }).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should reject AndMatcher with null array at construction', () => {
      expect(() => {
        new AndMatcher(null as any, authInfo('Null array'))
      }).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should reject OrMatcher with null array at construction', () => {
      expect(() => {
        new OrMatcher(null as any, authInfo('Null array'))
      }).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should reject AndMatcher with undefined array at construction', () => {
      expect(() => {
        new AndMatcher(undefined as any, authInfo('Undefined array'))
      }).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should reject OrMatcher with undefined array at construction', () => {
      expect(() => {
        new OrMatcher(undefined as any, authInfo('Undefined array'))
      }).toThrow('OrMatcher requires at least one child matcher')
    })

    it('should verify AndMatcher.identify() never reaches Array.every() on empty array', () => {
      // This test verifies that constructor validation prevents Array.every() from ever being called on empty array
      // The previous tests confirm constructor throws, so identify() never gets called with empty array
      const andMatcher = new AndMatcher([new ContentMatcher('test')], authInfo('Single child'))
      const resource = mockScript('test', 'test content')

      // If we got here, the array is non-empty (constructor validated)
      expect(andMatcher.identify(resource)).toBe(true)
    })

    it('should verify AndMatcher with single child uses Array.every() safely', () => {
      const andMatcher = new AndMatcher([new ContentMatcher('test')], authInfo('Single child'))
      const resource = mockScript('test', 'test content')

      // Array.every([single item]) is safe - returns correct result
      expect(andMatcher.identify(resource)).toBe(true)
    })
  })

  describe('Combined edge cases', () => {
    it('should handle nested composites with whitespace content', () => {
      const andGroup = new AndMatcher([new ContentMatcher('foo'), new ContentMatcher('bar')], authInfo('AND group'))

      const orMatcher = new OrMatcher([andGroup], authInfo('OR wrapper'))

      const resource = mockScript('test', '   \n\t   ')

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
    })

    it('should handle single-child composite with authorised: false', () => {
      const singleChildOr = new OrMatcher([new ContentMatcher('.*')], authInfo('Denied single child', false))

      const resource = mockScript('test', 'any content')

      const result = singleChildOr.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Top-level authorization denied')
    })

    it('should handle multiple edge cases: null content + override', () => {
      const orMatcher = new OrMatcher([new ContentMatcher('.*')], authInfo('Override that never applies', true))

      const resource = mockScript('test', null)

      const result = orMatcher.authorize(resource)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Resource content is null or empty')
      // Override doesn't apply because fail-secure check happens first
    })
  })
})
