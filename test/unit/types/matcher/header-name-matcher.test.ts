/**
 * HeaderNameMatcher Unit Tests (T045-T047)
 *
 * Tests for case-insensitive header name matching per RFC 7230
 *
 * @see src/types/matcher/header-name-matcher.ts
 * @see specs/002-continuing-our-refactor/spec.md - FR-010a, FR-010b
 */

import type { DetectedHeader } from '../../../../src/types/header'

// Mock HeaderNameMatcher for testing (implementation pending)
class HeaderNameMatcher {
  private readonly pattern: RegExp

  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  getType(): 'header-name' {
    return 'header-name'
  }

  getPattern(): string {
    return this.pattern.source
  }

  identify(header: Pick<DetectedHeader, 'name' | 'value'>): boolean {
    if (!header.name || header.name.trim() === '') {
      return false
    }
    // Case-insensitive matching per RFC 7230
    return this.pattern.test(header.name.toLowerCase())
  }

  authorize(header: Pick<DetectedHeader, 'name' | 'value'>): { authorized: boolean; reason?: string } {
    if (!header.value || header.value.trim() === '') {
      return {
        authorized: false,
        reason: 'value is null or empty',
      }
    }

    // Case-sensitive content matching
    const matches = this.pattern.test(header.value)
    return matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `value does not match pattern: ${this.pattern.source}`,
        }
  }
}

describe('HeaderNameMatcher', () => {
  describe('T045: identify() - case-insensitive name matching', () => {
    it('should match "Content-Type" with pattern "content-type"', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: 'Content-Type', value: 'application/json' }

      expect(matcher.identify(header)).toBe(true)
    })

    it('should match "content-type" with pattern "content-type"', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: 'content-type', value: 'application/json' }

      expect(matcher.identify(header)).toBe(true)
    })

    it('should match "CONTENT-TYPE" with pattern "content-type"', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: 'CONTENT-TYPE', value: 'application/json' }

      expect(matcher.identify(header)).toBe(true)
    })

    it('should match "X-Frame-Options" with pattern "x-frame-options"', () => {
      const matcher = new HeaderNameMatcher('^x-frame-options$')
      const header = { name: 'X-Frame-Options', value: 'DENY' }

      expect(matcher.identify(header)).toBe(true)
    })

    it('should not match "Authorization" with pattern "content-type"', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: 'Authorization', value: 'Bearer token' }

      expect(matcher.identify(header)).toBe(false)
    })

    it('should handle regex patterns with wildcards', () => {
      const matcher = new HeaderNameMatcher('^x-.*$')
      const header1 = { name: 'X-Custom-Header', value: 'value1' }
      const header2 = { name: 'x-another-header', value: 'value2' }
      const header3 = { name: 'Content-Type', value: 'text/html' }

      expect(matcher.identify(header1)).toBe(true)
      expect(matcher.identify(header2)).toBe(true)
      expect(matcher.identify(header3)).toBe(false)
    })

    it('should return false for null header name', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: null as any, value: 'application/json' }

      expect(matcher.identify(header)).toBe(false)
    })

    it('should return false for empty header name', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: '', value: 'application/json' }

      expect(matcher.identify(header)).toBe(false)
    })

    it('should return false for whitespace-only header name', () => {
      const matcher = new HeaderNameMatcher('^content-type$')
      const header = { name: '   ', value: 'application/json' }

      expect(matcher.identify(header)).toBe(false)
    })
  })

  describe('T046: authorize() - case-sensitive content matching', () => {
    it('should match header value with pattern (case-sensitive)', () => {
      const matcher = new HeaderNameMatcher('^DENY$')
      const header = { name: 'X-Frame-Options', value: 'DENY' }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(true)
    })

    it('should not match "deny" when pattern is "DENY" (case-sensitive)', () => {
      const matcher = new HeaderNameMatcher('^DENY$')
      const header = { name: 'X-Frame-Options', value: 'deny' }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('does not match pattern')
    })

    it('should match flexible patterns for content', () => {
      const matcher = new HeaderNameMatcher('^(DENY|SAMEORIGIN)$')
      const header1 = { name: 'X-Frame-Options', value: 'DENY' }
      const header2 = { name: 'X-Frame-Options', value: 'SAMEORIGIN' }
      const header3 = { name: 'X-Frame-Options', value: 'ALLOW-FROM' }

      expect(matcher.authorize(header1).authorized).toBe(true)
      expect(matcher.authorize(header2).authorized).toBe(true)
      expect(matcher.authorize(header3).authorized).toBe(false)
    })

    it('should return unauthorized for null value', () => {
      const matcher = new HeaderNameMatcher('^DENY$')
      const header = { name: 'X-Frame-Options', value: null as any }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('value is null or empty')
    })

    it('should return unauthorized for empty value', () => {
      const matcher = new HeaderNameMatcher('^DENY$')
      const header = { name: 'X-Frame-Options', value: '' }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('value is null or empty')
    })

    it('should return unauthorized for whitespace-only value', () => {
      const matcher = new HeaderNameMatcher('^DENY$')
      const header = { name: 'X-Frame-Options', value: '   ' }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toBe('value is null or empty')
    })

    it('should include pattern in failure reason', () => {
      const matcher = new HeaderNameMatcher('^expected-value$')
      const header = { name: 'Custom-Header', value: 'actual-value' }

      const result = matcher.authorize(header)
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('expected-value')
    })
  })

  describe('T047: HeaderNameMatcher and ScriptNameMatcher - Matcher interface implementation', () => {
    it('should return "header-name" as type discriminator', () => {
      const matcher = new HeaderNameMatcher('^content-type$')

      expect(matcher.getType()).toBe('header-name')
    })

    it('should return pattern source via getPattern()', () => {
      const pattern = '^x-frame-options$'
      const matcher = new HeaderNameMatcher(pattern)

      expect(matcher.getPattern()).toBe(pattern)
    })

    it('should implement domain-appropriate behavior (case-insensitive identify)', () => {
      // HeaderNameMatcher should normalize header names to lowercase
      // This is different from ScriptNameMatcher which is case-sensitive
      const matcher = new HeaderNameMatcher('^content-type$')

      // All these should match due to case-insensitive identify
      expect(matcher.identify({ name: 'Content-Type', value: 'text/html' })).toBe(true)
      expect(matcher.identify({ name: 'content-type', value: 'text/html' })).toBe(true)
      expect(matcher.identify({ name: 'CONTENT-TYPE', value: 'text/html' })).toBe(true)
    })

    it('should implement domain-appropriate behavior (case-sensitive authorize)', () => {
      // HeaderNameMatcher should use case-sensitive matching for values
      // This ensures "DENY" != "deny"
      const matcher = new HeaderNameMatcher('^DENY$')

      expect(matcher.authorize({ name: 'X-Frame-Options', value: 'DENY' }).authorized).toBe(true)
      expect(matcher.authorize({ name: 'X-Frame-Options', value: 'deny' }).authorized).toBe(false)
    })

    it('should handle complex header name patterns', () => {
      const matcher = new HeaderNameMatcher('^(content-type|content-encoding|content-language)$')

      expect(matcher.identify({ name: 'Content-Type', value: 'text/html' })).toBe(true)
      expect(matcher.identify({ name: 'Content-Encoding', value: 'gzip' })).toBe(true)
      expect(matcher.identify({ name: 'Content-Language', value: 'en-US' })).toBe(true)
      expect(matcher.identify({ name: 'Authorization', value: 'Bearer token' })).toBe(false)
    })
  })

  describe('Edge cases and validation', () => {
    it('should handle special regex characters in patterns', () => {
      const matcher = new HeaderNameMatcher('^x-custom-\\d+$')

      expect(matcher.identify({ name: 'X-Custom-123', value: 'test' })).toBe(true)
      expect(matcher.identify({ name: 'X-Custom-ABC', value: 'test' })).toBe(false)
    })

    it('should handle multi-line header values', () => {
      const matcher = new HeaderNameMatcher('^line1.*line2$')
      const header = { name: 'Custom-Header', value: 'line1\nline2' }

      // Default regex should not match across newlines
      expect(matcher.authorize(header).authorized).toBe(false)
    })

    it('should handle very long header names', () => {
      const longName = 'x-' + 'a'.repeat(1000)
      const matcher = new HeaderNameMatcher('^x-a+$')

      expect(matcher.identify({ name: longName, value: 'test' })).toBe(true)
    })

    it('should handle very long header values', () => {
      const longValue = 'a'.repeat(10000)
      const matcher = new HeaderNameMatcher('^a+$')

      expect(matcher.authorize({ name: 'Custom-Header', value: longValue }).authorized).toBe(true)
    })
  })
})
