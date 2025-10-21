/**
 * ContentMatcher Unit Tests
 *
 * Tests content-based script matching with regex patterns.
 * Covers exact content match, regex patterns, null/empty content, and multi-line content.
 *
 * @see ../../../specs/001-refactor-script-identification/research.md (R7) for test strategy
 */

import type { SHA256Hash } from '../hash'
import { ContentMatcher } from './content-matcher'
import type { DetectedScript } from './matcher.interface'

describe('ContentMatcher', () => {
  const createDetectedScript = (name: string, content: string | null, hashValue: string = 'hash123'): DetectedScript => ({
    name,
    content,
    hash: { value: hashValue } as SHA256Hash,
  })

  describe('getType', () => {
    it('should return "content" as matcher type', () => {
      const matcher = new ContentMatcher('.*')
      expect(matcher.getType()).toBe('content')
    })
  })

  describe('getPattern', () => {
    it('should return the regex pattern source', () => {
      const pattern = "fbq\\('init'"
      const matcher = new ContentMatcher(pattern)
      expect(matcher.getPattern()).toBe(pattern)
    })
  })

  describe('identify', () => {
    describe('exact content match', () => {
      it('should match exact content pattern', () => {
        const matcher = new ContentMatcher('__NEXT_DATA__')
        const script = createDetectedScript('inline-123', 'window.__NEXT_DATA__ = {}')

        expect(matcher.identify(script)).toBe(true)
      })

      it('should not match when content differs', () => {
        const matcher = new ContentMatcher('__NEXT_DATA__')
        const script = createDetectedScript('inline-123', 'window.__OTHER_DATA__ = {}')

        expect(matcher.identify(script)).toBe(false)
      })
    })

    describe('regex patterns', () => {
      it('should match content with partial regex match', () => {
        const matcher = new ContentMatcher("fbq\\('init'")
        const script = createDetectedScript('inline-facebook', "fbq('init', '1234567890'); fbq('track', 'PageView');")

        expect(matcher.identify(script)).toBe(true)
      })

      it('should match content with complex regex', () => {
        const matcher = new ContentMatcher('https://connect\\.facebook\\.net/en_US/fbevents\\.js')
        const script = createDetectedScript('inline-fb', "!function(f,b,e,v,n,t,s){...}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');")

        expect(matcher.identify(script)).toBe(true)
      })

      it('should support character class patterns', () => {
        const matcher = new ContentMatcher('a\\.src=[\'"]?/cdn-cgi/challenge-platform')
        const script = createDetectedScript('inline-cloudflare', "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'")

        expect(matcher.identify(script)).toBe(true)
      })
    })

    describe('multi-line content', () => {
      it('should match pattern across multiple lines', () => {
        const matcher = new ContentMatcher('track:')
        const script = createDetectedScript(
          'inline-analytics',
          `
            window.analytics = {
              track: function(event) {
                console.log(event)
              }
            }
          `,
        )

        expect(matcher.identify(script)).toBe(true)
      })
    })

    describe('null/empty content', () => {
      it('should return false for null content', () => {
        const matcher = new ContentMatcher('.*')
        const script = createDetectedScript('inline-123', null)

        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for empty content', () => {
        const matcher = new ContentMatcher('.*')
        const script = createDetectedScript('inline-123', '')

        expect(matcher.identify(script)).toBe(false)
      })

      it('should return false for whitespace-only content', () => {
        const matcher = new ContentMatcher('analytics')
        const script = createDetectedScript('inline-123', '   ')

        expect(matcher.identify(script)).toBe(false)
      })
    })

    describe('special regex characters', () => {
      it('should handle escaped special characters in content', () => {
        const matcher = new ContentMatcher('\\$\\(document\\)\\.ready')
        const script = createDetectedScript('inline-jquery', '$(document).ready(function() { })')

        expect(matcher.identify(script)).toBe(true)
      })
    })
  })

  describe('authorize', () => {
    describe('content matches pattern', () => {
      it('should authorize when content matches pattern', () => {
        const matcher = new ContentMatcher('analytics')
        const script = createDetectedScript('inline-123', 'analytics.track()')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })
    })

    describe('content does not match pattern', () => {
      it('should not authorize when content does not match pattern', () => {
        const matcher = new ContentMatcher('analytics')
        const script = createDetectedScript('inline-123', 'different.code()')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content does not match pattern: analytics')
      })
    })

    describe('null/empty content', () => {
      it('should not authorize when content is null', () => {
        const matcher = new ContentMatcher('.*')
        const script = createDetectedScript('inline-123', null)

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is empty string', () => {
        const matcher = new ContentMatcher('.*')
        const script = createDetectedScript('inline-123', '')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is whitespace-only', () => {
        const matcher = new ContentMatcher('.*')
        const script = createDetectedScript('inline-123', '   ')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })
    })
  })
})
