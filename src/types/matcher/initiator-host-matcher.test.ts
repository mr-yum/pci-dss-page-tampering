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
})
