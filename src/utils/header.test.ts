/**
 * Unit tests for the new-header-value matcher chooser.
 *
 * See also `src/services/inventory.test.ts`, which drives this through
 * `ScriptInventoryService.diff` — the path an actual inventory run takes. An
 * earlier version of these tests exercised a helper with no production caller,
 * and so certified behaviour the running system did not have.
 *
 * @see ./header.ts
 * @see ../services/inventory.ts
 */

import { createMatcher } from '../types/matcher/matcher-factory.js'
import { newHeaderValueMatcherConfig } from './header.js'

describe('newHeaderValueMatcherConfig', () => {
  const matcherFor = (name: string, value: string): ReturnType<typeof createMatcher> => createMatcher(newHeaderValueMatcherConfig(name, value))

  const authorises = (name: string, approvedValue: string, observedValue: string): boolean => matcherFor(name, approvedValue).authorize({ name, content: observedValue }).authorized

  it('emits a set-based matcher for a CSP directive rather than an anchored regex', () => {
    // An exact-value regex mints a fresh alternative every time the app
    // reorders its sources, which is how entries grow a dozen near-duplicates.
    expect(matcherFor('content-security-policy', "frame-src 'self' https://js.stripe.com").getType()).toBe('csp-directive')
    expect(authorises('content-security-policy', "frame-src 'self' https://js.stripe.com", "frame-src https://js.stripe.com 'self'")).toBe(true)
  })

  it('still flags an added source', () => {
    expect(authorises('content-security-policy', "frame-src 'self'", "frame-src 'self' https://evil.example.test")).toBe(false)
  })

  it('flags a removed source, because some CSP sources only suppress others while present', () => {
    expect(authorises('content-security-policy', "script-src 'self' 'unsafe-inline'", "script-src 'self'")).toBe(false)
  })

  it('wildcards a per-response nonce instead of pinning the observed one', () => {
    // Pinning the nonce seen during an inventory run would fail on the very
    // next response, and would churn a new alternative every single run.
    const matcher = matcherFor('content-security-policy', "script-src 'self' 'nonce-8i04cnq3xfOdYNQwZyf+Ng=='")

    expect(matcher.getPattern()).toBe("script-src 'self' 'nonce-*'")
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'nonce-TotallyDifferent+Ng=='" }).authorized).toBe(true)
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'unsafe-inline'" }).authorized).toBe(false)
  })

  it('keeps one placeholder per observed nonce, because the matcher counts them', () => {
    // Collapsing two nonces into one placeholder would emit an entry that
    // never authorises its own observed value.
    const matcher = matcherFor('content-security-policy', "script-src 'nonce-aaa' 'nonce-bbb' 'self'")

    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'nonce-x' 'nonce-y'" }).authorized).toBe(true)
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'nonce-x'" }).authorized).toBe(false)
    expect(matcher.authorize({ name: 'content-security-policy', content: "script-src 'self' 'nonce-x' 'nonce-y' 'nonce-z'" }).authorized).toBe(false)
  })

  it('leaves an untracked header kind alone, rather than claiming unreachable coverage', () => {
    // content-security-policy-report-only is not in TRACKED_HEADER_NAMES, so it
    // never reaches inventory. Treating it as CSP here would be a branch no run
    // can take.
    expect(matcherFor('content-security-policy-report-only', "default-src 'self'").getType()).toBe('content')
  })

  it('keeps the exact-value regex for an ordinary header, where the whole value is the assertion', () => {
    expect(matcherFor('strict-transport-security', 'max-age=31536000; preload').getType()).toBe('content')
    expect(authorises('strict-transport-security', 'max-age=31536000; preload', 'max-age=31536000; preload')).toBe(true)
    expect(authorises('strict-transport-security', 'max-age=31536000; preload', 'max-age=1')).toBe(false)
  })

  it('falls back to a content matcher when a CSP value has no parsable directive', () => {
    expect(matcherFor('content-security-policy', '   ').getType()).toBe('content')
  })
})
