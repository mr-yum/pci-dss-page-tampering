/**
 * HostMatcher Unit Tests
 *
 * Covers identify/authorize semantics, fail-secure behaviour when `host` is
 * missing/empty, regex flexibility (wildcards, subdomains), and the metadata
 * path emitted when `authorisationInfo` is supplied.
 */

import type { SHA256Hash } from '../hash'
import { HostMatcher } from './host-matcher'
import type { Matchable } from './matcher.interface'

const make = (host: string | undefined, name = 'res', content: string | null = 'c'): Matchable => ({
  name,
  content,
  hash: { value: 'h' } as SHA256Hash,
  ...(host !== undefined ? { host } : {}),
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
    it('matches an exact host', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').identify(make('cdn.example.com'))).toBe(true)
    })

    it('matches a subdomain wildcard', () => {
      const m = new HostMatcher('^[^.]+\\.meandu\\.app$')
      expect(m.identify(make('staging.meandu.app'))).toBe(true)
      expect(m.identify(make('app.meandu.app'))).toBe(true)
    })

    it('does not match a different host', () => {
      expect(new HostMatcher('^cdn\\.example\\.com$').identify(make('attacker.example.com'))).toBe(false)
    })

    it('returns false when host is undefined (fail-secure for inline scripts)', () => {
      expect(new HostMatcher('^.*$').identify(make(undefined))).toBe(false)
    })

    it('returns false when host is empty / whitespace only', () => {
      expect(new HostMatcher('^.*$').identify(make(''))).toBe(false)
      expect(new HostMatcher('^.*$').identify(make('   '))).toBe(false)
    })
  })

  describe('authorize', () => {
    it('authorises a matching host', () => {
      const result = new HostMatcher('^cdn\\.example\\.com$').authorize(make('cdn.example.com'))
      expect(result.authorized).toBe(true)
    })

    it('returns an unauthorised result with a useful reason for a mismatched host', () => {
      const result = new HostMatcher('^cdn\\.example\\.com$').authorize(make('attacker.example.com'))
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('host does not match pattern')
      expect(result.reason).toContain('cdn\\.example\\.com')
    })

    it('returns unauthorised when host is missing (fail-secure)', () => {
      const result = new HostMatcher('^.*$').authorize(make(undefined))
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('host is null or empty')
    })

    it('includes authorisationInfo in metadataPath when supplied', () => {
      const matcher = new HostMatcher('^cdn\\.example\\.com$', {
        description: 'First-party CDN',
        authorised: true,
        date: new Date('2026-05-13'),
      })
      const result = matcher.authorize(make('cdn.example.com'))
      expect(result.authorized).toBe(true)
      expect(result.metadataPath).toEqual([{ description: 'First-party CDN', authorised: true, date: new Date('2026-05-13') }])
    })
  })
})
