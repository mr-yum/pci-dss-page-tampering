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

import { processAuthorizeWith } from '../inventory/zod.js'
import { AndMatcher } from './and-matcher.js'
import { CSP_ANY_NONCE, CspDirectiveMatcher } from './csp-directive-matcher.js'
import type { AuthorisationInfo, Matchable } from './matcher.interface.js'
import { OrMatcher } from './or-matcher.js'
import { UrlMatcher } from './url-matcher.js'

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

  describe('naming what moved when no alternative identifies the value', () => {
    // identify() is as strict as authorize(), and OrMatcher picks an
    // alternative by identify(), so an entry approving several variants of a
    // directive used to deny any change with the bare "No child matcher
    // identified the resource" — the alert never said which source moved.
    const APPROVED: AuthorisationInfo = { description: 'approved', authorised: true, date: new Date('2026-10-01T00:00:00.000Z') }
    const PENDING: AuthorisationInfo = { description: 'pending', authorised: false, date: new Date('2026-10-01T00:00:00.000Z') }
    const IMG = ["'self'", 'blob:', 'data:', 'https:', 'https://assets.example.net']
    const img = (allow: readonly string[], info: AuthorisationInfo | undefined = APPROVED) => new CspDirectiveMatcher('img-src', allow, info)
    const at = (url: string, content: string): Matchable => ({ name: 'content-security-policy', content, url })

    it('names the nearest approved alternative and the source it lost, without changing the verdict', () => {
      const or = new OrMatcher([matcher(ALLOW, APPROVED), img([...IMG, 'https://storage.example.org']), img(["'self'", 'https://storage.example.org'])])

      const result = or.authorize(value(`img-src ${IMG.join(' ')}`))

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('No child matcher identified the resource; nearest approved alternative (2 of 3): img-src differs from the approved policy: 1 approved source no longer present: https://storage.example.org')
    })

    it('picks the alternative with the fewest differences, and the first of a tie', () => {
      const or = new OrMatcher([img(["'self'"]), img([...IMG, 'https://a.example.org']), img([...IMG, 'https://b.example.org'])])

      expect(or.authorize(value(`img-src ${IMG.join(' ')}`)).reason).toContain('(2 of 3): img-src differs from the approved policy: 1 approved source no longer present: https://a.example.org')
    })

    it('names an added source', () => {
      const or = new OrMatcher([img(IMG), img(["'self'"])])

      expect(or.authorize(value(`img-src ${IMG.join(' ')} https://evil.example.test`)).reason).toContain('(1 of 2): img-src differs from the approved policy: 1 added source: https://evil.example.test')
    })

    it('never compares against an alternative that is pending or declined', () => {
      const or = new OrMatcher([img([...IMG, 'https://storage.example.org'], PENDING), img(["'self'"])])

      expect(or.authorize(value(`img-src ${IMG.join(' ')}`)).reason).toContain('(2 of 2): img-src differs from the approved policy: 4 added sources: blob: data: https: https://assets.example.net')
      expect(new OrMatcher([img(IMG, PENDING)]).authorize(value("img-src 'self'")).reason).toBe('No child matcher identified the resource')
    })

    it('never compares against another directive', () => {
      expect(new OrMatcher([matcher(ALLOW, APPROVED)]).authorize(value(`img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
    })

    it("compares against a route-scoped alternative only on that alternative's route", () => {
      // Each CSP tier is its own alternative: comparing a checkout response
      // with the default tier's sources would name the wrong differences.
      const defaultTier = new AndMatcher([new UrlMatcher('^https://shop\\.example\\.com/(?!checkout)'), img([...IMG, 'https://ads.example.net'])], APPROVED)
      const checkoutTier = new AndMatcher([new UrlMatcher('^https://shop\\.example\\.com/checkout'), img(["'self'", 'https://assets.example.net'])], APPROVED)
      const or = new OrMatcher([defaultTier, checkoutTier])
      const observed = `img-src ${IMG.join(' ')}`

      expect(or.authorize(at('https://shop.example.com/checkout?return=%2F', observed)).reason).toBe(
        'No child matcher identified the resource; nearest approved alternative (2 of 2): img-src differs from the approved policy: 3 added sources: blob: data: https:',
      )
      expect(or.authorize(at('https://shop.example.com/menu', observed)).reason).toContain('(1 of 2): img-src differs from the approved policy: 1 approved source no longer present: https://ads.example.net')
      expect(or.authorize(at('https://elsewhere.example.com/', observed)).reason).toBe('No child matcher identified the resource')
    })

    it('never compares against a scoped alternative whose own scoping conjunct is declined', () => {
      const declinedScope = new AndMatcher([new UrlMatcher('^https://shop\\.example\\.com/', PENDING), img([...IMG, 'https://storage.example.org'])], APPROVED)

      expect(new OrMatcher([declinedScope]).authorize(at('https://shop.example.com/', `img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
    })

    it('never compares against a scoped alternative whose scope is declined further down', () => {
      // identify() ignores authorisationInfo, so the nested OR identifies
      // through its pending /pay leaf; with the sources restored, this tier
      // still denies on /pay, so it is no approved alternative there.
      const scope = new OrMatcher([new UrlMatcher('^https://shop\\.example\\.com/checkout', APPROVED), new UrlMatcher('^https://shop\\.example\\.com/pay', PENDING)])
      const tier = new AndMatcher([scope, img([...IMG, 'https://storage.example.org'])], APPROVED)
      const or = new OrMatcher([tier])

      expect(or.authorize(at('https://shop.example.com/pay', `img-src ${IMG.join(' ')} https://storage.example.org`)).authorized).toBe(false)
      expect(or.authorize(at('https://shop.example.com/pay', `img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
      expect(or.authorize(at('https://shop.example.com/checkout', `img-src ${IMG.join(' ')}`)).reason).toContain('(1 of 1): img-src differs from the approved policy: 1 approved source no longer present: https://storage.example.org')
    })

    it('never compares against a scoped alternative that is itself pending or declined', () => {
      const pendingTier = new AndMatcher([new UrlMatcher('^https://shop\\.example\\.com/'), img([...IMG, 'https://storage.example.org'])], PENDING)

      expect(new OrMatcher([pendingTier]).authorize(at('https://shop.example.com/', `img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
    })

    it('reaches through a nested OR', () => {
      const or = new OrMatcher([matcher(ALLOW, APPROVED), new OrMatcher([img(["'self'"]), img([...IMG, 'https://storage.example.org'])], APPROVED)])

      expect(or.authorize(value(`img-src ${IMG.join(' ')}`)).reason).toContain('(2 of 2): img-src differs from the approved policy: 1 approved source no longer present: https://storage.example.org')
    })

    it('names no alternative when the OR itself is pending or declined', () => {
      const or = new OrMatcher([img([...IMG, 'https://storage.example.org'])], PENDING)

      expect(or.authorize(value(`img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
    })

    it('never reaches through a nested OR that is pending or declined', () => {
      const or = new OrMatcher([matcher(ALLOW, APPROVED), new OrMatcher([img([...IMG, 'https://storage.example.org'])], PENDING)])

      expect(or.authorize(value(`img-src ${IMG.join(' ')}`)).reason).toBe('No child matcher identified the resource')
    })

    it('counts a nonce difference', () => {
      const withNonce = new CspDirectiveMatcher('script-src', ["'self'", CSP_ANY_NONCE], APPROVED)

      expect(withNonce.explainMiss(value("script-src 'self'"))).toEqual({ distance: 1, reason: 'script-src differs from the approved policy: expected 1 nonce source but found 0' })
      expect(withNonce.explainMiss(value("script-src 'self' 'nonce-abc123'"))).toBeUndefined()
    })

    it('says the same thing through the inventory array syntax', () => {
      // One host, a frame-src and two img-src variants, the app dropping its
      // storage origin from img-src.
      const authoriseWith = processAuthorizeWith([
        { cspDirectiveMatcher: { directive: 'frame-src', allow: ["'self'", 'https://js.stripe.com'] }, authorisationInfo: { description: 'frame-src', authorised: true, date: '2026-08-07T00:00:00.000Z' } },
        { cspDirectiveMatcher: { directive: 'img-src', allow: [...IMG, 'https://storage.example.org'] }, authorisationInfo: { description: 'img-src', authorised: true, date: '2026-08-07T00:00:00.000Z' } },
        {
          cspDirectiveMatcher: { directive: 'img-src', allow: ["'self'", 'blob:', 'data:', 'https:', 'https://storage.example.org'] },
          authorisationInfo: { description: 'img-src, older', authorised: true, date: '2026-08-07T00:00:00.000Z' },
        },
      ] as never)

      const result = authoriseWith.matcher.authorize(at('https://shop.example.com/checkout?return=%2F', `img-src 'self' data: blob: https: https://assets.example.net`))

      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('No child matcher identified the resource; nearest approved alternative (2 of 3): img-src differs from the approved policy: 1 approved source no longer present: https://storage.example.org')
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
