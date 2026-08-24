import { createHash } from 'node:crypto'

import type { QueueMessage } from './drain.js'
import { inlineFingerprint, normaliseMessage } from './normalise.js'

const h8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)

const baseMessage = (observation: QueueMessage['observation'], overrides: Partial<QueueMessage> = {}): QueueMessage => ({
  v: 1,
  target_id: '1.0',
  target_type: 'detection',
  observation,
  novelty: {
    pk: '1.0#some-identity#cdn.example.com',
    first_seen: 1755600000123,
    first_route: '/checkout',
  },
  received_at: 1755600000500,
  session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ...overrides,
})

describe('normaliseMessage', () => {
  describe('external-script (data-model §6)', () => {
    const observation: QueueMessage['observation'] = {
      kind: 'external-script',
      ts: 1755600000000,
      route: '/checkout',
      url: 'https://cdn.example.com/pixel.js',
      initiator: 'https://pay.example.com/checkout',
    }

    it("binds both name and url to the script's OWN URL, carrying the initiator separately on the rum context", () => {
      const normalised = normaliseMessage(baseMessage(observation))

      expect(normalised.kind).toBe('script')
      if (normalised.kind !== 'script') return
      expect(normalised.matchable.name).toBe('https://cdn.example.com/pixel.js')
      // Synthetic contract: for external scripts Matchable.url is the
      // script's own URL — never the initiator, which is provenance only.
      expect(normalised.matchable.url).toBe('https://cdn.example.com/pixel.js')
      expect(normalised.rum.initiator).toBe('https://pay.example.com/checkout')
    })

    it('does NOT let a first-party initiator masquerade as the script URL (domain-trust must not identify a skimmer by its inserter)', () => {
      const skimmer: QueueMessage['observation'] = {
        kind: 'external-script',
        ts: 1755600000000,
        route: '/checkout',
        url: 'https://evil.example.org/skim.js',
        initiator: 'https://pay.example.com/checkout',
      }
      const normalised = normaliseMessage(baseMessage(skimmer))

      if (normalised.kind !== 'script') throw new Error('expected script')
      // A hostMatcher/urlMatcher entry trusting pay.example.com sees the
      // skimmer's own host here, so it cannot identify it.
      expect(normalised.matchable.url).toBe('https://evil.example.org/skim.js')
      expect(normalised.rum.initiator).toBe('https://pay.example.com/checkout')
    })

    it('is identification-only with no fabricated content or hash', () => {
      const normalised = normaliseMessage(baseMessage(observation))

      if (normalised.kind !== 'script') throw new Error('expected script')
      expect(normalised.identificationOnly).toBe(true)
      expect(normalised.matchable.content).toBeNull()
      expect(normalised.matchable.hash).toBeUndefined()
      expect('hash' in normalised.matchable).toBe(false)
      expect(normalised.evidence).toBeUndefined()
    })

    it('never sets workflowId and stamps targetType from the message', () => {
      const detection = normaliseMessage(baseMessage(observation))
      const inventory = normaliseMessage(baseMessage(observation, { target_type: 'inventory' }))

      if (detection.kind !== 'script' || inventory.kind !== 'script') throw new Error('expected script')
      expect(detection.matchable.workflowId).toBeUndefined()
      expect('workflowId' in detection.matchable).toBe(false)
      expect(detection.matchable.targetType).toBe('detection')
      expect(inventory.matchable.targetType).toBe('inventory')
    })

    it("keeps url = the script's own URL and leaves rum.initiator unset when the beacon carried no initiator", () => {
      const normalised = normaliseMessage(baseMessage({ kind: 'external-script', ts: 1755600000000, route: '/checkout', url: 'https://cdn.example.com/pixel.js' }))

      if (normalised.kind !== 'script') throw new Error('expected script')
      expect(normalised.matchable.url).toBe('https://cdn.example.com/pixel.js')
      expect(normalised.rum.initiator).toBeUndefined()
      expect('initiator' in normalised.rum).toBe(false)
    })
  })

  describe('inline-script (data-model §6)', () => {
    const hash = 'a'.repeat(64)
    const withHash: QueueMessage['observation'] = {
      kind: 'inline-script',
      ts: 1755600000000,
      route: '/checkout',
      hash,
      length: 1234,
      head: 'window.__init(',
      tail: ');',
      initiator: 'https://pay.example.com/checkout',
    }

    it('names the script by its client-computed hash when present', () => {
      const normalised = normaliseMessage(baseMessage(withHash))

      if (normalised.kind !== 'script') throw new Error('expected script')
      expect(normalised.matchable.name).toBe(`inline_script/rum:${hash}`)
      expect(normalised.matchable.hash).toEqual({ value: hash })
    })

    it('names the script by the novelty fallback fingerprint when the hash is absent', () => {
      const { hash: _hash, ...withoutHash } = withHash
      const normalised = normaliseMessage(baseMessage(withoutHash as QueueMessage['observation']))

      if (normalised.kind !== 'script') throw new Error('expected script')
      // Format contract shared with collector/src/novelty.ts: len{n}:{h8(head)}:{h8(tail)}
      const expected = `len1234:${h8('window.__init(')}:${h8(');')}`
      expect(inlineFingerprint({ length: 1234, head: 'window.__init(', tail: ');' })).toBe(expected)
      expect(normalised.matchable.name).toBe(`inline_script/rum:${expected}`)
      expect(normalised.matchable.hash).toBeUndefined()
    })

    it('keeps content null for a longer-than-window source and carries the windows as anchored content evidence (T028)', () => {
      const normalised = normaliseMessage(baseMessage(withHash))

      if (normalised.kind !== 'script') throw new Error('expected script')
      expect(normalised.matchable.content).toBeNull()
      expect(normalised.identificationOnly).toBe(false)
      expect(normalised.evidence).toEqual({ length: 1234, head: 'window.__init(', tail: ');', oversize: false })
      // The matching-relevant subset rides the matchable for ContentMatcher's
      // anchored-window evaluation.
      expect(normalised.matchable.contentEvidence).toEqual({ length: 1234, head: 'window.__init(', tail: ');' })
    })

    describe('whole-source promotion (US2 rule (a): head IS the full content when it fits one window)', () => {
      const shortSource = "console.log('checkout ready');"
      const wholeSourceObservation: QueueMessage['observation'] = {
        kind: 'inline-script',
        ts: 1755600000000,
        route: '/checkout',
        hash,
        length: shortSource.length,
        head: shortSource,
        tail: shortSource,
        initiator: 'https://pay.example.com/checkout',
      }

      it('promotes the head to Matchable.content so any pattern evaluates exactly as full content', () => {
        const normalised = normaliseMessage(baseMessage(wholeSourceObservation))

        if (normalised.kind !== 'script') throw new Error('expected script')
        expect(normalised.matchable.content).toBe(shortSource)
        // content and contentEvidence are mutually exclusive by construction.
        expect(normalised.matchable.contentEvidence).toBeUndefined()
        expect('contentEvidence' in normalised.matchable).toBe(false)
      })

      it('does NOT promote when the claimed length disagrees with the windows (internal consistency, fail toward the stricter path)', () => {
        const inconsistent = { ...wholeSourceObservation, length: 20 } // head is 30 chars — cannot be a strict prefix of a 20-char source
        const normalised = normaliseMessage(baseMessage(inconsistent))

        if (normalised.kind !== 'script') throw new Error('expected script')
        expect(normalised.matchable.content).toBeNull()
        expect(normalised.matchable.contentEvidence).toEqual({ length: 20, head: shortSource, tail: shortSource })
      })
    })

    it('maps url from the initiator and preserves the oversize flag', () => {
      const normalised = normaliseMessage(baseMessage({ ...withHash, oversize: true }))

      if (normalised.kind !== 'script') throw new Error('expected script')
      expect(normalised.matchable.url).toBe('https://pay.example.com/checkout')
      expect(normalised.rum.initiator).toBe('https://pay.example.com/checkout')
      expect(normalised.evidence?.oversize).toBe(true)
    })
  })

  describe('csp-violation', () => {
    it('normalises to its own variant, never forced into Matchable', () => {
      const normalised = normaliseMessage(
        baseMessage({
          kind: 'csp-violation',
          ts: 1755600000000,
          route: '/checkout',
          directive: 'script-src',
          blockedUri: 'https://evil.example.org/skim.js',
        }),
      )

      expect(normalised).toEqual({
        kind: 'csp',
        directive: 'script-src',
        blockedUri: 'https://evil.example.org/skim.js',
        rum: expect.anything(),
      })
    })
  })

  describe('rum context', () => {
    it('carries the novelty stamp, session, target, and receipt time for routing and alerts', () => {
      const normalised = normaliseMessage(
        baseMessage({
          kind: 'external-script',
          ts: 1755600000000,
          route: '/checkout',
          url: 'https://cdn.example.com/pixel.js',
        }),
      )

      expect(normalised.rum).toEqual({
        pk: '1.0#some-identity#cdn.example.com',
        firstSeen: 1755600000123,
        firstRoute: '/checkout',
        sessionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        targetId: '1.0',
        targetType: 'detection',
        receivedAt: 1755600000500,
      })
    })
  })
})
