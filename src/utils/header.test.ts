/**
 * Unit tests for header inventory helpers.
 *
 * @see ./header.ts
 */

import type { HeaderName, HeaderValues } from '../types/header.js'
import { unauthorisedHeadersToInventoryHeaderInfo } from './header.js'

describe('unauthorisedHeadersToInventoryHeaderInfo', () => {
  const date = new Date('2026-01-01T00:00:00.000Z')

  const build = (name: string, ...values: string[]): ReturnType<typeof unauthorisedHeadersToInventoryHeaderInfo> => unauthorisedHeadersToInventoryHeaderInfo(new Map<HeaderName, HeaderValues>([[name, new Set(values)]]), date)

  it('emits a set-based matcher for a CSP directive rather than an anchored regex', () => {
    // An exact-value regex mints a fresh alternative every time the app
    // reorders or drops a source, which is how entries grow a dozen
    // near-duplicates. The set form is stable across both.
    const [entry] = build('content-security-policy', "frame-src 'self' https://js.stripe.com")

    expect(entry!.authoriseWith.matcher.getType()).toBe('csp-directive')
    expect(entry!.authoriseWith.matcher.authorize({ name: 'content-security-policy', content: "frame-src https://js.stripe.com 'self'" }).authorized).toBe(true)
    expect(entry!.authoriseWith.matcher.authorize({ name: 'content-security-policy', content: "frame-src 'self' https://evil.example.test" }).authorized).toBe(false)
  })

  it('wildcards a per-response nonce instead of pinning the observed one', () => {
    // Pinning the nonce observed during an inventory run would fail on the very
    // next response, and would churn a new alternative every single run.
    const [entry] = build('content-security-policy', "script-src 'self' 'nonce-8i04cnq3xfOdYNQwZyf+Ng=='")
    const matcher = entry!.authoriseWith.matcher

    expect(matcher.getPattern()).toBe("script-src 'self' 'nonce-*'")
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'nonce-TotallyDifferent+Ng=='" }).authorized).toBe(true)
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'unsafe-inline'" }).authorized).toBe(false)
  })

  it('covers report-only CSP too', () => {
    expect(build('content-security-policy-report-only', "default-src 'self'")[0]!.authoriseWith.matcher.getType()).toBe('csp-directive')
  })

  it('keeps the exact-value regex for an ordinary header, where the whole value is the assertion', () => {
    const [entry] = build('strict-transport-security', 'max-age=31536000; preload')

    expect(entry!.authoriseWith.matcher.getType()).toBe('content')
    expect(entry!.authoriseWith.matcher.authorize({ name: 'strict-transport-security', content: 'max-age=31536000; preload' }).authorized).toBe(true)
    expect(entry!.authoriseWith.matcher.authorize({ name: 'strict-transport-security', content: 'max-age=1' }).authorized).toBe(false)
  })

  it('falls back to a content matcher when a CSP value has no parsable directive', () => {
    expect(build('content-security-policy', '   ')[0]!.authoriseWith.matcher.getType()).toBe('content')
  })

  it('marks every discovered header as needing authorisation', () => {
    const [entry] = build('content-security-policy', "frame-src 'self'")

    expect(entry!.authoriseWith.authorisationInfo).toEqual({ description: 'NO_DESCRIPTION', authorised: false, date })
  })
})
