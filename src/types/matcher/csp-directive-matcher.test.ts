/**
 * Unit tests for the set-based CSP directive matcher.
 *
 * The contract is worth stating plainly: reordering passes, any change in set
 * membership fails. Removals are deliberately NOT tolerated — some CSP sources
 * only suppress others while present, so dropping one can widen the policy.
 * These tests exist to keep that from drifting back to "a subset is safer".
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
      expect(matcher().identify(value(`frame-src ${ALLOW.join(' ')}`))).toBe(true)
    })

    it('does not identify a value it would not authorise', () => {
      // OrMatcher consults only the first child that identifies, so a loose
      // identify would make sibling alternatives for the same directive
      // unreachable. Verified against production: three approved frame-src
      // variants, only the first ever consulted.
      expect(matcher().identify(value('frame-src https://anything.example.test'))).toBe(false)
      expect(matcher().identify(value("frame-src 'self'"))).toBe(false)
    })

    it('identifies an approved set in any order', () => {
      expect(matcher().identify(value(`frame-src ${[...ALLOW].reverse().join(' ')}`))).toBe(true)
    })

    it('is case-insensitive about the directive name, as CSP is', () => {
      expect(matcher().identify(value(`FRAME-SRC ${ALLOW.join(' ')}`))).toBe(true)
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

    it('flags a removed source, naming it', () => {
      const result = matcher().authorize(value("frame-src 'self' https://js.stripe.com https://hooks.stripe.com"))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('no longer present')
      expect(result.reason).toContain('https://m.stripe.network')
    })

    it('flags a directive stripped to nothing', () => {
      expect(matcher().authorize(value('frame-src')).authorized).toBe(false)
    })

    describe('removals that would widen the policy', () => {
      // The reason subset tolerance was removed: each of these is a real
      // weakening that a "fewer sources is safer" rule would wave through.
      it("flags a dropped nonce, which makes an approved 'unsafe-inline' live", () => {
        const withInline = new CspDirectiveMatcher('script-src', ["'self'", "'unsafe-inline'", CSP_ANY_NONCE])

        expect(withInline.authorize(value("script-src 'self' 'unsafe-inline'")).authorized).toBe(false)
      })

      it("flags a dropped 'strict-dynamic', which makes a scheme-source match every origin", () => {
        const strictDynamic = new CspDirectiveMatcher('script-src', ["'strict-dynamic'", CSP_ANY_NONCE, 'https:'])

        expect(strictDynamic.authorize(value('script-src https:')).authorized).toBe(false)
      })

      it('flags trusted-types enforcement being switched off', () => {
        const trustedTypes = new CspDirectiveMatcher('require-trusted-types-for', ["'script'"])

        expect(trustedTypes.authorize(value('require-trusted-types-for')).authorized).toBe(false)
      })
    })

    it('tolerates irregular whitespace and a trailing semicolon', () => {
      expect(matcher().authorize(value(`  frame-src    ${ALLOW.join('\t')} ;  `)).authorized).toBe(true)
    })

    it('refuses a source that is not approved, and names it as added', () => {
      const result = matcher().authorize(value(`frame-src ${ALLOW.join(' ')} https://evil.example.test`))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('added')
      expect(result.reason).toContain('https://evil.example.test')
    })

    it('names every unapproved source, not just the first', () => {
      const result = matcher().authorize(value(`frame-src ${ALLOW.join(' ')} https://a.example.test https://b.example.test`))

      expect(result.reason).toContain('https://a.example.test')
      expect(result.reason).toContain('https://b.example.test')
    })

    it('reports additions and removals separately, so the direction is clear', () => {
      const result = matcher().authorize(value("frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://new.example.test"))

      expect(result.reason).toContain('added')
      expect(result.reason).toContain('no longer present')
    })

    it('does not expand host wildcards, because the policy text is the subject', () => {
      // Approving `*.js.stripe.com` is a different assertion from approving a
      // specific host, and a change between them must be reported.
      const wildcard = new CspDirectiveMatcher('frame-src', ['https://*.js.stripe.com'])

      expect(wildcard.authorize(value('frame-src https://a.js.stripe.com')).authorized).toBe(false)
      expect(wildcard.authorize(value('frame-src https://*.js.stripe.com')).authorized).toBe(true)
    })

    it('compares sources case-sensitively', () => {
      const host = new CspDirectiveMatcher('frame-src', ['https://Example.test'])

      expect(host.authorize(value('frame-src https://Example.test')).authorized).toBe(true)
      expect(host.authorize(value('frame-src https://example.test')).authorized).toBe(false)
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

    const full = (nonces: string) => `script-src 'self' ${nonces} https://js.stripe.com`

    it('authorises any per-response nonce value', () => {
      // A nonce is regenerated every response, so pinning one would fail on the
      // next request. This is the only wildcard the matcher understands.
      expect(withNonce.authorize(value(full("'nonce-8i04cnq3xfOdYNQwZyf+Ng=='"))).authorized).toBe(true)
      expect(withNonce.authorize(value(full("'nonce-TgM16Gc9JJRcMFc2lCacwg=='"))).authorized).toBe(true)
      expect(withNonce.authorize(value(full("'nonce-sfBVKZu3LcjNmuHZK52PM5'"))).authorized).toBe(true)
    })

    it('is a placeholder for exactly one nonce, not a quantifier', () => {
      // An extra nonce is an extra script-execution channel.
      const result = withNonce.authorize(value(full("'nonce-aaa' 'nonce-bbb'")))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('expected 1 nonce source but found 2')
    })

    it('flags a missing nonce', () => {
      const result = withNonce.authorize(value(full('')))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('expected 1 nonce source but found 0')
    })

    it('still refuses any other added source alongside a nonce', () => {
      const result = withNonce.authorize(value(`${full("'nonce-abc123'")} 'unsafe-inline'`))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("'unsafe-inline'")
    })

    it('does not authorise a nonce unless the wildcard was approved', () => {
      expect(new CspDirectiveMatcher('script-src', ["'self'"]).authorize(value("script-src 'self' 'nonce-abc123'")).authorized).toBe(false)
    })

    it("rejects a literal 'nonce-*' token served by the page", () => {
      // The placeholder is inventory vocabulary, never a valid CSP source. A
      // page serving the literal token must not slide through membership.
      const result = withNonce.authorize(value(`${full("'nonce-real'")} 'nonce-*'`))

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("'nonce-*'")
    })

    it('does not treat a malformed nonce-like token as a nonce', () => {
      expect(withNonce.authorize(value(full("'nonce-'"))).authorized).toBe(false)
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
