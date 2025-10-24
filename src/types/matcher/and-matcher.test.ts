/**
 * AndMatcher Unit Tests (T014-T022)
 *
 * Tests for composite AND matcher functionality following TDD approach.
 * These tests validate:
 * - Constructor validation (empty array rejection)
 * - identify() method (all children must match)
 * - authorize() method (all children must authorize)
 * - Short-circuit evaluation on authorization failure
 * - Null/empty content handling
 * - Top-level authorization override (both true and false)
 * - Metadata path collection
 *
 * @see src/types/matcher/and-matcher.ts
 * @see specs/005-enhance-the-schema/tasks.md - Phase 3, User Story 1
 */

import type { InventoryAuthorisationInfo } from '../inventory/model'
import { AndMatcher } from './and-matcher'
import { ContentMatcher } from './content-matcher'
import type { Matchable, Matcher } from './matcher.interface'

// Helper to create test authorization info
function createAuthInfo(description: string, authorised: boolean): InventoryAuthorisationInfo {
  return {
    description,
    authorised,
    date: new Date('2025-10-22T12:00:00.000Z'),
  }
}

// Helper to create test resource (header-like matchable without hash)
function createTestResource(name: string, content: string): Matchable {
  return {
    name,
    content,
    // hash is omitted for headers (optional field in Matchable interface)
  }
}

describe('AndMatcher', () => {
  /**
   * T014: Unit test for AndMatcher constructor validation (empty array rejection)
   *
   * CRITICAL: Empty array rejection prevents vacuous truth scenario.
   * JavaScript Array.every([]) returns true, which would authorize everything.
   * This would be a SECURITY VIOLATION for AND logic.
   */
  describe('constructor validation', () => {
    it('should reject empty array', () => {
      expect(() => new AndMatcher([])).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should reject null children array', () => {
      expect(() => new AndMatcher(null as any)).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should reject undefined children array', () => {
      expect(() => new AndMatcher(undefined as any)).toThrow('AndMatcher requires at least one child matcher')
    })

    it('should accept single child matcher', () => {
      const matcher = new AndMatcher([new ContentMatcher('test')])
      expect(matcher.getType()).toBe('and')
    })

    it('should accept multiple child matchers', () => {
      const matcher = new AndMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])
      expect(matcher.getType()).toBe('and')
      expect(matcher.getPattern()).toHaveLength(2)
    })
  })

  /**
   * T015: Unit test for AndMatcher identify() with all children matching
   *
   * FR-002: AND logic - succeeds only if ALL children succeed
   */
  describe('identify() - all children matching', () => {
    it('should return true when all children identify the resource', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'contains pattern1 and pattern2 and pattern3')
      expect(matcher.identify(resource)).toBe(true)
    })

    it('should return true when all children match with single child', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('test')])

      const resource = createTestResource('test', 'test content')
      expect(matcher.identify(resource)).toBe(true)
    })

    it('should return true when content contains all required patterns', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('default-src'), new ContentMatcher('script-src'), new ContentMatcher('connect-src')])

      const resource = createTestResource('Content-Security-Policy', 'default-src https:; script-src https:; connect-src https:;')
      expect(matcher.identify(resource)).toBe(true)
    })
  })

  /**
   * T016: Unit test for AndMatcher identify() with partial match
   *
   * FR-002: AND logic - fails if any child does not identify
   */
  describe('identify() - partial match', () => {
    it('should return false when first child does not match', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'contains pattern2 and pattern3 only')
      expect(matcher.identify(resource)).toBe(false)
    })

    it('should return false when middle child does not match', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'contains pattern1 and pattern3 only')
      expect(matcher.identify(resource)).toBe(false)
    })

    it('should return false when last child does not match', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'contains pattern1 and pattern2 only')
      expect(matcher.identify(resource)).toBe(false)
    })

    it('should return false when no children match', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'no patterns here')
      expect(matcher.identify(resource)).toBe(false)
    })
  })

  /**
   * T017: Unit test for AndMatcher authorize() with all children authorized
   *
   * FR-002: AND logic - authorizes only if ALL children authorize
   */
  describe('authorize() - all children authorized', () => {
    it('should authorize when all children authorize', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern1'), new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])

      const resource = createTestResource('test', 'contains pattern1 and pattern2 and pattern3')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should collect metadata path from all children', () => {
      const child1AuthInfo = createAuthInfo('First pattern check', true)
      const child2AuthInfo = createAuthInfo('Second pattern check', true)

      // Create custom mock matchers that return metadata
      const mockChild1: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern1',
        getDescription: () => 'content:/pattern1/',
        identify: (r) => r.content?.includes('pattern1') ?? false,
        authorize: (r) => (r.content?.includes('pattern1') ? { authorized: true, metadataPath: [child1AuthInfo] } : { authorized: false, reason: 'no match' }),
      }

      const mockChild2: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern2',
        getDescription: () => 'content:/pattern2/',
        identify: (r) => r.content?.includes('pattern2') ?? false,
        authorize: (r) => (r.content?.includes('pattern2') ? { authorized: true, metadataPath: [child2AuthInfo] } : { authorized: false, reason: 'no match' }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild1, mockChild2])

      const resource = createTestResource('test', 'pattern1 and pattern2')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toContainEqual(child1AuthInfo)
      expect(result.metadataPath).toContainEqual(child2AuthInfo)
    })
  })

  /**
   * T018: Unit test for AndMatcher authorize() with short-circuit failure
   *
   * FR-014: Short-circuit evaluation (fails on first unsuccessful match)
   */
  describe('authorize() - short-circuit failure', () => {
    it('should short-circuit on first authorization failure', () => {
      let child3Called = false

      // Create mock matchers to track calls
      const mockChild1: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern1',
        getDescription: () => 'content:/pattern1/',
        identify: (r) => r.content?.includes('pattern1') ?? false,
        authorize: (r) => (r.content?.includes('pattern1') ? { authorized: true } : { authorized: false, reason: 'pattern1 not found' }),
      }

      const mockChild2: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern2',
        getDescription: () => 'content:/pattern2/',
        identify: (r) => r.content?.includes('pattern2') ?? false,
        authorize: () => ({ authorized: false, reason: 'pattern2 failed' }),
      }

      const mockChild3: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern3',
        getDescription: () => 'content:/pattern3/',
        identify: (r) => r.content?.includes('pattern3') ?? false,
        authorize: () => {
          child3Called = true
          return { authorized: true }
        },
      }

      const matcher = new AndMatcher<Matchable>([mockChild1, mockChild2, mockChild3])

      const resource = createTestResource('test', 'pattern1 pattern2 pattern3')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Child matcher failed: pattern2 failed')
      expect(child3Called).toBe(false) // Third child should not be called
    })

    it('should include partial metadata path on failure', () => {
      const child1AuthInfo = createAuthInfo('First check', true)

      const mockChild1: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern1',
        getDescription: () => 'content:/pattern1/',
        identify: (r) => r.content?.includes('pattern1') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child1AuthInfo] }),
      }

      const mockChild2: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern2',
        getDescription: () => 'content:/pattern2/',
        identify: (r) => r.content?.includes('pattern2') ?? false,
        authorize: () => ({ authorized: false, reason: 'failed' }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild1, mockChild2])

      const resource = createTestResource('test', 'pattern1 pattern2')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toContainEqual(child1AuthInfo)
    })
  })

  /**
   * T019: Unit test for AndMatcher authorize() with null/empty content
   *
   * Fail-secure behavior: null/empty content always triggers unauthorized
   */
  describe('authorize() - null/empty content', () => {
    it('should deny authorization for null content', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')])

      const resource: Matchable = {
        name: 'test',
        content: null,
        // hash is omitted for headers (optional field in Matchable interface)
      }
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Resource content is null or empty')
    })

    it('should deny authorization for empty string content', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')])

      const resource = createTestResource('test', '')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Resource content is null or empty')
    })

    it('should deny authorization for whitespace-only content', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')])

      const resource = createTestResource('test', '   \t\n  ')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Resource content is null or empty')
    })

    it('should include top-level metadata in path even for null content', () => {
      const authInfo = createAuthInfo('Test authorization', true)
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')], authInfo)

      const resource: Matchable = {
        name: 'test',
        content: null,
        // hash is omitted for headers (optional field in Matchable interface)
      }
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toContainEqual(authInfo)
    })
  })

  /**
   * T020: Unit test for AndMatcher authorize() with top-level authorisationInfo override (true)
   *
   * FR-004: Top-level authorisationInfo overrides child authorization decisions
   */
  describe('authorize() - top-level override (authorised: true)', () => {
    it('should override to authorized when top-level authorised is true', () => {
      const topLevelAuthInfo = createAuthInfo('Top-level override to authorize', true)

      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')], topLevelAuthInfo)

      const resource = createTestResource('test', 'content with pattern')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(result.metadataPath).toContainEqual(topLevelAuthInfo)
    })

    it('should prepend top-level metadata to path', () => {
      const topLevelAuthInfo = createAuthInfo('Top-level', true)
      const childAuthInfo = createAuthInfo('Child', true)

      const mockChild: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern',
        getDescription: () => 'content:/pattern/',
        identify: (r) => r.content?.includes('pattern') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [childAuthInfo] }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild], topLevelAuthInfo)

      const resource = createTestResource('test', 'pattern')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(2)
      expect(result.metadataPath![0]).toEqual(topLevelAuthInfo)
      expect(result.metadataPath![1]).toEqual(childAuthInfo)
    })
  })

  /**
   * T021: Unit test for AndMatcher authorize() with top-level authorisationInfo override (false)
   *
   * FR-011: authorisationInfo.authorised: false always denies
   */
  describe('authorize() - top-level override (authorised: false)', () => {
    it('should deny when top-level authorised is false even if all children authorize', () => {
      const topLevelAuthInfo = createAuthInfo('Explicitly denied for compliance reasons', false)

      const matcher = new AndMatcher<Matchable>([new ContentMatcher('.*')], topLevelAuthInfo)

      const resource = createTestResource('test', 'any content matches')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Top-level authorization denied: Explicitly denied for compliance reasons')
    })

    it('should include top-level metadata in denial path', () => {
      const topLevelAuthInfo = createAuthInfo('Denied', false)
      const childAuthInfo = createAuthInfo('Child would authorize', true)

      const mockChild: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern',
        getDescription: () => 'content:/pattern/',
        identify: (r) => r.content?.includes('pattern') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [childAuthInfo] }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild], topLevelAuthInfo)

      const resource = createTestResource('test', 'pattern')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toContainEqual(topLevelAuthInfo)
      expect(result.metadataPath).toContainEqual(childAuthInfo)
    })
  })

  /**
   * T022: Unit test for AndMatcher metadata path collection
   *
   * FR-009: Metadata path must contain full path from root to leaf
   */
  describe('metadata path collection', () => {
    it('should collect metadata from all evaluated children', () => {
      const child1Info = createAuthInfo('Child 1', true)
      const child2Info = createAuthInfo('Child 2', true)
      const child3Info = createAuthInfo('Child 3', true)

      const mockChild1: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'p1',
        getDescription: () => 'content:/p1/',
        identify: (r) => r.content?.includes('p1') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child1Info] }),
      }

      const mockChild2: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'p2',
        getDescription: () => 'content:/p2/',
        identify: (r) => r.content?.includes('p2') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child2Info] }),
      }

      const mockChild3: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'p3',
        getDescription: () => 'content:/p3/',
        identify: (r) => r.content?.includes('p3') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child3Info] }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild1, mockChild2, mockChild3])

      const resource = createTestResource('test', 'p1 p2 p3')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(3)
      expect(result.metadataPath).toContainEqual(child1Info)
      expect(result.metadataPath).toContainEqual(child2Info)
      expect(result.metadataPath).toContainEqual(child3Info)
    })

    it('should combine top-level and children metadata', () => {
      const topLevelInfo = createAuthInfo('Root AND matcher', true)
      const child1Info = createAuthInfo('Child 1', true)
      const child2Info = createAuthInfo('Child 2', true)

      const mockChild1: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'p1',
        getDescription: () => 'content:/p1/',
        identify: (r) => r.content?.includes('p1') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child1Info] }),
      }

      const mockChild2: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'p2',
        getDescription: () => 'content:/p2/',
        identify: (r) => r.content?.includes('p2') ?? false,
        authorize: () => ({ authorized: true, metadataPath: [child2Info] }),
      }

      const matcher = new AndMatcher<Matchable>([mockChild1, mockChild2], topLevelInfo)

      const resource = createTestResource('test', 'p1 p2')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(3)
      expect(result.metadataPath![0]).toEqual(topLevelInfo) // Root first
      expect(result.metadataPath![1]).toEqual(child1Info)
      expect(result.metadataPath![2]).toEqual(child2Info)
    })

    it('should handle children with no metadata', () => {
      const topLevelInfo = createAuthInfo('Root', true)

      const mockChild: Matcher<Matchable> = {
        getType: () => 'content',
        getPattern: () => 'pattern',
        getDescription: () => 'content:/pattern/',
        identify: (r) => r.content?.includes('pattern') ?? false,
        authorize: () => ({ authorized: true }), // No metadataPath
      }

      const matcher = new AndMatcher<Matchable>([mockChild], topLevelInfo)

      const resource = createTestResource('test', 'pattern')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1)
      expect(result.metadataPath![0]).toEqual(topLevelInfo)
    })

    it('should return empty metadata path when no authorization info provided', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')])

      const resource = createTestResource('test', 'pattern')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toEqual([])
    })
  })

  /**
   * Additional edge cases for completeness
   */
  describe('edge cases', () => {
    it('should handle single child that does not identify', () => {
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')])

      const resource = createTestResource('test', 'no match')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Not all child matchers identified the resource')
    })

    it('should return metadata path even when identification fails', () => {
      const authInfo = createAuthInfo('Test', true)
      const matcher = new AndMatcher<Matchable>([new ContentMatcher('pattern')], authInfo)

      const resource = createTestResource('test', 'no match')
      const result = matcher.authorize(resource)

      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toContainEqual(authInfo)
    })
  })
})
