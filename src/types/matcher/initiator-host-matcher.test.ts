/**
 * InitiatorHostMatcher Unit Tests
 *
 * Verifies that `InitiatorHostMatcher` derives the host from
 * `Matchable.initiator` — never `url` — matches it against the regex
 * pattern, and fails secure when the initiator is missing or unparseable.
 * The supply-chain scenario it exists for: an entry composing it beside a
 * nameMatcher stops trusting an allow-listed URL the moment an unexpected
 * host loads it.
 */

import type { SHA256Hash } from '../hash.js'
import { AndMatcher } from './and-matcher.js'
import { InitiatorHostMatcher } from './initiator-host-matcher.js'
import type { AuthorisationInfo, Matchable } from './matcher.interface.js'
import { NameMatcher } from './name-matcher.js'
import { OrMatcher } from './or-matcher.js'

const make = (initiator: string | undefined, overrides: Partial<Matchable> = {}): Matchable => ({
  name: 'https://cdn.example.net/sdk.js',
  content: null,
  hash: { value: 'h' } as SHA256Hash,
  url: 'https://cdn.example.net/sdk.js',
  ...(initiator !== undefined ? { initiator } : {}),
  ...overrides,
})

describe('InitiatorHostMatcher', () => {
  describe('getType / getPattern / getDescription', () => {
    it('returns the discriminator "initiator-host"', () => {
      expect(new InitiatorHostMatcher('^.*$').getType()).toBe('initiator-host')
    })

    it('exposes its pattern source', () => {
      expect(new InitiatorHostMatcher('^pay\\.example\\.com$').getPattern()).toBe('^pay\\.example\\.com$')
    })

    it('describes itself for logs', () => {
      expect(new InitiatorHostMatcher('^pay\\.example\\.com$').getDescription()).toBe('initiator-host:/^pay\\.example\\.com$/')
    })
  })

  describe('identify', () => {
    it('matches the host of the initiator URL, not the script URL', () => {
      const m = new InitiatorHostMatcher('^pay\\.example\\.com$')
      expect(m.identify(make('https://pay.example.com/checkout'))).toBe(true)
      // The script's own URL host would NOT match this pattern — proof the
      // matcher reads initiator, not url.
      expect(m.identify(make('https://evil.example/loader.js'))).toBe(false)
    })

    it('ignores the initiator path when matching', () => {
      const m = new InitiatorHostMatcher('^pay\\.example\\.com$')
      expect(m.identify(make('https://pay.example.com/assets/main-abc123.js'))).toBe(true)
    })

    it('fails secure when the initiator is missing', () => {
      expect(new InitiatorHostMatcher('^.*$').identify(make(undefined))).toBe(false)
    })

    it('fails secure when the initiator is unparseable', () => {
      expect(new InitiatorHostMatcher('^.*$').identify(make('not a url'))).toBe(false)
    })

    it('fails secure when the initiator is whitespace', () => {
      expect(new InitiatorHostMatcher('^.*$').identify(make('   '))).toBe(false)
    })

    it('rejects a lookalike host — an anchored pattern must not match a suffix-spoofing domain', () => {
      const m = new InitiatorHostMatcher('^pay\\.example\\.com$')
      // Classic supply-chain spoofs: the trusted host as a subdomain label of
      // an attacker domain, and as an undelimited prefix.
      expect(m.identify(make('https://pay.example.com.evil.example/x.js'))).toBe(false)
      expect(m.identify(make('https://pay.example.com-evil.example/x.js'))).toBe(false)
      expect(m.identify(make('https://evilpay.example.com/x.js'))).toBe(false)
    })

    it('derives the host regardless of query string, fragment, credentials, or port in the initiator URL', () => {
      const m = new InitiatorHostMatcher('^pay\\.example\\.com$')
      expect(m.identify(make('https://pay.example.com/checkout?order=1&token=abc#step-2'))).toBe(true)
      expect(m.identify(make('https://user:pw@pay.example.com/path'))).toBe(true)
      // URL.host includes a non-default port — an anchored host pattern
      // deliberately does NOT match it (the author pins the exact host).
      expect(m.identify(make('https://pay.example.com:8443/path'))).toBe(false)
      expect(new InitiatorHostMatcher('^pay\\.example\\.com(:8443)?$').identify(make('https://pay.example.com:8443/path'))).toBe(true)
    })
  })

  describe('authorize', () => {
    it('authorises a matching initiator host', () => {
      expect(new InitiatorHostMatcher('^pay\\.example\\.com$').authorize(make('https://pay.example.com/'))).toEqual({ authorized: true })
    })

    it('denies with the host named when the initiator host does not match', () => {
      const result = new InitiatorHostMatcher('^pay\\.example\\.com$').authorize(make('https://evil.example/x.js'))
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("initiator host 'evil.example'")
    })

    it('fails secure with an explicit reason when the initiator is missing', () => {
      const result = new InitiatorHostMatcher('^.*$').authorize(make(undefined))
      expect(result).toEqual({ authorized: false, reason: 'initiator is missing or unparseable' })
    })

    it('carries authorisationInfo on the metadata path', () => {
      const info: AuthorisationInfo = { description: 'Loaded only by the checkout shell', authorised: true, date: new Date('2026-08-24T00:00:00.000Z') }
      const result = new InitiatorHostMatcher('^pay\\.example\\.com$', info).authorize(make('https://pay.example.com/'))
      expect(result.metadataPath).toEqual([info])
    })
  })

  describe('composition — the supply-chain scenario', () => {
    const entry = new AndMatcher([new NameMatcher('^https://cdn\\.example\\.net/sdk\\.js$'), new InitiatorHostMatcher('^pay\\.example\\.com$')])

    it('identifies the allow-listed URL when loaded by the expected host', () => {
      expect(entry.identify(make('https://pay.example.com/'))).toBe(true)
    })

    it('refuses the same URL loaded by an unexpected host', () => {
      expect(entry.identify(make('https://evil.example/injector.js'))).toBe(false)
    })

    it('refuses the same URL when attribution is absent (fail-secure through the composite)', () => {
      expect(entry.identify(make(undefined))).toBe(false)
    })

    it('delegates inside an OrMatcher like any other child', () => {
      const or = new OrMatcher([new InitiatorHostMatcher('^pay\\.example\\.com$'), new InitiatorHostMatcher('^admin\\.example\\.com$')])
      expect(or.identify(make('https://admin.example.com/console'))).toBe(true)
      expect(or.identify(make('https://evil.example/'))).toBe(false)
    })
  })

  describe('transitive form', () => {
    const chain = (...hops: [string, 'script' | 'document' | 'unknown'][]) => hops.map(([url, kind]) => ({ url, kind }))
    const loaded = (initiatorChain: ReturnType<typeof chain> | undefined, overrides: Partial<Matchable> = {}): Matchable =>
      make('https://assets.example.net/mid.js', { ...(initiatorChain !== undefined ? { initiatorChain } : {}), ...overrides })
    const vendorChain = chain(['https://assets.example.net/mid.js', 'script'], ['https://js.vendor.example/loader.js', 'script'], ['https://pay.example.com/checkout', 'document'])
    const transitive = (pattern: string, maxDepth?: number) => new InitiatorHostMatcher(pattern, undefined, { transitive: true, ...(maxDepth !== undefined ? { maxDepth } : {}) })

    it('matches a host anywhere up the chain, not only the immediate inserter', () => {
      expect(transitive('^js\\.vendor\\.example$').identify(loaded(vendorChain))).toBe(true)
      expect(transitive('^pay\\.example\\.com$').identify(loaded(vendorChain))).toBe(true)
      expect(transitive('^evil\\.example$').identify(loaded(vendorChain))).toBe(false)
    })

    it('reads the chain, not `initiator`', () => {
      expect(transitive('^js\\.vendor\\.example$').identify(loaded(undefined, { initiator: 'https://js.vendor.example/loader.js' }))).toBe(false)
    })

    it('looks no further than maxDepth hops', () => {
      expect(transitive('^js\\.vendor\\.example$', 1).identify(loaded(vendorChain))).toBe(false)
      expect(transitive('^js\\.vendor\\.example$', 2).identify(loaded(vendorChain))).toBe(true)
    })

    it('evaluates a chain ending in an unknown hop over its known prefix only', () => {
      const broken = chain(['https://assets.example.net/mid.js', 'script'], ['https://js.vendor.example/loader.js', 'unknown'], ['https://pay.example.com/checkout', 'document'])
      expect(transitive('^js\\.vendor\\.example$').identify(loaded(broken))).toBe(false)
      expect(transitive('^pay\\.example\\.com$').identify(loaded(broken))).toBe(false)
      expect(transitive('^assets\\.example\\.net$').identify(loaded(broken))).toBe(true)
    })

    it('skips inline hops (no host) and keeps walking through them', () => {
      const throughInline = chain(['inline_script/id_not_found#k-1', 'script'], ['https://js.vendor.example/loader.js', 'script'])
      expect(transitive('^js\\.vendor\\.example$').identify(loaded(throughInline))).toBe(true)
      expect(transitive('inline').identify(loaded(throughInline))).toBe(false)
    })

    it('matches on any recorded path when the walk forked', () => {
      const other = chain(['https://assets.example.net/mid.js', 'script'], ['https://cdn.example.org/tag.js', 'script'])
      expect(transitive('^cdn\\.example\\.org$').identify(loaded(vendorChain, { alternateInitiatorChains: [other] }))).toBe(true)
      expect(transitive('^cdn\\.example\\.org$').identify(loaded(vendorChain))).toBe(false)
    })

    it('fails secure on a missing or empty chain, saying so', () => {
      expect(transitive('.*').identify(loaded(undefined))).toBe(false)
      expect(transitive('.*').identify(loaded([]))).toBe(false)
      expect(transitive('.*').authorize(loaded(undefined))).toEqual({ authorized: false, reason: 'initiator chain is missing' })
    })

    it('names the chain in a denial', () => {
      const result = transitive('^evil\\.example$').authorize(loaded(vendorChain))
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('loaded by assets.example.net ← js.vendor.example ← page pay.example.com')
    })

    it('authorises on a match and carries its authorisationInfo', () => {
      const info: AuthorisationInfo = { description: 'Anything the vendor loads', authorised: true, date: new Date('2026-10-01T00:00:00.000Z') }
      expect(new InitiatorHostMatcher('^js\\.vendor\\.example$', info, { transitive: true }).authorize(loaded(vendorChain))).toEqual({ authorized: true, metadataPath: [info] })
    })

    it('describes and exposes itself so the entry serialises back to the object form', () => {
      expect(transitive('^x$', 3).getDescription()).toBe('initiator-host(transitive, ≤3 hops):/^x$/')
      expect(transitive('^x$', 3).getOptions()).toEqual({ transitive: true, maxDepth: 3 })
      expect(new InitiatorHostMatcher('^x$').getOptions()).toBeUndefined()
    })

    it('rejects a maxDepth outside 1..8 at construction', () => {
      expect(() => transitive('^x$', 0)).toThrow('maxDepth')
      expect(() => transitive('^x$', 9)).toThrow('maxDepth')
    })

    it('leaves the string form exactly as it was: the immediate initiator only', () => {
      const immediate = new InitiatorHostMatcher('^js\\.vendor\\.example$')
      expect(immediate.identify(loaded(vendorChain, { initiator: 'https://assets.example.net/mid.js' }))).toBe(false)
      expect(immediate.identify(loaded(vendorChain, { initiator: 'https://js.vendor.example/loader.js' }))).toBe(true)
    })
  })
})
