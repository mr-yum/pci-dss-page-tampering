/**
 * ContentMatcher Unit Tests
 *
 * Tests content-based script matching with regex patterns.
 * Covers exact content match, regex patterns, null/empty content, and multi-line content.
 *
 * @see ../../../specs/001-refactor-script-identification/research.md (R7) for test strategy
 */

import type { SHA256Hash } from '../hash.js'
import { ContentMatcher } from './content-matcher.js'
import type { DetectedScript } from './matcher.interface.js'

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

  describe('anchored head/tail window evidence (feature 011 T028, spec US2)', () => {
    // A realistic long inline source (> 128 chars) and its strict
    // prefix/suffix windows, exactly as agent/src/fingerprint.ts produces them.
    const source = `window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');console.log('checkout ready');`
    const WINDOW = 128
    const windowed = (fullSource: string): DetectedScript => ({
      name: 'inline_script/rum:len-fingerprint',
      content: null,
      hash: { value: 'hash123' } as SHA256Hash,
      contentEvidence: { length: fullSource.length, head: fullSource.slice(0, WINDOW), tail: fullSource.slice(-WINDOW) },
    })
    /** The escaped first 64 chars of the source — the existing inventory style. */
    const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    describe('spec US2 scenario 4: existing 64-char anchored matchers evaluate identically against windows and full content', () => {
      it('authorizes a ^-anchored 64-char content snippet against the 128-char head of a longer script', () => {
        const matcher = new ContentMatcher(`^${escapeRegex(source.slice(0, 64))}`)

        expect(matcher.authorize(windowed(source)).authorized).toBe(true)
        // Identical verdict to full content:
        expect(matcher.authorize(createDetectedScript('inline-full', source)).authorized).toBe(true)
      })

      it('authorizes a $-anchored 64-char content snippet against the 128-char tail of a longer script', () => {
        const matcher = new ContentMatcher(`${escapeRegex(source.slice(-64))}$`)

        expect(matcher.authorize(windowed(source)).authorized).toBe(true)
        expect(matcher.authorize(createDetectedScript('inline-full', source)).authorized).toBe(true)
      })

      it('identifies via a sound anchored window match (identify mirrors authorize)', () => {
        const matcher = new ContentMatcher(`^${escapeRegex(source.slice(0, 64))}`)

        expect(matcher.identify(windowed(source))).toBe(true)
      })
    })

    describe('fail-secure: patterns that cannot be soundly evaluated against a bounded excerpt', () => {
      it('fails secure with the explicit bounded-excerpt reason for an unanchored pattern', () => {
        const matcher = new ContentMatcher('checkout ready') // present in the source, but unanchored
        const result = matcher.authorize(windowed(source))

        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('content evidence is a bounded excerpt')
        expect(result.reason).not.toBe('content is null or empty')
      })

      it('fails secure for a ^…$ whole-content pattern (asserts about content the windows cannot prove)', () => {
        const matcher = new ContentMatcher(`^${escapeRegex(source)}$`) // matches the FULL source, but windows cannot prove it
        const result = matcher.authorize(windowed(source))

        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('content evidence is a bounded excerpt')
      })

      it('a bare $ hidden mid-pattern disqualifies head evaluation (would assert content-end at the window cut)', () => {
        const matcher = new ContentMatcher(`^window\\.dataLayer(=$|=)`)
        const result = matcher.authorize(windowed(source))

        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('content evidence is a bounded excerpt')
      })

      it('an ESCAPED \\$ is a literal, not an anchor — head evaluation stays sound', () => {
        const dollarSource = `window.price='\\$42';${source}`
        const matcher = new ContentMatcher(`^window\\.price='\\$42';`)

        expect(matcher.authorize(windowed(dollarSource)).authorized).toBe(false) // literal backslash-dollar is not in the source
        const literalDollar = `window.price='$42';${source}`
        expect(new ContentMatcher(`^window\\.price='\\$42';`).authorize(windowed(literalDollar)).authorized).toBe(true)
      })

      it('treats an anchored window NON-match as not-evaluable, never a confident deny (match may extend beyond the excerpt)', () => {
        // ^-anchored, but its guaranteed match needs to see past char 128:
        // a head non-match cannot prove a full-content non-match.
        const matcher = new ContentMatcher(`^window\\.dataLayer[\\s\\S]*checkout ready`)
        const result = matcher.authorize(windowed(source))

        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('cannot be ruled out')
        expect(result.reason).toContain('content evidence is a bounded excerpt')
      })

      it('never uses the misleading "content is null or empty" reason when window evidence exists', () => {
        const matcher = new ContentMatcher('anything')
        const result = matcher.authorize(windowed(source))

        expect(result.reason).not.toBe('content is null or empty')
      })
    })

    describe('promoted whole-source content (≤ one window) evaluates any pattern exactly as full content', () => {
      // When the whole source fits one window, normalisation promotes head to
      // Matchable.content — no evidence object, no anchoring requirement.
      const shortSource = `console.log('ready');`

      it('authorizes an unanchored pattern against promoted full content', () => {
        const matcher = new ContentMatcher(`log\\('ready'\\)`)
        const script = createDetectedScript('inline-short', shortSource)

        expect(matcher.authorize(script).authorized).toBe(true)
      })

      it('authorizes a ^…$ whole-content pattern against promoted full content', () => {
        const matcher = new ContentMatcher(`^${escapeRegex(shortSource)}$`)
        const script = createDetectedScript('inline-short', shortSource)

        expect(matcher.authorize(script).authorized).toBe(true)
      })

      it('denies confidently (pattern reason, not bounded-excerpt reason) when promoted full content does not match', () => {
        const matcher = new ContentMatcher('skimmer')
        const script = createDetectedScript('inline-short', shortSource)
        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content does not match pattern: skimmer')
      })
    })

    describe('metadataPath on window-evidence results', () => {
      it('attaches authorisationInfo to window-evidence outcomes exactly as to content outcomes', () => {
        const info = { description: 'Anchored bootstrap snippet', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') }
        const matcher = new ContentMatcher(`^${escapeRegex(source.slice(0, 64))}`, info)

        expect(matcher.authorize(windowed(source)).metadataPath).toEqual([info])
        expect(new ContentMatcher('unanchored', info).authorize(windowed(source)).metadataPath).toEqual([info])
      })
    })

    describe('boundary/lookaround assertions are never window-evaluable (fail-secure)', () => {
      // A word-boundary (\b, \B) or lookaround ((?=, (?!, (?<=, (?<!) is judged
      // relative to the string edge, so a match inside a strict prefix/suffix
      // window is unsound. Every such pattern must fail secure against window
      // evidence — while evaluating normally against ≤128 promoted content,
      // where it sees the true string edges.
      const assertsNotEvaluable = (pattern: string): void => {
        const result = new ContentMatcher(pattern).authorize(windowed(source))
        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('content evidence is a bounded excerpt')
        expect(result.reason).not.toBe('content is null or empty')
      }

      it('a ^-anchored pattern ending in a \\b word boundary is not evaluable against a head window', () => {
        assertsNotEvaluable('^fn_a{125}\\b')
        // …but the SAME pattern decides normally on ≤128 promoted full content.
        expect(new ContentMatcher('^fn_a{125}\\b').authorize(createDetectedScript('inline', `fn_${'a'.repeat(125)}`)).authorized).toBe(true)
      })

      it('a ^-anchored pattern carrying a negative lookahead is not evaluable against a head window', () => {
        assertsNotEvaluable('^P{126}(?!EVIL)')
        expect(new ContentMatcher('^P{126}(?!EVIL)').authorize(createDetectedScript('inline', 'P'.repeat(126))).authorized).toBe(true)
      })

      it('a leading negative-lookahead guard pattern is not evaluable against a head window', () => {
        assertsNotEvaluable('^(?![\\s\\S]*eval)[\\s\\S]')
        expect(new ContentMatcher('^(?![\\s\\S]*eval)[\\s\\S]').authorize(createDetectedScript('inline', 'clean code')).authorized).toBe(true)
      })

      it('a $-anchored pattern carrying a \\b word boundary is not evaluable against a tail window', () => {
        assertsNotEvaluable('\\bDate\\(\\);$')
        expect(new ContentMatcher('\\bDate\\(\\);$').authorize(createDetectedScript('inline', 'new Date();')).authorized).toBe(true)
      })

      it('a $-anchored pattern carrying a lookbehind is not evaluable against a tail window', () => {
        assertsNotEvaluable('(?<=x)ready$')
        expect(new ContentMatcher('(?<=x)ready$').authorize(createDetectedScript('inline', 'xready')).authorized).toBe(true)
      })
    })

    describe('scanAnchors character-class handling (observed via authorize on window evidence)', () => {
      /** A source long enough (> 128) that head/tail windows are strict excerpts. */
      const longFrom = (prefix: string): DetectedScript => windowed(`${prefix}${'a'.repeat(200)}`)

      it('a real $ after a character class ([a]$…) sets hasBareDollar → not head-evaluable → fail-secure', () => {
        const result = new ContentMatcher('^probe[a]$tail').authorize(windowed(source))
        expect(result.authorized).toBe(false)
        expect(result.reason).toContain('content evidence is a bounded excerpt')
      })

      it('a $ inside a character class ([$]) is a literal, not an anchor → head evaluation stays sound', () => {
        // ^probe[$] matches a head beginning "probe$"; a literal $ leaves the
        // pattern head-evaluable, so a sound head match authorises.
        expect(new ContentMatcher('^probe[$]').authorize(longFrom('probe$')).authorized).toBe(true)
      })

      it('a ^ inside a character class ([^x]) is negation, not an anchor → head evaluation stays sound', () => {
        // ^probe[^x]y matches a head beginning "probe" + non-x + "y"; the
        // class-internal ^ is negation and does not disqualify head evaluation.
        expect(new ContentMatcher('^probe[^x]y').authorize(longFrom('probeZy')).authorized).toBe(true)
      })
    })
  })
})
