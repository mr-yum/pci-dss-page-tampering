/**
 * Matcher Interface Compatibility Tests (T047 extension)
 *
 * Validates that HeaderNameMatcher and ScriptNameMatcher both implement
 * the Matcher interface with domain-appropriate behaviors.
 *
 * @see src/types/matcher/matcher.interface.ts
 * @see specs/002-continuing-our-refactor/spec.md - FR-010a, Acceptance Scenario 4
 */

import { NameMatcher } from '../../../../src/types/matcher/name-matcher'

// Mock HeaderNameMatcher (implementation pending)
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

  identify(input: { name: string; value: string }): boolean {
    if (!input.name || input.name.trim() === '') {
      return false
    }
    // Case-insensitive for headers
    return this.pattern.test(input.name.toLowerCase())
  }

  authorize(input: { name: string; value: string }): { authorized: boolean; reason?: string } {
    if (!input.value || input.value.trim() === '') {
      return {
        authorized: false,
        reason: 'value is null or empty',
      }
    }

    const matches = this.pattern.test(input.value)
    return matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `value does not match pattern: ${this.pattern.source}`,
        }
  }
}

describe('Matcher Interface Compatibility', () => {
  describe('T047: HeaderNameMatcher and ScriptNameMatcher both implement Matcher interface', () => {
    it('should have consistent method signatures', () => {
      const headerMatcher = new HeaderNameMatcher('^content-type$')
      const scriptMatcher = new NameMatcher('^https://example\\.com/script\\.js$')

      // Both should have getType()
      expect(typeof headerMatcher.getType).toBe('function')
      expect(typeof scriptMatcher.getType).toBe('function')

      // Both should have getPattern()
      expect(typeof headerMatcher.getPattern).toBe('function')
      expect(typeof scriptMatcher.getPattern).toBe('function')

      // Both should have identify()
      expect(typeof headerMatcher.identify).toBe('function')
      expect(typeof scriptMatcher.identify).toBe('function')

      // Both should have authorize()
      expect(typeof headerMatcher.authorize).toBe('function')
      expect(typeof scriptMatcher.authorize).toBe('function')
    })

    it('should return different type discriminators', () => {
      const headerMatcher = new HeaderNameMatcher('^content-type$')
      const scriptMatcher = new NameMatcher('^https://example\\.com/script\\.js$')

      expect(headerMatcher.getType()).toBe('header-name')
      expect(scriptMatcher.getType()).toBe('name')
      expect(headerMatcher.getType()).not.toBe(scriptMatcher.getType())
    })

    it('should return pattern strings from getPattern()', () => {
      const headerPattern = '^x-frame-options$'
      const scriptPattern = '^https://cdn\\.example\\.com/.*\\.js$'

      const headerMatcher = new HeaderNameMatcher(headerPattern)
      const scriptMatcher = new NameMatcher(scriptPattern)

      expect(headerMatcher.getPattern()).toBe(headerPattern)
      expect(scriptMatcher.getPattern()).toBe(scriptPattern)
    })

    it('should implement domain-appropriate identify() behavior', () => {
      // HeaderNameMatcher: case-insensitive header name matching
      const headerMatcher = new HeaderNameMatcher('^content-type$')
      expect(headerMatcher.identify({ name: 'Content-Type', value: '' })).toBe(true)
      expect(headerMatcher.identify({ name: 'CONTENT-TYPE', value: '' })).toBe(true)

      // ScriptNameMatcher: case-sensitive URL matching
      const scriptMatcher = new NameMatcher('^https://Example\\.com/Script\\.js$')
      expect(
        scriptMatcher.identify({
          name: 'https://Example.com/Script.js',
          content: '',
          hash: 'abc123' as any,
        }),
      ).toBe(true)
      expect(
        scriptMatcher.identify({
          name: 'https://example.com/script.js',
          content: '',
          hash: 'abc123' as any,
        }),
      ).toBe(false)
    })

    it('should implement domain-appropriate authorize() behavior', () => {
      // HeaderNameMatcher: case-sensitive value matching
      const headerMatcher = new HeaderNameMatcher('^DENY$')
      expect(headerMatcher.authorize({ name: 'X-Frame-Options', value: 'DENY' }).authorized).toBe(true)
      expect(headerMatcher.authorize({ name: 'X-Frame-Options', value: 'deny' }).authorized).toBe(false)

      // ScriptNameMatcher: case-sensitive content matching
      const scriptMatcher = new NameMatcher('^function DoSomething')
      expect(
        scriptMatcher.authorize({
          name: 'inline-script-1',
          content: 'function DoSomething() {}',
          hash: 'abc123' as any,
        }).authorized,
      ).toBe(true)
      expect(
        scriptMatcher.authorize({
          name: 'inline-script-1',
          content: 'function dosomething() {}',
          hash: 'abc123' as any,
        }).authorized,
      ).toBe(false)
    })

    it('should handle null/empty inputs consistently', () => {
      const headerMatcher = new HeaderNameMatcher('^test$')
      const scriptMatcher = new NameMatcher('^test$')

      // Both should return false for empty name/identify input
      expect(headerMatcher.identify({ name: '', value: 'test' })).toBe(false)
      expect(scriptMatcher.identify({ name: '', content: 'test', hash: 'abc123' as any })).toBe(false)

      // Both should return unauthorized for empty content/value
      expect(headerMatcher.authorize({ name: 'test', value: '' }).authorized).toBe(false)
      expect(scriptMatcher.authorize({ name: 'test', content: '', hash: 'abc123' as any }).authorized).toBe(false)
    })

    it('should provide failure reasons in authorize() results', () => {
      const headerMatcher = new HeaderNameMatcher('^expected$')
      const scriptMatcher = new NameMatcher('^expected$')

      const headerResult = headerMatcher.authorize({ name: 'test', value: 'actual' })
      const scriptResult = scriptMatcher.authorize({
        name: 'test',
        content: 'actual',
        hash: 'abc123' as any,
      })

      expect(headerResult.authorized).toBe(false)
      expect(headerResult.reason).toBeDefined()

      expect(scriptResult.authorized).toBe(false)
      expect(scriptResult.reason).toBeDefined()
    })
  })

  describe('Acceptance Scenario 4: Same interface, different matching semantics', () => {
    it('should demonstrate HeaderNameMatcher uses case-insensitive identify', () => {
      const matcher = new HeaderNameMatcher('^x-custom-header$')

      // All these variations should match due to case-insensitive identify
      const variations = ['X-Custom-Header', 'x-custom-header', 'X-CUSTOM-HEADER', 'x-Custom-Header']

      variations.forEach((name) => {
        expect(matcher.identify({ name, value: 'test' })).toBe(true)
      })
    })

    it('should demonstrate ScriptNameMatcher uses case-sensitive identify', () => {
      const matcher = new NameMatcher('^https://Example\\.com/Script\\.js$')

      // Only exact case match should work
      expect(
        matcher.identify({
          name: 'https://Example.com/Script.js',
          content: '',
          hash: 'abc' as any,
        }),
      ).toBe(true)
      expect(
        matcher.identify({
          name: 'https://example.com/script.js',
          content: '',
          hash: 'abc' as any,
        }),
      ).toBe(false)
      expect(
        matcher.identify({
          name: 'https://EXAMPLE.COM/SCRIPT.JS',
          content: '',
          hash: 'abc' as any,
        }),
      ).toBe(false)
    })

    it('should demonstrate both matchers use case-sensitive authorize', () => {
      const headerMatcher = new HeaderNameMatcher('^TestValue$')
      const scriptMatcher = new NameMatcher('^TestValue$')

      // Header authorization (case-sensitive)
      expect(headerMatcher.authorize({ name: 'X-Test', value: 'TestValue' }).authorized).toBe(true)
      expect(headerMatcher.authorize({ name: 'X-Test', value: 'testvalue' }).authorized).toBe(false)

      // Script authorization (case-sensitive)
      expect(
        scriptMatcher.authorize({
          name: 'test',
          content: 'TestValue',
          hash: 'abc' as any,
        }).authorized,
      ).toBe(true)
      expect(
        scriptMatcher.authorize({
          name: 'test',
          content: 'testvalue',
          hash: 'abc' as any,
        }).authorized,
      ).toBe(false)
    })

    it('should validate the distinction is documented in type discriminators', () => {
      const headerMatcher = new HeaderNameMatcher('^test$')
      const scriptMatcher = new NameMatcher('^test$')

      // Type discriminators should be different
      expect(headerMatcher.getType()).toBe('header-name')
      expect(scriptMatcher.getType()).toBe('name')

      // This allows for type-based dispatch in logging and debugging
      const matchers = [headerMatcher, scriptMatcher] as const

      matchers.forEach((matcher) => {
        const type = matcher.getType()
        expect(['header-name', 'name']).toContain(type)
      })
    })
  })
})
