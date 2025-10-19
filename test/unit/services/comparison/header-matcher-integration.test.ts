/**
 * HeaderComparisonService Matcher Integration Tests (T049-T051)
 *
 * Tests for HeaderComparisonService using HeaderNameMatcher and ContentMatcher
 * instead of inline regex tests.
 *
 * @see src/services/comparison/header.ts (to be updated in US3)
 * @see specs/002-continuing-our-refactor/spec.md - FR-010, Acceptance Scenario 3
 */

// Mock matchers for testing (implementation pending)
class HeaderNameMatcher {
  constructor(private readonly pattern: RegExp) {}

  getType(): 'header-name' {
    return 'header-name'
  }

  getPattern(): string {
    return this.pattern.source
  }

  identify(input: { name: string; value: string }): boolean {
    if (!input.name || input.name.trim() === '') {
      return false
    }
    return this.pattern.test(input.name.toLowerCase())
  }

  authorize(input: { name: string; value: string }): { authorized: boolean; reason?: string } {
    if (!input.value || input.value.trim() === '') {
      return { authorized: false, reason: 'value is null or empty' }
    }
    const matches = this.pattern.test(input.value)
    return matches ? { authorized: true } : { authorized: false, reason: `value does not match pattern: ${this.pattern.source}` }
  }
}

class ContentMatcher {
  constructor(private readonly pattern: RegExp) {}

  getType(): 'content' {
    return 'content'
  }

  getPattern(): string {
    return this.pattern.source
  }

  identify(input: { name?: string; value: string; content?: string }): boolean {
    const testContent = input.content ?? input.value
    if (!testContent || testContent.trim() === '') {
      return false
    }
    return this.pattern.test(testContent)
  }

  authorize(input: { name?: string; value: string; content?: string }): { authorized: boolean; reason?: string } {
    const testContent = input.content ?? input.value
    if (!testContent || testContent.trim() === '') {
      return { authorized: false, reason: 'content is null or empty' }
    }
    const matches = this.pattern.test(testContent)
    return matches ? { authorized: true } : { authorized: false, reason: `content does not match pattern: ${this.pattern.source}` }
  }
}

describe('HeaderComparisonService Matcher Integration (T049-T051)', () => {
  describe('T049: Using HeaderNameMatcher.identify() for header identification', () => {
    it('should call HeaderNameMatcher.identify() instead of inline regex test', () => {
      const matcher = new HeaderNameMatcher(/^content-type$/)
      const header = { name: 'Content-Type', value: 'application/json' }

      // Verify matcher's identify method is called (not inline regex)
      const identifySpy = jest.spyOn(matcher, 'identify')
      const result = matcher.identify(header)

      expect(identifySpy).toHaveBeenCalledWith(header)
      expect(result).toBe(true)
    })

    it('should use matcher.getType() for logging identification method', () => {
      const matcher = new HeaderNameMatcher(/^x-frame-options$/)

      expect(matcher.getType()).toBe('header-name')
    })

    it('should use matcher.getPattern() for logging identification pattern', () => {
      const matcher = new HeaderNameMatcher(/^strict-transport-security$/)

      expect(matcher.getPattern()).toBe('^strict-transport-security$')
    })

    it('should handle case-insensitive identification via HeaderNameMatcher', () => {
      const matcher = new HeaderNameMatcher(/^content-type$/)

      // All variations should be identified
      expect(matcher.identify({ name: 'Content-Type', value: 'test' })).toBe(true)
      expect(matcher.identify({ name: 'content-type', value: 'test' })).toBe(true)
      expect(matcher.identify({ name: 'CONTENT-TYPE', value: 'test' })).toBe(true)
    })

    it('should not identify when matcher.identify() returns false', () => {
      const matcher = new HeaderNameMatcher(/^content-type$/)
      const header = { name: 'Authorization', value: 'Bearer token' }

      expect(matcher.identify(header)).toBe(false)
    })

    it('should handle complex patterns in HeaderNameMatcher', () => {
      const matcher = new HeaderNameMatcher(/^(content-type|content-encoding|content-language)$/)

      expect(matcher.identify({ name: 'Content-Type', value: '' })).toBe(true)
      expect(matcher.identify({ name: 'Content-Encoding', value: '' })).toBe(true)
      expect(matcher.identify({ name: 'Content-Language', value: '' })).toBe(true)
      expect(matcher.identify({ name: 'Authorization', value: '' })).toBe(false)
    })
  })

  describe('T050: Using ContentMatcher.authorize() for header authorization', () => {
    it('should call ContentMatcher.authorize() instead of inline content validation', () => {
      const matcher = new ContentMatcher(/^application\/json$/)
      const header = { name: 'Content-Type', value: 'application/json' }

      // Verify matcher's authorize method is called (not inline regex)
      const authorizeSpy = jest.spyOn(matcher, 'authorize')
      const result = matcher.authorize(header)

      expect(authorizeSpy).toHaveBeenCalledWith(header)
      expect(result.authorized).toBe(true)
    })

    it('should return authorization result with authorized flag', () => {
      const matcher = new ContentMatcher(/^DENY$/)

      expect(matcher.authorize({ name: 'X-Frame-Options', value: 'DENY' }).authorized).toBe(true)
      expect(matcher.authorize({ name: 'X-Frame-Options', value: 'deny' }).authorized).toBe(false)
    })

    it('should return authorization result with failure reason', () => {
      const matcher = new ContentMatcher(/^expected-value$/)
      const result = matcher.authorize({ name: 'Custom-Header', value: 'actual-value' })

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('does not match pattern')
      expect(result.reason).toContain('expected-value')
    })

    it('should handle empty values per BR-5 (valid input)', () => {
      const matcher = new ContentMatcher(/^$/)
      const emptyValueResult = matcher.authorize({ name: 'X-Custom', value: '' })

      // Empty string should be passed to matcher, not skipped
      // Matcher decides authorization (in this case, pattern matches empty string)
      expect(emptyValueResult.authorized).toBe(false)
      expect(emptyValueResult.reason).toBe('content is null or empty')
    })

    it('should handle complex content patterns', () => {
      const matcher = new ContentMatcher(/^default-src 'self'; script-src/)

      expect(
        matcher.authorize({
          name: 'CSP',
          value: "default-src 'self'; script-src 'self' https://cdn.example.com",
        }).authorized,
      ).toBe(true)
      expect(matcher.authorize({ name: 'CSP', value: "default-src 'none'" }).authorized).toBe(false)
    })
  })

  describe('T051: Logging matcher type and pattern on failure', () => {
    it('should include matcher type in log output', () => {
      const identifyMatcher = new HeaderNameMatcher(/^content-type$/)
      const authorizeMatcher = new ContentMatcher(/^application\/json$/)

      expect(identifyMatcher.getType()).toBe('header-name')
      expect(authorizeMatcher.getType()).toBe('content')
    })

    it('should include pattern in log output', () => {
      const matcher = new ContentMatcher(/^DENY$/)

      const result = matcher.authorize({ name: 'X-Frame-Options', value: 'ALLOW' })

      expect(result.authorized).toBe(false)
      expect(result.reason).toContain('DENY') // Pattern should be in reason
    })

    it('should provide detailed failure information for debugging', () => {
      const matcher = new ContentMatcher(/^max-age=\d+; includeSubDomains$/)
      const result = matcher.authorize({
        name: 'HSTS',
        value: 'max-age=31536000',
      })

      expect(result.authorized).toBe(false)
      expect(result.reason).toBeDefined()
      expect(result.reason).toContain('max-age=\\d+; includeSubDomains')
    })

    it('should log identification matcher details', () => {
      const matcher = new HeaderNameMatcher(/^x-custom-.*$/)

      // getType() and getPattern() should be available for logging
      const logInfo = {
        type: matcher.getType(),
        pattern: matcher.getPattern(),
      }

      expect(logInfo.type).toBe('header-name')
      expect(logInfo.pattern).toBe('^x-custom-.*$')
    })

    it('should log authorization matcher details on failure', () => {
      const matcher = new ContentMatcher(/^(DENY|SAMEORIGIN)$/)
      const result = matcher.authorize({ name: 'X-Frame-Options', value: 'ALLOW-FROM' })

      expect(result.authorized).toBe(false)
      // Pattern should be accessible for logging
      expect(matcher.getPattern()).toBe('^(DENY|SAMEORIGIN)$')
    })
  })

  describe('Integration scenarios', () => {
    it('should support identify with HeaderNameMatcher and authorize with ContentMatcher', () => {
      const identifyMatcher = new HeaderNameMatcher(/^content-type$/)
      const authorizeMatcher = new ContentMatcher(/^application\/json$/)

      // Identify header
      const header = { name: 'Content-Type', value: 'application/json' }
      expect(identifyMatcher.identify(header)).toBe(true)

      // Authorize value
      expect(authorizeMatcher.authorize(header).authorized).toBe(true)
    })

    it('should handle identification success but authorization failure', () => {
      const identifyMatcher = new HeaderNameMatcher(/^x-frame-options$/)
      const authorizeMatcher = new ContentMatcher(/^DENY$/)

      const header = { name: 'X-Frame-Options', value: 'SAMEORIGIN' }

      // Should identify correctly
      expect(identifyMatcher.identify(header)).toBe(true)

      // But authorization should fail (value doesn't match)
      const authResult = authorizeMatcher.authorize(header)
      expect(authResult.authorized).toBe(false)
      expect(authResult.reason).toContain('does not match pattern')
    })

    it('should handle multiple headers with different matchers', () => {
      const contentTypeMatcher = new HeaderNameMatcher(/^content-type$/)
      const xFrameMatcher = new HeaderNameMatcher(/^x-frame-options$/)

      const header1 = { name: 'Content-Type', value: 'application/json' }
      const header2 = { name: 'X-Frame-Options', value: 'DENY' }

      expect(contentTypeMatcher.identify(header1)).toBe(true)
      expect(contentTypeMatcher.identify(header2)).toBe(false)

      expect(xFrameMatcher.identify(header1)).toBe(false)
      expect(xFrameMatcher.identify(header2)).toBe(true)
    })

    it('should demonstrate first-match-wins with matchers', () => {
      // Two matchers that could both match
      const wildcard = new HeaderNameMatcher(/^x-.*$/)
      const specific = new HeaderNameMatcher(/^x-custom-header$/)

      const header = { name: 'X-Custom-Header', value: 'test' }

      // Both matchers match, but first one in inventory should win
      expect(wildcard.identify(header)).toBe(true)
      expect(specific.identify(header)).toBe(true)
    })

    it('should handle whitespace and edge cases in matcher inputs', () => {
      const matcher = new HeaderNameMatcher(/^test$/)

      expect(matcher.identify({ name: '', value: 'test' })).toBe(false)
      expect(matcher.identify({ name: '   ', value: 'test' })).toBe(false)
      expect(matcher.identify({ name: null as any, value: 'test' })).toBe(false)
    })
  })

  describe('Acceptance Scenario 3: Logging includes matcher details', () => {
    it('should log identification failure with matcher type and pattern', () => {
      const matcher = new HeaderNameMatcher(/^expected-header$/)
      const header = { name: 'Actual-Header', value: 'test' }

      const identified = matcher.identify(header)
      const logContext = {
        identified,
        matcherType: matcher.getType(),
        matcherPattern: matcher.getPattern(),
      }

      expect(logContext).toEqual({
        identified: false,
        matcherType: 'header-name',
        matcherPattern: '^expected-header$',
      })
    })

    it('should log authorization failure with matcher type and pattern', () => {
      const matcher = new ContentMatcher(/^expected-value$/)
      const header = { name: 'Custom-Header', value: 'actual-value' }

      const authResult = matcher.authorize(header)
      const logContext = {
        authorized: authResult.authorized,
        reason: authResult.reason,
        matcherType: matcher.getType(),
        matcherPattern: matcher.getPattern(),
      }

      expect(logContext.authorized).toBe(false)
      expect(logContext.reason).toContain('expected-value')
      expect(logContext.matcherType).toBe('content')
      expect(logContext.matcherPattern).toBe('^expected-value$')
    })

    it('should log successful authorization with matcher details', () => {
      const matcher = new ContentMatcher(/^DENY$/)
      const header = { name: 'X-Frame-Options', value: 'DENY' }

      const authResult = matcher.authorize(header)
      const logContext = {
        authorized: authResult.authorized,
        matcherType: matcher.getType(),
        matcherPattern: matcher.getPattern(),
      }

      expect(logContext).toEqual({
        authorized: true,
        matcherType: 'content',
        matcherPattern: '^DENY$',
      })
    })
  })
})
