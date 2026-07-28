/**
 * HostMatcher Unit Tests
 *
 * Verifies that `HostMatcher` derives the host from `Matchable.url`,
 * matches it against the regex pattern, and fails-secure when the URL is
 * missing or unparseable. Each test populates the `url` field — never `host`
 * — because `host` is no longer part of the Matchable contract.
 */

import type { SHA256Hash } from '../hash.js'
import { HostMatcher } from './host-matcher.js'
import type { Matchable } from './matcher.interface.js'

const make = (url: string | undefined, name = 'res', content: string | null = 'c'): Matchable => ({
  name,
  content,
  hash: { value: 'h' } as SHA256Hash,
  ...(url !== undefined ? { url } : {}),
})

describe('HostMatcher', () => {
  describe('getType / getPattern / getDescription', () => {
    it('returns the discriminator "host"', () => {
      expect(new HostMatcher('^.*$').getType()).toBe('host')
    })

    it('exposes its pattern source', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').getPattern()).toBe('^cdn\\.example\\.com$')
    })

    it('describes itself for logs', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').getDescription()).toBe('host:/^cdn\\.example\\.com$/')
    })

    it('truncates long patterns in the description', () => {
      const longPattern = '^' + 'a'.repeat(80) + '$'
      const desc = new HostMatcher(longPattern).getDescription()
      expect(desc.length).toBeLessThanOrEqual('host:/'.length + 50 + 1)
      expect(desc.endsWith('.../')).toBe(true)
    })
  })

  describe('identify', () => {
    it('matches the host of a full URL', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').identify(make('https://cdn.example.com/script.js'))).toBe(true)
    })

    it('ignores the URL path when matching', () => {
      const m = new HostMatcher('^cdn\\.example\\.com$')
      expect(m.identify(make('https://cdn.example.com/v1/foo.js?x=1'))).toBe(true)
      expect(m.identify(make('https://cdn.example.com/'))).toBe(true)
    })

    it('matches a subdomain wildcard', () => {
      const m = new HostMatcher('^([^.]+\\.)*checkout\\.example$')
      expect(m.identify(make('https://staging.checkout.example/x'))).toBe(true)
      expect(m.identify(make('https://app.checkout.example/'))).toBe(true)
      expect(m.identify(make('https://checkout.example/'))).toBe(true)
    })

    it('does not match a different host', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').identify(make('https://attacker.example.com/a.js'))).toBe(false)
    })

    it('returns false when url is undefined (fail-secure for hand-crafted fixtures)', () => {
      expect(new HostMatcher('^.*$').identify(make(undefined))).toBe(false)
    })

    it('returns false when url is empty / whitespace only', () => {
      expect(new HostMatcher('^.*$').identify(make(''))).toBe(false)
      expect(new HostMatcher('^.*$').identify(make('   '))).toBe(false)
    })

    it('returns false when url is unparseable', () => {
      expect(new HostMatcher('^.*$').identify(make('not a url'))).toBe(false)
    })
  })

  describe('authorize', () => {
    it('authorises a matching host', () => {
      const result = new HostMatcher('^cdn\\.example\\.com$').authorize(make('https://cdn.example.com/script.js'))
      expect(result.authorized).toBe(true)
    })

    it('returns an unauthorised result with a useful reason for a mismatched host', () => {
      const result = new HostMatcher('^cdn\\.example\\.com$').authorize(make('https://attacker.example.com/a.js'))
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('host')
      expect(result.reason).toContain('attacker.example.com')
      expect(result.reason).toContain('cdn\\.example\\.com')
    })

    it('returns unauthorised when url is missing (fail-secure)', () => {
      const result = new HostMatcher('^.*$').authorize(make(undefined))
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('url is missing or unparseable')
    })

    it('returns unauthorised when url is unparseable (fail-secure)', () => {
      const result = new HostMatcher('^.*$').authorize(make('not a url'))
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('url is missing or unparseable')
    })

    it('includes authorisationInfo in metadataPath when supplied', () => {
      const matcher = new HostMatcher('^cdn\\.example\\.com$', {
        description: 'First-party CDN',
        authorised: true,
        date: new Date('2026-05-19'),
      })
      const result = matcher.authorize(make('https://cdn.example.com/x.js'))
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toEqual([{ description: 'First-party CDN', authorised: true, date: new Date('2026-05-19') }])
    })
  })
})
