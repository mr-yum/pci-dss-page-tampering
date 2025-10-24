/**
 * Array Syntax Unit Tests (T047-T050)
 *
 * Tests for array syntax support in authoriseWith configuration.
 * Array syntax is syntactic sugar for OrMatcher (FR-006).
 *
 * @see src/types/inventory/zod.ts - processAuthorizeWith function
 * @see specs/005-enhance-the-schema/spec.md - FR-006, US3
 */

import type { RawAuthorizeWithConfig } from '../../types/inventory/raw'
import { processAuthorizeWith } from '../../types/inventory/zod'
import type { Matchable } from '../../types/matcher/matcher.interface'

describe('Array Syntax for authoriseWith (T047-T050)', () => {
  describe('T047: Array syntax with two content matchers (first matches)', () => {
    it('should authorize when first matcher in array matches', () => {
      // Arrange: Array syntax with two content matchers
      const arrayConfig: RawAuthorizeWithConfig = [
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
      ]

      // Act: Process array syntax (converts to OrMatcher internally)
      const result = processAuthorizeWith(arrayConfig)

      // Create test resource that matches first pattern
      const testResource: Matchable = {
        name: 'test-resource',
        content: 'This contains pattern-one but not the other',
      }

      // Assert: Should be identified by OrMatcher (any child matches)
      expect(result.matcher.identify(testResource)).toBe(true)

      // Assert: Should be authorized by first matcher
      const authResult = result.matcher.authorize(testResource)
      expect(authResult.authorized).toBe(true)
      expect(authResult.metadataPath).toBeDefined()
      expect(authResult.metadataPath?.length).toBeGreaterThan(0)
    })

    it('should use first element authorisationInfo as top-level metadata', () => {
      // Arrange: Array syntax
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: 'first',
          authorisationInfo: {
            description: 'First description',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'second',
          authorisationInfo: {
            description: 'Second description',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Assert: authorisationInfo should come from first element
      expect(result.authorisationInfo.description).toBe('First description')
      expect(result.authorisationInfo.authorised).toBe(true)
    })
  })

  describe('T048: Array syntax with two content matchers (second matches)', () => {
    it('should authorize when second matcher in array matches', () => {
      // Arrange: Array syntax
      const arrayConfig: RawAuthorizeWithConfig = [
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
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test resource that matches ONLY second pattern
      const testResource: Matchable = {
        name: 'test-resource',
        content: 'This contains pattern-two only',
      }

      // Assert: Should be identified (second matcher matches)
      expect(result.matcher.identify(testResource)).toBe(true)

      // Assert: Should be authorized by second matcher
      const authResult = result.matcher.authorize(testResource)
      expect(authResult.authorized).toBe(true)
      expect(authResult.metadataPath).toBeDefined()
    })

    it('should work when first matcher does not match but second does', () => {
      // Arrange
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: '^exact-match$',
          authorisationInfo: {
            description: 'Exact match only',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'contains-this',
          authorisationInfo: {
            description: 'Contains pattern',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      const testResource: Matchable = {
        name: 'test',
        content: 'This string contains-this pattern',
      }

      // Assert: First matcher won't match (not exact), but second will
      const authResult = result.matcher.authorize(testResource)
      expect(authResult.authorized).toBe(true)
    })
  })

  describe('T049: Array syntax with both matchers matching (first-match-wins)', () => {
    it('should use first-match-wins semantics when multiple matchers match', () => {
      // Arrange: Both matchers will match the test content
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: 'common',
          authorisationInfo: {
            description: 'First matcher - matches common',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'pattern',
          authorisationInfo: {
            description: 'Second matcher - matches pattern',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test resource that matches BOTH patterns
      const testResource: Matchable = {
        name: 'test',
        content: 'This has both common and pattern words',
      }

      // Assert: Both matchers should match for identification
      expect(result.matcher.identify(testResource)).toBe(true)

      // Assert: First-match-wins for authorization
      const authResult = result.matcher.authorize(testResource)
      expect(authResult.authorized).toBe(true)

      // Metadata path should include first matcher's info (first-match-wins)
      expect(authResult.metadataPath).toBeDefined()
      if (authResult.metadataPath) {
        expect(authResult.metadataPath.some((info) => info.description.includes('First matcher'))).toBe(true)
      }
    })

    it('should return first successful authorization result', () => {
      // Arrange: Multiple overlapping matchers
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: '.*', // Matches everything
          authorisationInfo: {
            description: 'Wildcard matcher (first)',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'specific',
          authorisationInfo: {
            description: 'Specific matcher (second)',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      const testResource: Matchable = {
        name: 'test',
        content: 'This has specific word',
      }

      // Assert: First matcher (wildcard) should win even though both match
      const authResult = result.matcher.authorize(testResource)
      expect(authResult.authorized).toBe(true)
    })
  })

  describe('T050: Array syntax with composite matchers (mixing syntaxes)', () => {
    it('should support array containing composite matchers', () => {
      // Arrange: Array with a composite andMatcher
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          andMatcher: [{ contentMatcher: 'first' }, { contentMatcher: 'second' }],
          authorisationInfo: {
            description: 'Both patterns required (AND)',
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
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test resource that matches the AND matcher (both patterns)
      const testResourceBoth: Matchable = {
        name: 'test',
        content: 'Has both first and second patterns',
      }

      // Assert: Should authorize via AND matcher
      expect(result.matcher.identify(testResourceBoth)).toBe(true)
      const authResultBoth = result.matcher.authorize(testResourceBoth)
      expect(authResultBoth.authorized).toBe(true)

      // Test resource that matches only fallback
      const testResourceFallback: Matchable = {
        name: 'test',
        content: 'Only has fallback pattern',
      }

      // Assert: Should authorize via fallback matcher
      expect(result.matcher.identify(testResourceFallback)).toBe(true)
      const authResultFallback = result.matcher.authorize(testResourceFallback)
      expect(authResultFallback.authorized).toBe(true)
    })

    it('should handle array with nested orMatcher', () => {
      // Arrange: Array containing an orMatcher (OR within OR)
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          orMatcher: [{ contentMatcher: 'option-a' }, { contentMatcher: 'option-b' }],
          authorisationInfo: {
            description: 'Either option-a or option-b',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'option-c',
          authorisationInfo: {
            description: 'Option-c',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test all three options
      const testA: Matchable = { name: 'test', content: 'option-a' }
      const testB: Matchable = { name: 'test', content: 'option-b' }
      const testC: Matchable = { name: 'test', content: 'option-c' }

      // Assert: All three should authorize
      expect(result.matcher.authorize(testA).authorized).toBe(true)
      expect(result.matcher.authorize(testB).authorized).toBe(true)
      expect(result.matcher.authorize(testC).authorized).toBe(true)
    })

    it('should handle complex nested structures in array syntax', () => {
      // Arrange: Array with deeply nested composites
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          andMatcher: [
            { contentMatcher: 'required-1' },
            {
              orMatcher: [{ contentMatcher: 'option-x' }, { contentMatcher: 'option-y' }],
              authorisationInfo: {
                description: 'Nested OR within AND',
                authorised: true,
                date: '2025-10-22T12:00:00.000Z',
              },
            },
          ],
          authorisationInfo: {
            description: 'Complex nested matcher',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
        {
          contentMatcher: 'simple-fallback',
          authorisationInfo: {
            description: 'Simple fallback',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test: Matches complex nested matcher (required-1 AND option-x)
      const testComplex: Matchable = {
        name: 'test',
        content: 'Has required-1 and option-x',
      }
      expect(result.matcher.authorize(testComplex).authorized).toBe(true)

      // Test: Falls back to simple matcher
      const testSimple: Matchable = {
        name: 'test',
        content: 'Only has simple-fallback',
      }
      expect(result.matcher.authorize(testSimple).authorized).toBe(true)
    })

    it('should handle array with single element (edge case)', () => {
      // Arrange: Array with just one matcher (still valid OR)
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: 'single-pattern',
          authorisationInfo: {
            description: 'Single element array',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      const testResource: Matchable = {
        name: 'test',
        content: 'Contains single-pattern',
      }

      // Assert: Should work like a single matcher
      expect(result.matcher.identify(testResource)).toBe(true)
      expect(result.matcher.authorize(testResource).authorized).toBe(true)
    })
  })

  describe('Single matcher syntax (backward compatibility)', () => {
    it('should still support single matcher configuration', () => {
      // Arrange: Single matcher (not an array)
      const singleConfig: RawAuthorizeWithConfig = {
        contentMatcher: 'pattern',
        authorisationInfo: {
          description: 'Single matcher',
          authorised: true,
          date: '2025-10-22T12:00:00.000Z',
        },
      }

      // Act
      const result = processAuthorizeWith(singleConfig)

      const testResource: Matchable = {
        name: 'test',
        content: 'Contains pattern',
      }

      // Assert: Should work as before
      expect(result.matcher.identify(testResource)).toBe(true)
      expect(result.matcher.authorize(testResource).authorized).toBe(true)
      expect(result.authorisationInfo.description).toBe('Single matcher')
    })
  })

  describe('Fail-secure behavior', () => {
    it('should handle empty array (should be rejected by Zod schema)', () => {
      // Note: This test documents expected behavior
      // Empty arrays are rejected by Zod schema validation (.min(1))
      // So this function should never receive an empty array
      // If it does, OrMatcher constructor will throw an error (fail-secure)
    })

    it('should handle null/empty content in array syntax', () => {
      // Arrange
      const arrayConfig: RawAuthorizeWithConfig = [
        {
          contentMatcher: 'pattern',
          authorisationInfo: {
            description: 'Pattern matcher',
            authorised: true,
            date: '2025-10-22T12:00:00.000Z',
          },
        },
      ]

      // Act
      const result = processAuthorizeWith(arrayConfig)

      // Test with null content
      const nullResource: Matchable = {
        name: 'test',
        content: null,
      }

      // Assert: Null content should fail authorization (fail-secure)
      expect(result.matcher.authorize(nullResource).authorized).toBe(false)

      // Test with empty content
      const emptyResource: Matchable = {
        name: 'test',
        content: '',
      }

      // Assert: Empty content should fail authorization (fail-secure)
      expect(result.matcher.authorize(emptyResource).authorized).toBe(false)
    })
  })
})
