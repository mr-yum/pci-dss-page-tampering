import { createHash } from 'node:crypto'

import type { CspViolationObservation, ExternalScriptObservation, InlineScriptObservation } from '../../src/types/beacon.js'
import { buildNoveltyKey, initiatorHostOf, ttlEpochSeconds } from './novelty.js'

const hex8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)

const externalObservation = (overrides: Partial<ExternalScriptObservation> = {}): ExternalScriptObservation => ({
  kind: 'external-script',
  ts: 1755600001000,
  route: '/checkout',
  url: 'https://cdn.example.net/sdk.js',
  initiator: 'https://pay.example.com/checkout',
  ...overrides,
})

const inlineObservation = (overrides: Partial<InlineScriptObservation> = {}): InlineScriptObservation => ({
  kind: 'inline-script',
  ts: 1755600002000,
  route: '/checkout',
  hash: 'e6fd3e32432da11443aadf6bd83d5464588956cec02521e635d56f11f7bfcffb',
  length: 139,
  head: 'window.dataLayer=window.dataLayer||[];',
  tail: "gtag('config','G-EXAMPLE01');",
  initiator: 'https://pay.example.com/checkout',
  ...overrides,
})

const cspObservation = (overrides: Partial<CspViolationObservation> = {}): CspViolationObservation => ({
  kind: 'csp-violation',
  ts: 1755600000456,
  route: '/checkout',
  directive: 'script-src',
  blockedUri: 'https://evil.example/x.js',
  ...overrides,
})

describe('buildNoveltyKey', () => {
  it('keys external scripts by their URL and initiator host', () => {
    expect(buildNoveltyKey('1.0', externalObservation())).toBe('1.0#https://cdn.example.net/sdk.js#pay.example.com')
  })

  it('keys hashed inline scripts by inline:{hash}', () => {
    expect(buildNoveltyKey('1.0', inlineObservation())).toBe('1.0#inline:e6fd3e32432da11443aadf6bd83d5464588956cec02521e635d56f11f7bfcffb#pay.example.com')
  })

  it('keys unhashed inline scripts by the documented len/head/tail fallback', () => {
    const observation = inlineObservation({ hash: undefined, length: 600000, oversize: true })
    expect(buildNoveltyKey('1.0', observation)).toBe(`1.0#inline:len600000:${hex8(observation.head)}:${hex8(observation.tail)}#pay.example.com`)
  })

  it('produces a stable fallback identity for identical fingerprints', () => {
    const a = inlineObservation({ hash: undefined, ts: 1, route: '/a' })
    const b = inlineObservation({ hash: undefined, ts: 2, route: '/b' })
    expect(buildNoveltyKey('1.0', a)).toBe(buildNoveltyKey('1.0', b))
  })

  it('changes the fallback identity when the fingerprint changes', () => {
    const a = inlineObservation({ hash: undefined })
    const b = inlineObservation({ hash: undefined, tail: 'something-else();' })
    expect(buildNoveltyKey('1.0', a)).not.toBe(buildNoveltyKey('1.0', b))
  })

  it('keys CSP violations by directive and blocked URI with "-" host (no initiator field)', () => {
    expect(buildNoveltyKey('1.0', cspObservation())).toBe('1.0#csp:script-src:https://evil.example/x.js#-')
  })

  it('uses "-" when the initiator is absent', () => {
    expect(buildNoveltyKey('1.0', externalObservation({ initiator: undefined }))).toBe('1.0#https://cdn.example.net/sdk.js#-')
  })

  it('uses "-" when the initiator is unparseable, without throwing', () => {
    expect(buildNoveltyKey('1.0', externalObservation({ initiator: 'not a url' }))).toBe('1.0#https://cdn.example.net/sdk.js#-')
  })

  it('retains a non-default port in the initiator host', () => {
    expect(buildNoveltyKey('1.0', externalObservation({ initiator: 'https://pay.example.com:8443/x' }))).toBe('1.0#https://cdn.example.net/sdk.js#pay.example.com:8443')
  })

  it('never includes the route in any key', () => {
    const observations = [externalObservation({ route: '/route-marker' }), inlineObservation({ route: '/route-marker' }), inlineObservation({ hash: undefined, route: '/route-marker' }), cspObservation({ route: '/route-marker' })]
    for (const observation of observations) {
      expect(buildNoveltyKey('1.0', observation)).not.toContain('route-marker')
    }
  })

  it('hashes an over-long external URL identity so the pk stays within the 2048-byte DynamoDB cap, stably', () => {
    const url = `https://cdn.example.net/${'a'.repeat(2048 - 'https://cdn.example.net/'.length)}`
    expect(url).toHaveLength(2048)
    const observation = externalObservation({ url })
    const key = buildNoveltyKey('1.0', observation)
    expect(Buffer.byteLength(key, 'utf8')).toBeLessThanOrEqual(2048)
    expect(key).toContain('#sha256:')
    expect(key).not.toContain('aaaa')
    // Stable across calls: same inputs → same pk.
    expect(buildNoveltyKey('1.0', externalObservation({ url }))).toBe(key)
  })

  it('hashes an over-long CSP blockedUri identity so the pk stays within the 2048-byte cap, stably', () => {
    const blockedUri = `https://evil.example/${'x'.repeat(2048 - 'https://evil.example/'.length)}`
    expect(blockedUri).toHaveLength(2048)
    const key = buildNoveltyKey('1.0', cspObservation({ blockedUri }))
    expect(Buffer.byteLength(key, 'utf8')).toBeLessThanOrEqual(2048)
    expect(key).toContain('#sha256:')
    expect(key).not.toContain('xxxx')
    expect(buildNoveltyKey('1.0', cspObservation({ blockedUri }))).toBe(key)
  })

  it('distinguishes two different over-long identities (the digest is of the identity, not a constant)', () => {
    const base = `https://cdn.example.net/${'a'.repeat(2048 - 'https://cdn.example.net/'.length - 1)}`
    const a = buildNoveltyKey('1.0', externalObservation({ url: `${base}1` }))
    const b = buildNoveltyKey('1.0', externalObservation({ url: `${base}2` }))
    expect(a).not.toBe(b)
  })

  it('keeps short identities human-readable (no hashing below the threshold)', () => {
    expect(buildNoveltyKey('1.0', externalObservation())).toBe('1.0#https://cdn.example.net/sdk.js#pay.example.com')
    expect(buildNoveltyKey('1.0', cspObservation())).not.toContain('sha256:')
  })

  it('throws for an observation kind that must never be keyed', () => {
    const agentHealth = { kind: 'agent-health', ts: 1, route: '/', p95TaskMs: 2, dropped: 0 }
    expect(() => buildNoveltyKey('1.0', agentHealth as never)).toThrow('agent-health')
  })
})

describe('initiatorHostOf', () => {
  it.each([
    ['https://pay.example.com/checkout', 'pay.example.com'],
    [undefined, '-'],
    ['', '-'],
    ['::::not-a-url', '-'],
  ])('%p → %p', (initiator, expected) => {
    expect(initiatorHostOf(initiator)).toBe(expected)
  })
})

describe('ttlEpochSeconds', () => {
  it('returns now (in seconds, floored) plus the TTL in days', () => {
    expect(ttlEpochSeconds(1755600000123, 90)).toBe(1755600000 + 90 * 86400)
  })
})
