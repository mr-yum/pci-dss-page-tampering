/**
 * NameMatcher Unit Tests
 *
 * Tests name-based script matching with regex patterns.
 * Covers exact URL match, wildcard patterns, non-matching URLs, and null/empty names.
 *
 * @see ../../../specs/001-refactor-script-identification/research.md (R7) for test strategy
 */

import { NameMatcher } from './name-matcher'
import type { DetectedScript } from './matcher.interface'
import type { SHA256Hash } from '../hash'

describe('NameMatcher', () => {
  const createDetectedScript = (name: string, content: string | null, hashValue: string = 'hash123'): DetectedScript => ({
    name,
    content,
    hash: { value: hashValue } as SHA256Hash,
  })

  describe('getType', () => {
    it('should return "name" as matcher type', () => {
      const matcher = new NameMatcher('.*')
      expect(matcher.getType()).toBe('name')
    })
  })

  describe('getPattern', () => {
    it('should return the regex pattern source', () => {
      const pattern = '^https://example\\.com/.*$'
      const matcher = new NameMatcher(pattern)
      // RegExp may escape forward slashes in the source
      const actualPattern = matcher.getPattern()
      expect(actualPattern).toMatch(/\^https.*example.*com.*\$/)
    })
  })

  describe('identify', () => {
    describe('exact URL match', () => {
      it('should match exact URL pattern', () => {
        const matcher = new NameMatcher('^https://example\\.com/script\\.js$')
        const script = createDetectedScript('https://example.com/script.js', 'content')

        expect(matcher.identify(script)).toBe(true)
      })

      it('should not match when URL differs', () => {
        const matcher = new NameMatcher('^https://example\\.com/script\\.js$')
        const script = createDetectedScript('https://example.com/other.js', 'content')

        expect(matcher.identify(script)).toBe(false)
      })
    })

    describe('wildcard patterns', () => {
      it('should match URL with dynamic query parameters', () => {
        const matcher = new NameMatcher('^https://hcaptcha\\.com/1/api\\.js\\?.*$')
        const script = createDetectedScript('https://hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaLoad', 'content')

        expect(matcher.identify(script)).toBe(true)
      })

      it('should match URL with versioned paths', () => {
        const matcher = new NameMatcher('^https://cdn\\.example\\.com/v[0-9]+/script\\.js$')
        const script1 = createDetectedScript('https://cdn.example.com/v1/script.js', 'content')
        const script2 = createDetectedScript('https://cdn.example.com/v123/script.js', 'content')

        expect(matcher.identify(script1)).toBe(true)
        expect(matcher.identify(script2)).toBe(true)
      })

      it('should match broad wildcard patterns', () => {
        const matcher = new NameMatcher('.*facebook.*')
        const script = createDetectedScript('https://www.facebook.net/signals/config/123456', 'content')

        expect(matcher.identify(script)).toBe(true)
      })
    })

    describe('non-matching URLs', () => {
      it('should not match when pattern does not match URL', () => {
        const matcher = new NameMatcher('^https://example\\.com/.*$')
        const script = createDetectedScript('https://other.com/script.js', 'content')

        expect(matcher.identify(script)).toBe(false)
      })
    })

    describe('null/empty names', () => {
      it('should return false for null script name', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('', 'content')

        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for empty script name', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('', 'content')

        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for whitespace-only script name', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('   ', 'content')

        expect(matcher.identify(script)).toBe(false)
      })
    })
  })

  describe('authorize', () => {
    describe('content matches pattern', () => {
      it('should authorize when content matches pattern', () => {
        const matcher = new NameMatcher('analytics')
        const script = createDetectedScript('https://example.com/script.js', 'analytics.track()')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })
    })

    describe('content does not match pattern', () => {
      it('should not authorize when content does not match pattern', () => {
        const matcher = new NameMatcher('analytics')
        const script = createDetectedScript('https://example.com/script.js', 'different.code()')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content does not match pattern: analytics')
      })
    })

    describe('null/empty content', () => {
      it('should not authorize when content is null', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('https://example.com/script.js', null)

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is empty string', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('https://example.com/script.js', '')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is whitespace-only', () => {
        const matcher = new NameMatcher('.*')
        const script = createDetectedScript('https://example.com/script.js', '   ')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })
    })
  })
})
