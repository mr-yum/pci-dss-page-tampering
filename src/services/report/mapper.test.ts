/**
 * Unit tests for content sanitisation and truncation.
 *
 * @see ./mapper.ts
 */

import { buildRowId, CONTENT_EXCERPT_LIMIT, redactForDisplay, sanitiseForDisplay, toObservedContent } from './mapper.js'

describe('sanitiseForDisplay', () => {
  it('leaves ordinary content untouched', () => {
    expect(sanitiseForDisplay("window.analytics = { id: 'abc' }")).toBe("window.analytics = { id: 'abc' }")
  })

  it('makes bidirectional overrides visible', () => {
    // Trojan Source: without this, the excerpt renders as something other than
    // what it is, and the assessor reads a lie.
    expect(sanitiseForDisplay('safe\u202Eevil')).toBe('safe⟨U+202E⟩evil')
    expect(sanitiseForDisplay('\u2066x\u2069')).toBe('⟨U+2066⟩x⟨U+2069⟩')
  })

  it('escapes control characters rather than emitting them raw', () => {
    expect(sanitiseForDisplay('a\u0000b\u0007c')).toBe('a⟨U+0000⟩b⟨U+0007⟩c')
  })

  it('keeps newlines and tabs readable as escapes', () => {
    expect(sanitiseForDisplay('a\nb\tc\r')).toBe('a\\nb\\tc\\r')
  })

  it('makes a zero-width character visible', () => {
    expect(sanitiseForDisplay('a\u200Bb')).toBe('a⟨U+200B⟩b')
  })
})

describe('toObservedContent', () => {
  it('reports null content without inventing an excerpt', () => {
    expect(toObservedContent(null, 'abc')).toEqual({ hash: 'abc', contentLength: null, contentExcerpt: null, contentTruncated: false })
  })

  it('keeps short content whole', () => {
    expect(toObservedContent('short', 'abc')).toEqual({ hash: 'abc', contentLength: 5, contentExcerpt: 'short', contentTruncated: false })
  })

  it('truncates long content and records the true length', () => {
    const content = 'x'.repeat(CONTENT_EXCERPT_LIMIT + 500)
    const observed = toObservedContent(content, 'abc')

    expect(observed.contentExcerpt).toHaveLength(CONTENT_EXCERPT_LIMIT)
    expect(observed.contentTruncated).toBe(true)
    // The untruncated length is what makes the truncation itself auditable.
    expect(observed.contentLength).toBe(CONTENT_EXCERPT_LIMIT + 500)
  })

  it('removes credentials before they can reach an artefact', () => {
    const observed = toObservedContent("fetch('https://user:hunter2@api.example.test/v1')", 'abc')

    expect(observed.contentExcerpt).not.toContain('hunter2')
    expect(observed.contentExcerpt).toContain('[credentials-redacted]')
  })

  it('sanitises before truncating, so an escape is never cut in half', () => {
    const observed = toObservedContent(`${'a'.repeat(CONTENT_EXCERPT_LIMIT - 2)}\u202Ebbbb`, 'abc')

    expect(observed.contentExcerpt).not.toContain('\u202E')
  })
})

describe('redaction is bounded', () => {
  it('handles a large hostile body in well under a second', () => {
    // The URL-redaction regexes backtrack quadratically on a long run of
    // letters with no "://". Unbounded, a 200 KB inline script of "aaaa…"
    // stalls the detection run — a denial of service on the compliance
    // monitor, triggered by content an attacker controls.
    const hostile = 'a'.repeat(200_000)
    const started = Date.now()

    const observed = toObservedContent(hostile, 'abc')

    expect(Date.now() - started).toBeLessThan(1000)
    expect(observed.contentExcerpt).toHaveLength(CONTENT_EXCERPT_LIMIT)
    expect(observed.contentLength).toBe(200_000)
    expect(observed.contentTruncated).toBe(true)
  })

  it('bounds a hostile header value too', () => {
    const started = Date.now()

    expect(redactForDisplay('b'.repeat(200_000)).truncated).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('still redacts a credential that appears within the bound', () => {
    expect(redactForDisplay('see https://user:hunter2@api.example.test/v1?k=SECRET').text).not.toContain('hunter2')
    expect(redactForDisplay('see https://user:hunter2@api.example.test/v1?k=SECRET').text).not.toContain('SECRET')
  })
})

describe('buildRowId', () => {
  it('is stable for identical inputs', () => {
    expect(buildRowId(['header', 'csp', null])).toBe(buildRowId(['header', 'csp', null]))
  })

  it('differs when any part differs', () => {
    expect(buildRowId(['header', 'csp', null])).not.toBe(buildRowId(['header', 'csp', 'x']))
  })

  it('treats null and empty string parts consistently', () => {
    expect(buildRowId([null])).toBe(buildRowId(['']))
  })

  it('is short enough to use as a DOM id', () => {
    expect(buildRowId(['a'])).toHaveLength(16)
  })
})
