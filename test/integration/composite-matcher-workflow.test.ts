/**
 * Composite Matcher Integration Tests (T041-T043)
 *
 * End-to-end integration tests for composite matchers with CSP headers.
 * Tests full workflow from header detection through comparison to authorization result.
 *
 * @see src/types/matcher/or-matcher.ts
 * @see src/types/matcher/and-matcher.ts
 * @see src/services/comparison/header.ts
 * @see specs/005-enhance-the-schema/spec.md - US2, FR-001, FR-013
 */

import type { InventoryAuthorisationInfo } from '../../src/types/inventory/model'
import { AndMatcher } from '../../src/types/matcher/and-matcher'
import { ContentMatcher } from '../../src/types/matcher/content-matcher'
import type { Matchable } from '../../src/types/matcher/matcher.interface'
import { OrMatcher } from '../../src/types/matcher/or-matcher'

describe('Composite Matcher Integration Tests (T041-T043)', () => {
  // Helper to create authorization info
  const createAuthInfo = (description: string, authorised: boolean): InventoryAuthorisationInfo => ({
    description,
    authorised,
    date: new Date('2025-10-22T12:00:00.000Z'),
  })

  // Helper to create matchable header (without hash field for headers)
  const createHeader = (name: string, value: string): Matchable => ({
    name,
    content: value,
  })

  describe('T041: CSP header with OR logic - first alternative matches', () => {
    it('should authorize when first alternative CSP policy matches', () => {
      // Create OR matcher with two alternative policies
      const strictPolicy = new ContentMatcher('default-src.*self.*script-src.*nonce-')
      const legacyPolicy = new ContentMatcher('default-src.*unsafe-inline')

      const orMatcher = new OrMatcher<Matchable>(
        [strictPolicy, legacyPolicy],
        createAuthInfo('CSP policy - strict or legacy', true),
      )

      // Header with strict policy (first alternative)
      const header = createHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'nonce-abc123'; connect-src https:",
      )

      // Test identification
      expect(orMatcher.identify(header)).toBe(true)

      // Test authorization
      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1)
      expect(result.metadataPath![0]!.description).toBe('CSP policy - strict or legacy')
    })

    it('should authorize when first alternative matches (array of policies)', () => {
      // Three alternative acceptable CSP policies
      const strictNonce = new ContentMatcher('default-src.*self.*script-src.*nonce-')
      const strictHash = new ContentMatcher('default-src.*self.*script-src.*hash-')
      const reportOnly = new ContentMatcher('report-uri')

      const orMatcher = new OrMatcher<Matchable>(
        [strictNonce, strictHash, reportOnly],
        createAuthInfo('CSP - strict nonce/hash or reporting enabled', true),
      )

      // Header matching first policy (nonce-based)
      const header = createHeader('content-security-policy', "default-src 'self'; script-src 'nonce-xyz';")

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
    })

    it('should use first-match-wins when multiple alternatives match', () => {
      const matchAll1 = new ContentMatcher('.*')
      const matchAll2 = new ContentMatcher('default-src')

      const orMatcher = new OrMatcher<Matchable>([matchAll1, matchAll2])

      const header = createHeader('content-security-policy', 'default-src https:;')

      // Should identify with first matcher
      expect(orMatcher.identify(header)).toBe(true)

      // Should authorize using first matcher's result
      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
    })
  })

  describe('T042: CSP header with OR logic - second alternative matches', () => {
    it('should authorize when second alternative CSP policy matches', () => {
      // Create OR matcher with two alternative policies
      const strictPolicy = new ContentMatcher('default-src.*self.*script-src.*nonce-')
      const legacyPolicy = new ContentMatcher('default-src.*unsafe-inline')

      const orMatcher = new OrMatcher<Matchable>(
        [strictPolicy, legacyPolicy],
        createAuthInfo('CSP policy - strict or legacy', true),
      )

      // Header with legacy policy (second alternative)
      const header = createHeader('content-security-policy', "default-src 'unsafe-inline'; script-src 'unsafe-inline';")

      // Test identification
      expect(orMatcher.identify(header)).toBe(true)

      // Test authorization
      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(1)
    })

    it('should authorize when last alternative matches (third of three)', () => {
      const policy1 = new ContentMatcher('upgrade-insecure-requests')
      const policy2 = new ContentMatcher('block-all-mixed-content')
      const policy3 = new ContentMatcher('frame-ancestors')

      const orMatcher = new OrMatcher<Matchable>(
        [policy1, policy2, policy3],
        createAuthInfo('CSP - any security enhancement directive', true),
      )

      // Header matching only third policy
      const header = createHeader('content-security-policy', "default-src https:; frame-ancestors 'self';")

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
    })

    it('should skip non-matching first alternative and use second', () => {
      const requiresNonce = new ContentMatcher('script-src.*nonce-')
      const requiresHttps = new ContentMatcher('default-src.*https:')

      const orMatcher = new OrMatcher<Matchable>([requiresNonce, requiresHttps])

      // Header matching second alternative only (no nonce)
      const header = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      expect(orMatcher.identify(header)).toBe(true)

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
    })
  })

  describe('T043: CSP header with OR logic - no alternatives match', () => {
    it('should deny authorization when no alternatives match', () => {
      // Create OR matcher with specific requirements
      const strictPolicy = new ContentMatcher('default-src.*self.*script-src.*nonce-')
      const legacyWithReport = new ContentMatcher('default-src.*unsafe-inline.*report-uri')

      const orMatcher = new OrMatcher<Matchable>(
        [strictPolicy, legacyWithReport],
        createAuthInfo('CSP policy - strict or legacy with reporting', true),
      )

      // Header that doesn't match any alternative
      const header = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      // Should not identify (no alternatives match)
      expect(orMatcher.identify(header)).toBe(false)

      // Should deny authorization
      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('No child matcher identified the resource')
    })

    it('should deny when content is incomplete', () => {
      const requiresAllDirectives = new OrMatcher<Matchable>([
        new ContentMatcher('default-src.*script-src.*connect-src.*object-src'),
      ])

      // Header missing required directives
      const header = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      const result = requiresAllDirectives.authorize(header)
      expect(result.authorized).toBe(false)
    })

    it('should deny when header value is null', () => {
      const orMatcher = new OrMatcher<Matchable>([new ContentMatcher('.*')])

      const header = createHeader('content-security-policy', null as any)

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Resource content is null or empty')
    })

    it('should deny when header value is empty string', () => {
      const orMatcher = new OrMatcher<Matchable>([new ContentMatcher('.*')])

      const header = createHeader('content-security-policy', '')

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Resource content is null or empty')
    })

    it('should include top-level metadata path even when no alternatives match', () => {
      const authInfo = createAuthInfo('CSP policy - requires specific directives', true)
      const orMatcher = new OrMatcher<Matchable>([new ContentMatcher('nonexistent-directive')], authInfo)

      const header = createHeader('content-security-policy', 'default-src https:;')

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.metadataPath).toEqual([authInfo])
    })
  })

  describe('Complex OR scenarios with nested composites', () => {
    it('should handle OR containing AND matchers (nested composites)', () => {
      // Create two AND matchers representing different complete policies
      const strictAndComplete = new AndMatcher<Matchable>([
        new ContentMatcher('default-src.*self'),
        new ContentMatcher('script-src.*nonce-'),
        new ContentMatcher('object-src.*none'),
      ])

      const legacyWithProtections = new AndMatcher<Matchable>([
        new ContentMatcher('default-src.*unsafe-inline'),
        new ContentMatcher('report-uri'),
        new ContentMatcher('upgrade-insecure-requests'),
      ])

      // Wrap in OR matcher
      const orMatcher = new OrMatcher<Matchable>(
        [strictAndComplete, legacyWithProtections],
        createAuthInfo('CSP - either strict or legacy with protections', true),
      )

      // Header matching first AND matcher
      const strictHeader = createHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'nonce-abc'; object-src 'none';",
      )

      const strictResult = orMatcher.authorize(strictHeader)
      expect(strictResult.authorized).toBe(true)

      // Header matching second AND matcher
      const legacyHeader = createHeader(
        'content-security-policy',
        "default-src 'unsafe-inline'; report-uri /csp-report; upgrade-insecure-requests;",
      )

      const legacyResult = orMatcher.authorize(legacyHeader)
      expect(legacyResult.authorized).toBe(true)

      // Header matching neither (missing directives in both)
      const incompleteHeader = createHeader('content-security-policy', 'default-src https:;')

      const incompleteResult = orMatcher.authorize(incompleteHeader)
      expect(incompleteResult.authorized).toBe(false)
    })

    it('should collect metadata path through nested OR and AND matchers', () => {
      const rootInfo = createAuthInfo('Root OR matcher', true)
      const andInfo = createAuthInfo('Nested AND matcher', true)

      const andMatcher = new AndMatcher<Matchable>(
        [new ContentMatcher('default-src'), new ContentMatcher('script-src')],
        andInfo,
      )

      const orMatcher = new OrMatcher<Matchable>([andMatcher], rootInfo)

      const header = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(2)
      expect(result.metadataPath?.[0]).toEqual(rootInfo)
      expect(result.metadataPath?.[1]).toEqual(andInfo)
    })
  })

  describe('Top-level authorization override with OR matcher', () => {
    it('should override to authorize when top-level authorised is true', () => {
      const authInfo = createAuthInfo('Override to authorize', true)

      // Header that would normally match
      const header = createHeader('content-security-policy', 'legacy-policy')

      // OrMatcher with child that identifies, testing top-level override
      const matcherThatIdentifies = new OrMatcher<Matchable>([new ContentMatcher('legacy')], authInfo)

      const result = matcherThatIdentifies.authorize(header)
      expect(result.authorized).toBe(true)
    })

    it('should override to deny when top-level authorised is false', () => {
      const authInfo = createAuthInfo('Explicitly denied policy', false)
      const orMatcher = new OrMatcher<Matchable>([new ContentMatcher('.*')], authInfo)

      // Header that would normally match everything
      const header = createHeader('content-security-policy', 'any policy here')

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('Top-level authorization denied: Explicitly denied policy')
    })
  })
})
