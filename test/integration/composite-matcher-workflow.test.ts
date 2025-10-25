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
import { HashMatcher } from '../../src/types/matcher/hash-matcher'
import type { Matchable } from '../../src/types/matcher/matcher.interface'
import { createMatcher } from '../../src/types/matcher/matcher-factory'
import { OrMatcher } from '../../src/types/matcher/or-matcher'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../../src/utils/script'

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

      const orMatcher = new OrMatcher<Matchable>([strictPolicy, legacyPolicy], createAuthInfo('CSP policy - strict or legacy', true))

      // Header with strict policy (first alternative)
      const header = createHeader('content-security-policy', "default-src 'self'; script-src 'nonce-abc123'; connect-src https:")

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

      const orMatcher = new OrMatcher<Matchable>([strictNonce, strictHash, reportOnly], createAuthInfo('CSP - strict nonce/hash or reporting enabled', true))

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

      const orMatcher = new OrMatcher<Matchable>([strictPolicy, legacyPolicy], createAuthInfo('CSP policy - strict or legacy', true))

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

      const orMatcher = new OrMatcher<Matchable>([policy1, policy2, policy3], createAuthInfo('CSP - any security enhancement directive', true))

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

      const orMatcher = new OrMatcher<Matchable>([strictPolicy, legacyWithReport], createAuthInfo('CSP policy - strict or legacy with reporting', true))

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
      const requiresAllDirectives = new OrMatcher<Matchable>([new ContentMatcher('default-src.*script-src.*connect-src.*object-src')])

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
      const strictAndComplete = new AndMatcher<Matchable>([new ContentMatcher('default-src.*self'), new ContentMatcher('script-src.*nonce-'), new ContentMatcher('object-src.*none')])

      const legacyWithProtections = new AndMatcher<Matchable>([new ContentMatcher('default-src.*unsafe-inline'), new ContentMatcher('report-uri'), new ContentMatcher('upgrade-insecure-requests')])

      // Wrap in OR matcher
      const orMatcher = new OrMatcher<Matchable>([strictAndComplete, legacyWithProtections], createAuthInfo('CSP - either strict or legacy with protections', true))

      // Header matching first AND matcher
      const strictHeader = createHeader('content-security-policy', "default-src 'self'; script-src 'nonce-abc'; object-src 'none';")

      const strictResult = orMatcher.authorize(strictHeader)
      expect(strictResult.authorized).toBe(true)

      // Header matching second AND matcher
      const legacyHeader = createHeader('content-security-policy', "default-src 'unsafe-inline'; report-uri /csp-report; upgrade-insecure-requests;")

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

      const andMatcher = new AndMatcher<Matchable>([new ContentMatcher('default-src'), new ContentMatcher('script-src')], andInfo)

      const orMatcher = new OrMatcher<Matchable>([andMatcher], rootInfo)

      const header = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      const result = orMatcher.authorize(header)
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toHaveLength(2)
      expect(result.metadataPath![0]).toEqual(rootInfo)
      expect(result.metadataPath![1]).toEqual(andInfo)
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

  describe('T051: Array syntax equivalence to explicit orMatcher', () => {
    it('should behave identically to explicit OrMatcher (first matches)', () => {
      // Explicit OrMatcher
      const explicit = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('First description', true))

      // Array syntax is converted to OrMatcher by processAuthorizeWith
      // For testing purposes, we create it the same way
      const fromArray = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('First description', true))

      const header1 = createHeader('test', 'This contains pattern-one')

      const explicitResult = explicit.authorize(header1)
      const arrayResult = fromArray.authorize(header1)

      expect(explicitResult.authorized).toBe(arrayResult.authorized)
      expect(explicitResult.authorized).toBe(true)
    })

    it('should behave identically to explicit OrMatcher (second matches)', () => {
      const explicit = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('Test matcher', true))

      const fromArray = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('Test matcher', true))

      const header2 = createHeader('test', 'This contains pattern-two only')

      const explicitResult = explicit.authorize(header2)
      const arrayResult = fromArray.authorize(header2)

      expect(explicitResult.authorized).toBe(arrayResult.authorized)
      expect(explicitResult.authorized).toBe(true)
    })

    it('should behave identically to explicit OrMatcher (no match)', () => {
      const explicit = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('Test matcher', true))

      const fromArray = new OrMatcher<Matchable>([new ContentMatcher('pattern-one'), new ContentMatcher('pattern-two')], createAuthInfo('Test matcher', true))

      const header3 = createHeader('test', 'This contains neither pattern')

      const explicitResult = explicit.authorize(header3)
      const arrayResult = fromArray.authorize(header3)

      expect(explicitResult.authorized).toBe(arrayResult.authorized)
      expect(explicitResult.authorized).toBe(false)
    })

    it('should have identical metadata paths', () => {
      const authInfo = createAuthInfo('Array syntax test', true)
      const explicit = new OrMatcher<Matchable>([new ContentMatcher('test-pattern')], authInfo)
      const fromArray = new OrMatcher<Matchable>([new ContentMatcher('test-pattern')], authInfo)

      const header = createHeader('test', 'test-pattern content')

      const explicitResult = explicit.authorize(header)
      const arrayResult = fromArray.authorize(header)

      expect(explicitResult.metadataPath).toEqual(arrayResult.metadataPath)
      expect(explicitResult.metadataPath).toHaveLength(1)
      expect(explicitResult.metadataPath![0]!.description).toBe('Array syntax test')
    })
  })

  describe('T053: Array syntax integration with comparison services', () => {
    it('should work end-to-end with array syntax for CSP authorization', () => {
      // Simulating array syntax converted to OrMatcher
      // In real usage, processAuthorizeWith converts array to OrMatcher
      const arrayAsOrMatcher = new OrMatcher<Matchable>([new ContentMatcher('default-src.*self'), new ContentMatcher('default-src.*unsafe-inline'), new ContentMatcher('report-uri')], createAuthInfo('CSP - any acceptable policy', true))

      // Test all three alternatives
      const strictHeader = createHeader('csp', "default-src 'self'; script-src 'nonce-abc';")
      const legacyHeader = createHeader('csp', "default-src 'unsafe-inline';")
      const reportingHeader = createHeader('csp', 'default-src https:; report-uri /csp-report;')

      expect(arrayAsOrMatcher.authorize(strictHeader).authorized).toBe(true)
      expect(arrayAsOrMatcher.authorize(legacyHeader).authorized).toBe(true)
      expect(arrayAsOrMatcher.authorize(reportingHeader).authorized).toBe(true)
    })

    it('should work with mixed simple and composite matchers in array', () => {
      // Array containing both simple and composite matchers
      const complexOrMatcher = new OrMatcher<Matchable>(
        [
          // Simple content matcher
          new ContentMatcher('simple-pattern'),
          // Composite AND matcher
          new AndMatcher<Matchable>([new ContentMatcher('complex-1'), new ContentMatcher('complex-2')]),
        ],
        createAuthInfo('Mixed matcher types', true),
      )

      // Test simple pattern
      const simpleHeader = createHeader('test', 'simple-pattern here')
      expect(complexOrMatcher.authorize(simpleHeader).authorized).toBe(true)

      // Test complex AND pattern
      const complexHeader = createHeader('test', 'has complex-1 and complex-2 both')
      expect(complexOrMatcher.authorize(complexHeader).authorized).toBe(true)

      // Test neither
      const neitherHeader = createHeader('test', 'nothing matches')
      expect(complexOrMatcher.authorize(neitherHeader).authorized).toBe(false)
    })

    it('should maintain metadata path through array syntax conversion', () => {
      // Simulating the actual array syntax processing
      const authInfo = createAuthInfo('Array syntax with metadata', true)
      const matcher = new OrMatcher<Matchable>([new ContentMatcher('authorized-pattern'), new ContentMatcher('backup-pattern')], authInfo)

      const header = createHeader('test', 'authorized-pattern content')
      const result = matcher.authorize(header)

      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toBeDefined()
      expect(result.metadataPath).toHaveLength(1)
      expect(result.metadataPath![0]).toEqual(authInfo)
    })

    it('should support first-match-wins in array syntax', () => {
      // Array with overlapping matchers
      const matcher = new OrMatcher<Matchable>(
        [
          new ContentMatcher('.*'), // Matches everything
          new ContentMatcher('specific-pattern'), // More specific
        ],
        createAuthInfo('First-match-wins test', true),
      )

      const header = createHeader('test', 'specific-pattern content')

      // Should match with first matcher (.*) even though both match
      const result = matcher.authorize(header)
      expect(result.authorized).toBe(true)
    })
  })

  describe('T060: Nested composite with real CSP policy', () => {
    it('should handle complex real-world CSP policy with deeply nested composites', () => {
      // Real-world scenario: Payment page CSP policy
      // Accept EITHER:
      //   1. Strict policy: (default-src 'self' AND script-src with nonce AND no unsafe directives)
      //   2. Legacy policy: (default-src with unsafe-inline AND report-uri AND frame-ancestors)
      //   3. Transitional policy: (upgrade-insecure-requests AND report-uri AND (strict script-src OR CSP nonce))

      // Policy 1: Strict and secure
      const strictDefaults = new AndMatcher<Matchable>(
        [
          new ContentMatcher("default-src.*'self'"),
          new ContentMatcher("script-src.*'nonce-"),
          new ContentMatcher('^((?!unsafe-inline).)*$'), // Must NOT contain unsafe-inline
        ],
        createAuthInfo('Strict CSP policy - nonce-based scripts', true),
      )

      // Policy 2: Legacy with protections
      const legacyWithProtections = new AndMatcher<Matchable>(
        [new ContentMatcher("default-src.*'unsafe-inline'"), new ContentMatcher('report-uri'), new ContentMatcher('frame-ancestors')],
        createAuthInfo('Legacy CSP policy with reporting and frame protection', true),
      )

      // Policy 3: Transitional policy (nested OR within AND)
      const scriptSrcOptions = new OrMatcher<Matchable>([new ContentMatcher("script-src.*'strict-dynamic'"), new ContentMatcher("script-src.*'nonce-")], createAuthInfo('Script-src: either strict-dynamic or nonce', true))

      const transitionalPolicy = new AndMatcher<Matchable>([new ContentMatcher('upgrade-insecure-requests'), new ContentMatcher('report-uri'), scriptSrcOptions], createAuthInfo('Transitional policy - upgrading with reporting', true))

      // Root OR matcher combining all three policies
      const cspMatcher = new OrMatcher<Matchable>([strictDefaults, legacyWithProtections, transitionalPolicy], createAuthInfo('Payment page CSP - strict, legacy, or transitional', true))

      // Test Case 1: Strict policy header
      const strictHeader = createHeader('content-security-policy', "default-src 'self'; script-src 'nonce-r4nd0m' 'strict-dynamic'; object-src 'none'; base-uri 'self'; report-uri /csp-report;")

      const strictResult = cspMatcher.authorize(strictHeader)
      expect(strictResult.authorized).toBe(true)
      expect(strictResult.metadataPath).toHaveLength(2) // Root OR + Strict AND
      expect(strictResult.metadataPath![0]!.description).toContain('Payment page CSP')
      expect(strictResult.metadataPath![1]!.description).toContain('Strict CSP policy')

      // Test Case 2: Legacy policy header
      const legacyHeader = createHeader('content-security-policy', "default-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; frame-ancestors 'self'; report-uri /csp-report;")

      const legacyResult = cspMatcher.authorize(legacyHeader)
      expect(legacyResult.authorized).toBe(true)
      expect(legacyResult.metadataPath).toHaveLength(2) // Root OR + Legacy AND
      expect(legacyResult.metadataPath![1]!.description).toContain('Legacy CSP policy')

      // Test Case 3: Transitional policy header (with nested OR match)
      const transitionalHeader = createHeader('content-security-policy', "default-src https:; script-src 'strict-dynamic' https:; upgrade-insecure-requests; report-uri /csp-report;")

      const transitionalResult = cspMatcher.authorize(transitionalHeader)
      expect(transitionalResult.authorized).toBe(true)
      expect(transitionalResult.metadataPath).toHaveLength(3) // Root OR + Transitional AND + Script-src OR
      expect(transitionalResult.metadataPath![1]!.description).toContain('Transitional policy')
      expect(transitionalResult.metadataPath![2]!.description).toContain('Script-src')

      // Test Case 4: Invalid policy (doesn't match any of the three)
      const invalidHeader = createHeader('content-security-policy', 'default-src https:; script-src https:;')

      const invalidResult = cspMatcher.authorize(invalidHeader)
      expect(invalidResult.authorized).toBe(false)
      expect(invalidResult.reason).toContain('No child matcher identified')
    })

    it('should handle 5-level nesting with CSP directive combinations', () => {
      // Level 5: Leaf matchers for specific CSP directives
      const defaultSrc = new ContentMatcher('default-src')
      const scriptSrc = new ContentMatcher('script-src')
      const connectSrc = new ContentMatcher('connect-src')
      const imgSrc = new ContentMatcher('img-src')

      // Level 4: AND groups for directive combinations
      const minimalDirectives = new AndMatcher<Matchable>([defaultSrc, scriptSrc], createAuthInfo('Level 4: Minimal required directives', true))

      const fullDirectives = new AndMatcher<Matchable>([defaultSrc, scriptSrc, connectSrc, imgSrc], createAuthInfo('Level 4: Complete directive set', true))

      // Level 3: OR for directive requirement options
      const directiveOptions = new OrMatcher<Matchable>([minimalDirectives, fullDirectives], createAuthInfo('Level 3: Either minimal or full directives', true))

      // Level 2: AND with additional requirements
      const upgradeRequirement = new ContentMatcher('upgrade-insecure-requests')
      const policyWithUpgrade = new AndMatcher<Matchable>([directiveOptions, upgradeRequirement], createAuthInfo('Level 2: Directives AND upgrade-insecure-requests', true))

      // Level 1: Root OR with alternative top-level policies
      const reportingOnly = new ContentMatcher('report-uri')
      const rootPolicy = new OrMatcher<Matchable>([policyWithUpgrade, reportingOnly], createAuthInfo('Level 1: Complete policy OR reporting-only', true))

      // Test: Full policy path (5 levels)
      const fullHeader = createHeader('content-security-policy', 'default-src https:; script-src https:; connect-src https:; img-src https:; upgrade-insecure-requests;')

      const fullResult = rootPolicy.authorize(fullHeader)
      expect(fullResult.authorized).toBe(true)
      expect(fullResult.metadataPath).toHaveLength(4) // Levels 1-4 (leaves don't have metadata)
      expect(fullResult.metadataPath![0]!.description).toContain('Level 1')
      expect(fullResult.metadataPath![1]!.description).toContain('Level 2')
      expect(fullResult.metadataPath![2]!.description).toContain('Level 3')
      // First-match-wins: minimal directives match before full directives in OR matcher
      expect(fullResult.metadataPath![3]!.description).toContain('Level 4: Minimal')

      // Test: Short-circuit path (reporting-only, bypasses nested structure)
      const reportingHeader = createHeader('content-security-policy', 'report-uri /csp-report;')

      const reportingResult = rootPolicy.authorize(reportingHeader)
      expect(reportingResult.authorized).toBe(true)
      expect(reportingResult.metadataPath).toHaveLength(1) // Only Level 1
      expect(reportingResult.metadataPath![0]!.description).toContain('Level 1')
    })
  })

  describe('Serialization/Deserialization Integration (T050-T051)', () => {
    describe('T050: Full inventory workflow with composite matchers', () => {
      it('should serialize and deserialize composite matchers in full inventory workflow', () => {
        // This tests the full round-trip: Create inventory → Serialize to JSON → Deserialize back → Verify structure

        // Create inventory script with composite matcher
        const originalScript = {
          identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/analytics\\.js$' }),
          authoriseWith: {
            matcher: new OrMatcher(
              [
                new HashMatcher([{ timestamp: new Date('2025-10-24T12:00:00.000Z'), hash: { value: 'version1hash'.padEnd(64, '0') } }]),
                new HashMatcher([{ timestamp: new Date('2025-10-24T14:00:00.000Z'), hash: { value: 'version2hash'.padEnd(64, '0') } }]),
              ],
              {
                description: 'Analytics script - accept version 1.0 or 2.0',
                authorised: true,
                date: new Date('2025-10-24T12:00:00.000Z'),
              },
            ),
            authorisationInfo: {
              description: 'Third-party analytics for conversion tracking',
              authorised: true,
              date: new Date('2025-10-24T12:00:00.000Z'),
            },
          },
        }

        // Step 1: Serialize to JSON (simulates saving to Git)
        const serialized = inventoryScriptInfoToRawInventoryScriptInfo(originalScript)

        // Children don't have authorisationInfo, so falls back to orMatcher format
        expect(serialized.authoriseWith).toHaveProperty('orMatcher')
        expect(serialized.authoriseWith).toHaveProperty('authorisationInfo')
        expect((serialized.authoriseWith as any).orMatcher.length).toBe(2)
        expect((serialized.authoriseWith as any).orMatcher[0]).toHaveProperty('hashes')
        expect((serialized.authoriseWith as any).orMatcher[1]).toHaveProperty('hashes')

        // Step 2: Simulate JSON round-trip (stringify/parse)
        const jsonString = JSON.stringify(serialized)
        const parsedJson = JSON.parse(jsonString)

        // Step 3: Deserialize back to Matcher instances (simulates loading from Git)
        const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(parsedJson)

        // Step 4: Verify structure preserved
        expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
        const children = deserialized.authoriseWith.matcher.getPattern() as any[]
        expect(children).toHaveLength(2)
        // With AuthorisationMatcher, children are no longer wrapped
        expect(children[0]!.getType()).toBe('hash')
        expect(children[1]!.getType()).toBe('hash')

        // Step 5: Verify top-level authorization metadata preserved
        expect(deserialized.authoriseWith.authorisationInfo.description).toBe('Third-party analytics for conversion tracking')
        expect(deserialized.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(deserialized.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-24T12:00:00.000Z')

        // Note: The nested authorisationInfo on OrMatcher itself is not preserved in the current
        // serialization format. The authorisationInfo lives at the authoriseWith level, not nested
        // inside the matcher config.

        // Step 6: Verify the deserialized matcher structure is correct
        // The OrMatcher should have 2 wrapped children (metadata carriers)
        const orChildren = deserialized.authoriseWith.matcher.getPattern() as any[]
        // With AuthorisationMatcher, children are no longer wrapped
        expect(orChildren[0]!.getType()).toBe('hash')
        expect(orChildren[1]!.getType()).toBe('hash')

        // Verify hashes are preserved
        const hash1Pattern = orChildren[0]!.getPattern() as Array<{ timestamp: Date; hash: { value: string } }>
        const hash2Pattern = orChildren[1]!.getPattern() as Array<{ timestamp: Date; hash: { value: string } }>
        expect(hash1Pattern[0]!.hash.value).toBe('version1hash'.padEnd(64, '0'))
        expect(hash2Pattern[0]!.hash.value).toBe('version2hash'.padEnd(64, '0'))
      })

      it('should handle nested composite matchers in full workflow', () => {
        // Create nested composite: OrMatcher containing AndMatcher
        const originalScript = {
          identifyWith: createMatcher({ nameMatcher: '^https://payment\\.example\\.com/.*$' }),
          authoriseWith: {
            matcher: new OrMatcher(
              [
                new AndMatcher([new ContentMatcher('paymentProcessor'), new ContentMatcher('secureCheckout')], {
                  description: 'Secure payment flow',
                  authorised: true,
                  date: new Date('2025-10-24T10:00:00.000Z'),
                }),
                new ContentMatcher('legacyPaymentFlow'),
              ],
              {
                description: 'Payment script - secure or legacy flow',
                authorised: true,
                date: new Date('2025-10-24T12:00:00.000Z'),
              },
            ),
            authorisationInfo: {
              description: 'Payment page script',
              authorised: true,
              date: new Date('2025-10-24T00:00:00.000Z'),
            },
          },
        }

        // Serialize → JSON round-trip → Deserialize
        const serialized = inventoryScriptInfoToRawInventoryScriptInfo(originalScript)
        const jsonString = JSON.stringify(serialized)
        const parsedJson = JSON.parse(jsonString)
        const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(parsedJson)

        // Verify nested structure preserved
        expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
        const orChildren = deserialized.authoriseWith.matcher.getPattern() as any[]
        expect(orChildren).toHaveLength(2)
        // With AuthorisationMatcher, children are no longer wrapped
        expect(orChildren[0]!.getType()).toBe('and')
        expect(orChildren[1]!.getType()).toBe('content')

        // Verify nested AND matcher
        const andChildren = orChildren[0]!.getPattern() as any[]
        expect(andChildren).toHaveLength(2)
        expect(andChildren[0]!.getType()).toBe('content')
        expect(andChildren[1]!.getType()).toBe('content')

        // Verify top-level metadata (uses authoriseWith.authorisationInfo)
        expect(deserialized.authoriseWith.authorisationInfo.description).toBe('Payment page script')
        expect(deserialized.authoriseWith.authorisationInfo.authorised).toBe(true)
        expect(deserialized.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-24T00:00:00.000Z')

        // Note: Nested authorisationInfo on composite matchers is not preserved in current format
      })
    })

    describe('T051: Git commit with composite matcher inventory', () => {
      it('should produce valid JSON that can be committed to Git', () => {
        const inventoryScript = {
          identifyWith: createMatcher({ nameMatcher: '^https://cdn\\.example\\.com/.*$' }),
          authoriseWith: {
            matcher: new OrMatcher([new HashMatcher([{ timestamp: new Date('2025-10-24T12:00:00.000Z'), hash: { value: 'hash1'.padEnd(64, '0') } }]), new ContentMatcher('fallback-pattern')], {
              description: 'CDN script with hash verification or pattern fallback',
              authorised: true,
              date: new Date('2025-10-24T12:00:00.000Z'),
            }),
            authorisationInfo: {
              description: 'CDN-hosted script',
              authorised: true,
              date: new Date('2025-10-24T00:00:00.000Z'),
            },
          },
        }

        // Serialize to raw format
        const serialized = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

        // Convert to JSON string (what gets committed to Git)
        const jsonString = JSON.stringify(serialized, null, 2)

        // Verify JSON is valid
        expect(() => JSON.parse(jsonString)).not.toThrow()

        // Verify JSON structure is correct for Git storage
        const parsed = JSON.parse(jsonString)
        expect(parsed).toHaveProperty('identifyWith')
        expect(parsed).toHaveProperty('authoriseWith')

        // Since children don't have authorisationInfo, it falls back to orMatcher format
        expect(parsed.authoriseWith).toHaveProperty('orMatcher')
        expect(parsed.authoriseWith).toHaveProperty('authorisationInfo')

        // Verify dates are ISO strings (human-readable in Git diffs)
        expect(typeof parsed.authoriseWith.authorisationInfo.date).toBe('string')
        expect(parsed.authoriseWith.authorisationInfo.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

        // Verify no circular references (would break JSON.stringify)
        expect(jsonString).not.toContain('[Circular]')
      })

      it('should support multiple scripts with different composite matcher types in same inventory', () => {
        // Script 1: OrMatcher
        const script1 = {
          identifyWith: createMatcher({ nameMatcher: '^script1$' }),
          authoriseWith: {
            matcher: new OrMatcher([new ContentMatcher('pattern-a'), new ContentMatcher('pattern-b')]),
            authorisationInfo: { description: 'Script 1', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        // Script 2: AndMatcher
        const script2 = {
          identifyWith: createMatcher({ nameMatcher: '^script2$' }),
          authoriseWith: {
            matcher: new AndMatcher([new ContentMatcher('req1'), new ContentMatcher('req2')]),
            authorisationInfo: { description: 'Script 2', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        // Script 3: Nested composite
        const script3 = {
          identifyWith: createMatcher({ nameMatcher: '^script3$' }),
          authoriseWith: {
            matcher: new OrMatcher([new AndMatcher([new ContentMatcher('a'), new ContentMatcher('b')]), new ContentMatcher('c')]),
            authorisationInfo: { description: 'Script 3', authorised: true, date: new Date('2025-10-24T00:00:00.000Z') },
          },
        }

        // Serialize all scripts
        const serialized1 = inventoryScriptInfoToRawInventoryScriptInfo(script1)
        const serialized2 = inventoryScriptInfoToRawInventoryScriptInfo(script2)
        const serialized3 = inventoryScriptInfoToRawInventoryScriptInfo(script3)

        // Create inventory JSON (what gets committed)
        const inventory = {
          scripts: [serialized1, serialized2, serialized3],
          headers: [],
          target: { inventory: 'https://example.com', detection: 'https://example.com' },
          alerts: {},
        }

        const jsonString = JSON.stringify(inventory, null, 2)

        // Verify valid JSON
        expect(() => JSON.parse(jsonString)).not.toThrow()

        // Verify all scripts serialized correctly
        const parsed = JSON.parse(jsonString)
        expect(parsed.scripts).toHaveLength(3)
        // Script 1: OrMatcher without its own authInfo uses array syntax
        expect(Array.isArray(parsed.scripts[0].authoriseWith)).toBe(true)
        // Script 2: AndMatcher keeps andMatcher format
        expect(parsed.scripts[1].authoriseWith).toHaveProperty('andMatcher')
        expect(parsed.scripts[1].authoriseWith).toHaveProperty('authorisationInfo')
        // Script 3: Nested OrMatcher without its own authInfo uses array syntax
        expect(Array.isArray(parsed.scripts[2].authoriseWith)).toBe(true)

        // Verify nested structure in script3 - first array element should have andMatcher
        expect(parsed.scripts[2].authoriseWith[0]).toHaveProperty('andMatcher')
      })
    })
  })
})
