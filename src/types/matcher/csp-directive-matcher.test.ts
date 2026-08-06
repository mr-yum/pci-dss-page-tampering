/**
 * Unit tests for the set-based CSP directive matcher.
 *
 * The security contract is asymmetric and worth stating plainly: reordering and
 * removing sources must pass, adding one must fail. These tests exist to keep
 * that asymmetry from drifting.
 *
 * @see ./csp-directive-matcher.ts
 */

import { CSP_ANY_NONCE, CspDirectiveMatcher } from './csp-directive-matcher.js'
import type { AuthorisationInfo, Matchable } from './matcher.interface.js'

describe('CspDirectiveMatcher', () => {
  const ALLOW = ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', 'https://m.stripe.network']

  const matcher = (allow: readonly string[] = ALLOW, authorisationInfo?: AuthorisationInfo): CspDirectiveMatcher => new CspDirectiveMatcher('frame-src', allow, authorisationInfo)

  const value = (content: string | null): Matchable => ({ name: 'content-security-policy', content })

  describe('constructor', () => {
    it('rejects an empty directive', () => {
      expect(() => new CspDirectiveMatcher('   ', [])).toThrow('CspDirectiveMatcher requires a directive name')
    })

    it('normalises the directive name to lower case', () => {
      expect(new CspDirectiveMatcher('Frame-SRC', []).getDirective()).toBe('frame-src')
    })
  })

  describe('identify', () => {
    it('identifies a value for its own directive', () => {
      expect(matcher().identify(value("frame-src 'self'"))).toBe(true)
    })

    it('identifies regardless of the sources present', () => {
      expect(matcher().identify(value('frame-src https://anything.example.test'))).toBe(true)
    })

    it('is case-insensitive about the directive name, as CSP is', () => {
      expect(matcher().identify(value("FRAME-SRC 'self'"))).toBe(true)
    })

    it('does not identify a different directive', () => {
      expect(matcher().identify(value("script-src 'self'"))).toBe(false)
    })

    it.each([[null], [''], ['   ']])('does not identify %j', (content) => {
      expect(matcher().identify(value(content))).toBe(false)
    })
  })

  describe('authorize', () => {
    it('authorises the exact approved value', () => {
      expect(matcher().authorize(value(`frame-src ${ALLOW.join(' ')}`)).authorized).toBe(true)
    })

    it('authorises any ordering of the same sources', () => {
      const shuffled = ['https://m.stripe.network', "'self'", 'https://hooks.stripe.com', 'https://js.stripe.com']

      expect(matcher().authorize(value(`frame-src ${shuffled.join(' ')}`)).authorized).toBe(true)
    })

    it('authorises a subset, because allowing fewer origins is strictly safer', () => {
      expect(matcher().authorize(value("frame-src 'self'")).authorized).toBe(true)
      expect(matcher().authorize(value('frame-src')).authorized).toBe(true)
    })

    it('tolerates irregular whitespace and a trailing semicolon', () => {
      expect(matcher().authorize(value("  frame-src    'self'\thttps://js.stripe.com ;  ")).authorized).toBe(true)
    })

    it('refuses a source that is not approved, and names it', () => {
      const result = matcher().authorize(value("frame-src 'self' https://evil.example.test"))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('https://evil.example.test')
      // The approved sources are not the finding; only the additions are.
      expect(result.reason).not.toContain('https://js.stripe.com')
    })

    it('names every unapproved source, not just the first', () => {
      const result = matcher().authorize(value("frame-src 'self' https://a.example.test https://b.example.test"))

      expect(result.reason).toContain('https://a.example.test')
      expect(result.reason).toContain('https://b.example.test')
    })

    it('does not expand wildcards, because the policy text is the subject', () => {
      // Approving `*.js.stripe.com` is a different assertion from approving a
      // specific host, and a change between them must be reported.
      const wildcard = new CspDirectiveMatcher('frame-src', ['https://*.js.stripe.com'])

      expect(wildcard.authorize(value('frame-src https://a.js.stripe.com')).authorized).toBe(false)
      expect(wildcard.authorize(value('frame-src https://*.js.stripe.com')).authorized).toBe(true)
    })

    it('compares sources case-sensitively so a nonce cannot be spoofed by case', () => {
      const nonce = new CspDirectiveMatcher('script-src', ["'nonce-AbC123'"])

      expect(nonce.authorize(value("script-src 'nonce-AbC123'")).authorized).toBe(true)
      expect(nonce.authorize(value("script-src 'nonce-abc123'")).authorized).toBe(false)
    })

    it('refuses a value for a different directive', () => {
      const result = matcher().authorize(value("script-src 'self'"))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("expected directive 'frame-src'")
    })

    it.each([[null], [''], ['   ']])('fails secure on %j content', (content) => {
      const result = matcher().authorize(value(content))

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('content is null or empty')
    })

    it('denies when the entry itself is marked unauthorised', () => {
      const denied: AuthorisationInfo = { description: 'revoked', authorised: false, date: new Date('2026-01-01T00:00:00.000Z') }
      const result = matcher(ALLOW, denied).authorize(value("frame-src 'self'"))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('Top-level authorization denied')
    })

    it('carries its authorisation metadata into the result', () => {
      const info: AuthorisationInfo = { description: 'Stripe payment frames', authorised: true, date: new Date('2026-01-01T00:00:00.000Z') }

      expect(matcher(ALLOW, info).authorize(value("frame-src 'self'")).metadataPath).toEqual([info])
    })
  })

  describe("the 'nonce-*' wildcard", () => {
    const withNonce = new CspDirectiveMatcher('script-src', ["'self'", CSP_ANY_NONCE, 'https://js.stripe.com'])

    it('authorises any per-response nonce', () => {
      // A nonce is regenerated every response, so pinning one would fail on the
      // next request. This is the only wildcard the matcher understands.
      expect(withNonce.authorize(value("script-src 'self' 'nonce-8i04cnq3xfOdYNQwZyf+Ng=='")).authorized).toBe(true)
      expect(withNonce.authorize(value("script-src 'self' 'nonce-TgM16Gc9JJRcMFc2lCacwg=='")).authorized).toBe(true)
      expect(withNonce.authorize(value("script-src 'nonce-sfBVKZu3LcjNmuHZK52PM5'")).authorized).toBe(true)
    })

    it('still refuses any other added source alongside a nonce', () => {
      // The point of wildcarding only the nonce: a downgrade or an added origin
      // must still re-alert.
      const result = withNonce.authorize(value("script-src 'self' 'nonce-abc123' 'unsafe-inline'"))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("'unsafe-inline'")
      expect(result.reason).not.toContain('nonce')
    })

    it('does not authorise a nonce unless the wildcard was approved', () => {
      expect(new CspDirectiveMatcher('script-src', ["'self'"]).authorize(value("script-src 'nonce-abc123'")).authorized).toBe(false)
    })

    it('does not treat a malformed nonce-like token as a nonce', () => {
      expect(withNonce.authorize(value("script-src 'nonce-'")).authorized).toBe(false)
      expect(withNonce.authorize(value("script-src 'nonce-has spaces'")).authorized).toBe(false)
    })
  })

  describe('reporting surface', () => {
    it('describes itself by directive and source count', () => {
      expect(matcher().getDescription()).toBe('csp-directive:frame-src (4 allowed sources)')
      expect(new CspDirectiveMatcher('upgrade-insecure-requests', []).getDescription()).toBe('csp-directive:upgrade-insecure-requests (0 allowed sources)')
    })

    it('renders the canonical policy text it approves', () => {
      expect(matcher().getPattern()).toBe(`frame-src ${ALLOW.join(' ')}`)
    })

    it('exposes the directive and sources for the auditor report', () => {
      expect(matcher().getDirective()).toBe('frame-src')
      expect(matcher().getAllowedSources()).toEqual(ALLOW)
    })
  })
})
