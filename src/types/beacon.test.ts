import * as fs from 'node:fs'
import * as path from 'node:path'

import { type Beacon, MAX_BEACON_BYTES, parseBeacon } from './beacon.js'

const FIXTURES_DIR = path.join(__dirname, '../../test/fixtures/beacons')

const readFixture = (...segments: string[]): string => fs.readFileSync(path.join(FIXTURES_DIR, ...segments), 'utf8')

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('parseBeacon', () => {
  describe('valid fixtures', () => {
    it.each(['canonical.json', 'external-unknown.json', 'inline-valid.json', 'inline-oversize.json', 'csp-violation.json', 'canary.json'])('accepts %s', (fixture) => {
      const result = parseBeacon(readFixture(fixture))

      expect(result).toMatchObject({ ok: true })
    })
  })

  describe('invalid fixtures', () => {
    it.each([
      ['unknown-key.json', /userEmail/],
      ['too-many-observations.json', /observations/],
      ['head-too-long.json', /head/],
      ['bad-hash.json', /hash/],
      ['missing-ts.json', /\bts\b/],
    ])('rejects %s with reason schema on the intended constraint', (fixture, constraint) => {
      const result = parseBeacon(readFixture('invalid', fixture))

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('schema')
      expect(result.detail).toMatch(constraint)
    })
  })

  describe('size cap', () => {
    it('rejects an oversized body with reason size before JSON.parse runs', () => {
      // Malformed JSON beyond the cap: a 'json' reason here would prove the
      // parser ran on input the cap should have rejected first.
      const raw = '{'.padEnd(MAX_BEACON_BYTES + 1, 'x')

      expect(parseBeacon(raw)).toMatchObject({ ok: false, reason: 'size' })
    })

    it('rejects a valid beacon padded past the cap with reason size', () => {
      // Trailing whitespace is valid JSON padding, so only the byte cap can
      // reject this body.
      const raw = readFixture('canonical.json').padEnd(MAX_BEACON_BYTES + 1, ' ')

      expect(parseBeacon(raw)).toMatchObject({ ok: false, reason: 'size' })
    })

    it('rejects malformed JSON under the cap with reason json', () => {
      expect(parseBeacon('{ not json')).toMatchObject({ ok: false, reason: 'json' })
    })
  })

  describe('compatibility invariant (anchored matcher semantics)', () => {
    const canonical = JSON.parse(readFixture('canonical.json')) as Beacon
    const inline = canonical.observations.find((observation) => observation.kind === 'inline-script')
    if (inline?.kind !== 'inline-script') throw new Error('canonical.json must carry an inline-script observation')

    it('head is bounded and a ^-anchored 64-char content-prefix matcher matches it', () => {
      expect(inline.head.length).toBeLessThanOrEqual(128)

      // head is a strict prefix of the content, so an inventory contentMatcher
      // anchored on the content's first 64 chars matches the fingerprint too.
      const anchoredPrefix = new RegExp(`^${escapeRegExp(inline.head.slice(0, 64))}`)

      expect(anchoredPrefix.test(inline.head)).toBe(true)
    })

    it('tail is bounded and a $-anchored 64-char content-suffix matcher matches it', () => {
      expect(inline.tail.length).toBeLessThanOrEqual(128)

      const anchoredSuffix = new RegExp(`${escapeRegExp(inline.tail.slice(-64))}$`)

      expect(anchoredSuffix.test(inline.tail)).toBe(true)
    })
  })

  describe('non-fixture observations', () => {
    const envelope = (observations: unknown[]): string =>
      JSON.stringify({
        v: 1,
        session: { id: '6f1e2c3d-4b5a-4c7d-8e9f-0a1b2c3d4e5f', agentVersion: '1.0.0' },
        page: { url: 'https://pay.example.com/checkout' },
        observations,
      })

    it('accepts an agent-health observation', () => {
      const raw = envelope([{ kind: 'agent-health', p95TaskMs: 3.5, dropped: 0, route: '/', ts: 1755600000000 }])

      expect(parseBeacon(raw)).toMatchObject({ ok: true })
    })

    it('rejects an unknown observation kind', () => {
      const raw = envelope([{ kind: 'keylogger', route: '/', ts: 1755600000000 }])
      const result = parseBeacon(raw)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('schema')
      expect(result.detail).toMatch(/observations/)
    })
  })
})
