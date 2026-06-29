/**
 * UrlMatcher Unit Tests
 *
 * Verifies that `UrlMatcher` matches the full `Matchable.url` against the
 * supplied regex and fails-secure when the URL is missing. Distinguishes
 * itself from `HostMatcher` by being sensitive to path / query.
 */

import type { SHA256Hash } from '../hash.js'
import type { Matchable } from './matcher.interface.js'
import { UrlMatcher } from './url-matcher.js'

const make = (url: string | undefined, name = 'res', content: string | null = 'c'): Matchable => ({
  name,
  content,
  hash: { value: 'h' } as SHA256Hash,
  ...(url !== undefined ? { url } : {}),
})

describe('UrlMatcher', () => {
  describe('getType / getPattern / getDescription', () => {
    it('returns the discriminator "url"', () => {
      expect(new UrlMatcher('^.*$').getType()).toBe('url')
    })

    it('exposes its pattern source', () => {
      // RegExp may escape forward slashes in the source string; match
      // loosely so the assertion survives engine differences.
      const pat = '^https://m\\.stripe\\.network/out-[0-9.]+\\.js$'
      expect(new UrlMatcher(pat).getPattern()).toMatch(/m\\\.stripe\\\.network/)
    })

    it('describes itself for logs', () => {
      const desc = new UrlMatcher('^https://cdn\\.example\\.com/.*$').getDescription()
      expect(desc).toMatch(/^url:\//)
      expect(desc).toMatch(/cdn\\\.example\\\.com/)
    })

    it('truncates long patterns in the description', () => {
      const longPattern = '^' + 'a'.repeat(80) + '$'
      const desc = new UrlMatcher(longPattern).getDescription()
      expect(desc.length).toBeLessThanOrEqual('url:/'.length + 50 + 1)
      expect(desc.endsWith('.../')).toBe(true)
    })
  })

  describe('identify', () => {
    it('matches an exact URL', () => {
      expect(new UrlMatcher('^https://cdn\\.example\\.com/script\\.js$').identify(make('https://cdn.example.com/script.js'))).toBe(true)
    })

    it('discriminates by path (unlike HostMatcher)', () => {
      const m = new UrlMatcher('^https://m\\.stripe\\.network/out-[0-9.]+\\.js$')
      expect(m.identify(make('https://m.stripe.network/out-4.5.45.js'))).toBe(true)
      expect(m.identify(make('https://m.stripe.network/something-else.js'))).toBe(false)
      expect(m.identify(make('https://m.stripe.network/'))).toBe(false)
    })

    it('returns false when url is undefined (fail-secure)', () => {
      expect(new UrlMatcher('^.*$').identify(make(undefined))).toBe(false)
    })

    it('returns false when url is empty / whitespace only', () => {
      expect(new UrlMatcher('^.*$').identify(make(''))).toBe(false)
      expect(new UrlMatcher('^.*$').identify(make('   '))).toBe(false)
    })
  })

  describe('authorize', () => {
    it('authorises a matching URL', () => {
      const result = new UrlMatcher('^https://cdn\\.example\\.com/.*$').authorize(make('https://cdn.example.com/script.js'))
      expect(result.authorized).toBe(true)
    })

    it('returns an unauthorised result with a useful reason for a mismatched URL', () => {
      const result = new UrlMatcher('^https://cdn\\.example\\.com/v[0-9]+\\.js$').authorize(make('https://cdn.example.com/internal.js'))
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('does not match pattern')
      expect(result.reason).toContain('https://cdn.example.com/internal.js')
    })

    it('returns unauthorised when url is missing (fail-secure)', () => {
      const result = new UrlMatcher('^.*$').authorize(make(undefined))
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('url is missing or empty')
    })

    it('includes authorisationInfo in metadataPath when supplied', () => {
      const matcher = new UrlMatcher('^https://cdn\\.example\\.com/.*$', {
        description: 'First-party CDN URL',
        authorised: true,
        date: new Date('2026-05-19'),
      })
      const result = matcher.authorize(make('https://cdn.example.com/x.js'))
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toEqual([{ description: 'First-party CDN URL', authorised: true, date: new Date('2026-05-19') }])
    })
  })
})
