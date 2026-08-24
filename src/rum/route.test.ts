import type { IAlertService } from '../interfaces/alert.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import { UnknownScriptFound } from '../types/comparison/unknown-script-found.js'
import type { SHA256Hash } from '../types/hash.js'
import type { AlertRum, Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { QueueMessage } from './drain.js'
import { normaliseMessage } from './normalise.js'
import { routeMessage, rumDedupeKey, RumRouteDeps } from './route.js'

const silentLogger: Logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

const mockTarget: Target = {
  type: 'detection',
  url: 'https://pay.example.com/checkout',
  workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
  logger: silentLogger,
}

const makeAlertService = () => {
  const alertForRumObservation = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined)
  return { mock: alertForRumObservation, service: { alertForRumObservation } as unknown as IAlertService }
}

const makeInventory = (scripts: InventoryScriptInfo[], rum?: AlertRum): Inventory => ({
  fileName: 'test-inventory.json',
  target: {
    inventory: { type: 'inventory', url: 'https://staging.example.com', workflow: { fileName: 'test-workflow.json', definition: { steps: [] } }, logger: silentLogger },
    detection: { type: 'detection', url: 'https://pay.example.com/checkout', workflow: { fileName: 'test-workflow.json', definition: { steps: [] } }, logger: silentLogger },
  },
  alerts: {
    inventory: {
      newScriptIdentified: { destination: 'inventory-script-channel' },
      newHeaderIdentified: { destination: 'inventory-header-channel' },
    },
    detection: {
      newScriptDetected: { destination: 'detection-script-channel' },
      scriptMismatchDetected: { destination: 'script-mismatch-channel' },
      newHeaderDetected: { destination: 'detection-header-channel' },
    },
    ...(rum !== undefined ? { rum } : {}),
    successNotification: { destination: 'success-channel' },
  },
  scripts,
  headers: [],
})

// Fixture pattern mirrors src/services/comparison/script.test.ts: entries are
// built with the real matcher factory, never hand-rolled matcher fakes.
const inventoryEntry = (namePattern: string, authorisedHashes: string[] = []): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: namePattern }),
  authoriseWith: {
    matcher: authorisedHashes.length > 0 ? createMatcher({ hashes: authorisedHashes.map((hash) => ({ timestamp: new Date(), hash: { value: hash } as SHA256Hash })) }) : createMatcher({ contentMatcher: 'console\\.log' }),
    authorisationInfo: { description: 'Test entry', authorised: true, date: new Date() },
  },
})

const queueMessage = (observation: QueueMessage['observation'], overrides: Partial<QueueMessage> = {}): QueueMessage => ({
  v: 1,
  target_id: '1.0',
  target_type: 'detection',
  observation,
  novelty: { pk: `1.0#${JSON.stringify(observation).slice(0, 40)}#pay.example.com`, first_seen: 1755600000123, first_route: '/checkout' },
  received_at: 1755600000500,
  session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ...overrides,
})

const externalObservation = (url: string): QueueMessage['observation'] => ({ kind: 'external-script', ts: 1755600000000, route: '/checkout', url, initiator: 'https://pay.example.com/checkout' })

const inlineObservation = (hash?: string): QueueMessage['observation'] => ({
  kind: 'inline-script',
  ts: 1755600000000,
  route: '/checkout',
  ...(hash !== undefined ? { hash } : {}),
  length: 42,
  head: 'window.__init(',
  tail: ');',
  initiator: 'https://pay.example.com/checkout',
})

const makeDeps = (scripts: InventoryScriptInfo[], target: Target = mockTarget, rum?: AlertRum) => {
  const { mock, service } = makeAlertService()
  const deps: RumRouteDeps = {
    scriptComparison: new ScriptComparisonService(),
    alertService: service,
    inventory: makeInventory(scripts, rum),
    target,
    inventoryRef: 'abc1234',
    log: silentLogger,
    seen: new Set<string>(),
  }
  return { deps, alertMock: mock }
}

describe('routeMessage', () => {
  describe('external scripts (identification-only, research R8)', () => {
    it('alerts rum_uninventoried_script_detected with full context for an unknown external script', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])
      const normalised = normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js')))

      const outcome = await routeMessage(normalised, deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(alertMock).toHaveBeenCalledWith(
        'rum_uninventoried_script_detected',
        {
          observation: { kind: 'external-script', identity: 'https://evil.example.org/skim.js', initiator: 'https://pay.example.com/checkout' },
          prevalence: { first_seen: 1755600000123 },
          first_route: '/checkout',
          targetType: 'detection',
          inventoryRef: 'abc1234',
        },
        deps.inventory.alerts,
      )
    })

    it('records an identified external script without any authorisation attempt or alert', async () => {
      const entry = inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')
      const authorizeSpy = jest.spyOn(entry.authoriseWith.matcher, 'authorize')
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeMessage(normaliseMessage(queueMessage(externalObservation('https://cdn.example.com/known.js'))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    describe('initiatorHostMatcher — the inventory decides who may load a known URL (clarification #1)', () => {
      // The novelty key includes the initiator host so a known script
      // re-injected by a NEW source re-enters evaluation; this entry is how
      // the inventory turns that event into an alert. Composition is the
      // whole mechanism: same allow-listed URL, constrained inserter.
      const pinnedEntry = (): InventoryScriptInfo => ({
        identifyWith: createMatcher({
          andMatcher: [{ nameMatcher: '^https://cdn\\.example\\.com/known\\.js$' }, { initiatorHostMatcher: '^pay\\.example\\.com$' }],
        }),
        authoriseWith: {
          matcher: createMatcher({ initiatorHostMatcher: '^pay\\.example\\.com$' }),
          authorisationInfo: { description: 'SDK loaded only by the checkout shell', authorised: true, date: new Date() },
        },
      })

      it('records the known URL when loaded by the expected initiator host', async () => {
        const { deps, alertMock } = makeDeps([pinnedEntry()])

        const outcome = await routeMessage(normaliseMessage(queueMessage(externalObservation('https://cdn.example.com/known.js'))), deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('alerts rum_uninventoried_script_detected when the SAME known URL arrives via a new initiator', async () => {
        const { deps, alertMock } = makeDeps([pinnedEntry()])
        const observation: QueueMessage['observation'] = { kind: 'external-script', ts: 1755600000000, route: '/checkout', url: 'https://cdn.example.com/known.js', initiator: 'https://evil.example.org/injector.js' }

        const outcome = await routeMessage(normaliseMessage(queueMessage(observation)), deps)

        expect(outcome).toMatchObject({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected' })
        expect(alertMock).toHaveBeenCalledTimes(1)
        expect(alertMock.mock.calls[0]![1]).toMatchObject({ observation: { identity: 'https://cdn.example.com/known.js', initiator: 'https://evil.example.org/injector.js' } })
      })

      it('fails secure (alerts) when the known URL arrives with no attribution at all', async () => {
        const { deps, alertMock } = makeDeps([pinnedEntry()])
        const observation: QueueMessage['observation'] = { kind: 'external-script', ts: 1755600000000, route: '/checkout', url: 'https://cdn.example.com/known.js' }

        const outcome = await routeMessage(normaliseMessage(queueMessage(observation)), deps)

        expect(outcome).toMatchObject({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected' })
        expect(alertMock).toHaveBeenCalledTimes(1)
      })
    })

    describe('domain-trust entries judge the script by its OWN URL, never its initiator', () => {
      // First-party domain-trust entry: any script served from the payment
      // page's own host is identified (the urlMatcher/hostMatcher pattern the
      // inventory repo uses for first-party origins).
      const firstPartyDomainTrust = (): InventoryScriptInfo => ({
        identifyWith: createMatcher({ urlMatcher: '^https://pay\\.example\\.com/.+$' }),
        authoriseWith: {
          matcher: createMatcher({ urlMatcher: '^https://pay\\.example\\.com/.+$' }),
          authorisationInfo: { description: 'First-party domain trust', authorised: true, date: new Date() },
        },
      })

      it('does NOT identify an external skimmer merely because first-party code inserted it — the uninventoried alert fires', async () => {
        const { deps, alertMock } = makeDeps([firstPartyDomainTrust()])
        // Skimmer hosted elsewhere, inserted by (initiator =) the trusted
        // first-party page. Binding url to the initiator would wrongly
        // identify — and silently record — this script.
        const normalised = normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js')))

        const outcome = await routeMessage(normalised, deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
        expect(alertMock).toHaveBeenCalledTimes(1)
      })

      it('identifies a legitimate first-party external script by its own URL — recorded, no alert', async () => {
        const { deps, alertMock } = makeDeps([firstPartyDomainTrust()])
        const normalised = normaliseMessage(queueMessage(externalObservation('https://pay.example.com/assets/app.js')))

        const outcome = await routeMessage(normalised, deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('still carries the initiator in the alert context (provenance from the rum context, not Matchable.url)', async () => {
        const { deps, alertMock } = makeDeps([firstPartyDomainTrust()])

        await routeMessage(normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js'))), deps)

        const [, context] = alertMock.mock.calls[0] as [string, { observation: { identity: string; initiator?: string } }]
        expect(context.observation.identity).toBe('https://evil.example.org/skim.js')
        expect(context.observation.initiator).toBe('https://pay.example.com/checkout')
      })
    })
  })

  describe('inline scripts', () => {
    const hash = 'b'.repeat(64)

    it('alerts rum_mismatched_script_detected with a failure reason when an identified inline script fails authorisation', async () => {
      // Identified by name, authorised by a different hash: matchers are
      // evidence-aware, so the client-computed hash is genuinely compared —
      // the mismatch reason names the unauthorised hash (potential tampering).
      const entry = inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_mismatched_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      const [category, context] = alertMock.mock.calls[0] as [string, { failureReason?: string; matcherDescription?: string; observation: { hash?: string } }]
      expect(category).toBe('rum_mismatched_script_detected')
      expect(context.failureReason).toEqual(expect.any(String))
      expect(context.failureReason!.length).toBeGreaterThan(0)
      expect(context.matcherDescription).toContain('hash')
      expect(context.observation.hash).toBe(hash)
    })

    it('alerts rum_uninventoried_script_detected for an unidentified inline script', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])

      const outcome = await routeMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(alertMock.mock.calls[0]![0]).toBe('rum_uninventoried_script_detected')
    })

    it('records an identified inline script whose client-computed hash matches an authorised hash — no alert (evidence-aware, T029 pulled forward)', async () => {
      const entry = inventoryEntry('^inline_script/rum:', [hash])
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it("fails secure for an identified inline script that carried no hash — with the hash authoriser's own truthful reason", async () => {
      // T028: the hash-less observation still runs the full evidence-aware
      // comparison (it is never blanket-failed at the routing layer), so the
      // failure reason is the HashMatcher's own — evidence it needs is absent.
      const entry = inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeMessage(normaliseMessage(queueMessage(inlineObservation())), deps)

      expect(outcome.outcome).toBe('alerted')
      expect(outcome.category).toBe('rum_mismatched_script_detected')
      const [, context] = alertMock.mock.calls[0] as [string, { failureReason?: string }]
      expect(context.failureReason).toContain('hash is missing')
    })

    describe('anchored head/tail window evidence (T028, spec US2)', () => {
      // A realistic > 128-char source and its strict prefix/suffix windows,
      // exactly as agent/src/fingerprint.ts would produce them.
      const longSource = `window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');console.log('checkout ready');`
      const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const windowedObservation = (source: string, oversize = false): QueueMessage['observation'] => ({
        kind: 'inline-script',
        ts: 1755600000000,
        route: '/checkout',
        length: source.length,
        head: source.slice(0, 128),
        tail: source.slice(-128),
        ...(oversize ? { oversize: true } : {}),
        initiator: 'https://pay.example.com/checkout',
      })
      const contentEntry = (pattern: string): InventoryScriptInfo => ({
        identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
        authoriseWith: {
          matcher: createMatcher({ contentMatcher: pattern }),
          authorisationInfo: { description: 'Anchored snippet entry', authorised: true, date: new Date() },
        },
      })

      it('records a hash-less oversize script authorised by an existing-style ^-anchored 64-char content matcher (spec US2 scenario 4)', async () => {
        const { deps, alertMock } = makeDeps([contentEntry(`^${escapeRegex(longSource.slice(0, 64))}`)])

        const outcome = await routeMessage(normaliseMessage(queueMessage(windowedObservation(longSource, true))), deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('records when a $-anchored matcher matches the tail window', async () => {
        const { deps, alertMock } = makeDeps([contentEntry(`${escapeRegex(longSource.slice(-64))}$`)])

        const outcome = await routeMessage(normaliseMessage(queueMessage(windowedObservation(longSource))), deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('fails secure with the explicit bounded-excerpt reason — never "content is null or empty" — for an unanchored pattern on > 128-char content', async () => {
        const { deps, alertMock } = makeDeps([contentEntry('checkout ready')])

        const outcome = await routeMessage(normaliseMessage(queueMessage(windowedObservation(longSource))), deps)

        expect(outcome.outcome).toBe('alerted')
        expect(outcome.category).toBe('rum_mismatched_script_detected')
        const [, context] = alertMock.mock.calls[0] as [string, { failureReason?: string; matcherDescription?: string }]
        expect(context.failureReason).toContain('content evidence is a bounded excerpt')
        expect(context.failureReason).not.toContain('content is null or empty')
        expect(context.matcherDescription).toContain('content:')
      })

      it('evaluates any pattern exactly as full content when the whole source fits one window (≤ 128 chars)', async () => {
        const shortSource = "console.log('checkout ready');"
        const { deps, alertMock } = makeDeps([contentEntry('checkout ready')]) // unanchored — sound because head IS the content

        const outcome = await routeMessage(normaliseMessage(queueMessage(windowedObservation(shortSource))), deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('oversize scripts are still evaluated and never dropped: an unmatched one alerts (spec US2 scenario 3)', async () => {
        const { deps, alertMock } = makeDeps([contentEntry('^does-not-open-the-real-source')])

        const outcome = await routeMessage(normaliseMessage(queueMessage(windowedObservation(longSource, true))), deps)

        expect(outcome.drain).toBe('routed')
        expect(outcome.outcome).toBe('alerted')
        expect(outcome.category).toBe('rum_mismatched_script_detected')
        expect(alertMock).toHaveBeenCalledTimes(1)
      })
    })

    describe('rum_mismatched_script_detected alert context (T029)', () => {
      it('carries matcher context, failure reason, and the metadataPath from the comparison result', async () => {
        // Composite authoriser so the comparison result has a real metadata
        // path: AND of (hash, content) with per-level authorisationInfo.
        const entry: InventoryScriptInfo = {
          identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
          authoriseWith: {
            matcher: createMatcher({
              andMatcher: [
                { hashes: [{ timestamp: new Date(), hash: { value: hash } as SHA256Hash }], authorisationInfo: { description: 'Pinned hash', authorised: true, date: '2026-08-01T00:00:00.000Z' } },
                { contentMatcher: 'never-present', authorisationInfo: { description: 'Required snippet', authorised: true, date: '2026-08-01T00:00:00.000Z' } },
              ],
              authorisationInfo: { description: 'Hash AND snippet', authorised: true, date: '2026-08-01T00:00:00.000Z' },
            }),
            authorisationInfo: { description: 'Top-level composite', authorised: true, date: new Date() },
          },
        }
        const { deps, alertMock } = makeDeps([entry])

        const outcome = await routeMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

        expect(outcome.category).toBe('rum_mismatched_script_detected')
        const [, context] = alertMock.mock.calls[0] as [string, { failureReason?: string; matcherDescription?: string; metadataPath?: { description: string }[] }]
        expect(context.matcherDescription).toContain('and')
        expect(context.failureReason).toEqual(expect.any(String))
        expect(context.metadataPath).toBeDefined()
        expect(context.metadataPath!.map((info) => info.description)).toContain('Hash AND snippet')
      })
    })
  })

  describe('csp violations (opt-in activation, T035)', () => {
    const cspObservation = (): QueueMessage['observation'] => ({ kind: 'csp-violation', ts: 1755600000000, route: '/checkout', directive: 'script-src', blockedUri: 'https://evil.example.org/skim.js' })

    it('records without alerting when the target provides no alerts.rum.cspViolationReported destination (permanent default)', async () => {
      const { deps, alertMock } = makeDeps([])

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('stays recorded even when the header-channel fallbacks are configured — the fallback chain never activates this category', async () => {
      const { deps, alertMock } = makeDeps([])
      deps.inventory.alerts.detection.headerMismatchDetected = { destination: 'header-mismatch-channel' }
      // A partially configured rum block without the csp key is not an
      // activation either.
      deps.inventory.alerts.rum = { mismatchedScriptDetected: { destination: 'rum-mismatched-channel' } }

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('alerts rum_csp_violation_reported with the violation-as-reported context when the destination is configured', async () => {
      const { deps, alertMock } = makeDeps([], mockTarget, { cspViolationReported: { destination: 'rum-csp-channel' } })

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_csp_violation_reported', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(alertMock).toHaveBeenCalledWith(
        'rum_csp_violation_reported',
        {
          // No matcher context: CSP observations are never matched against
          // inventory entries — the alert reports the violation as reported.
          observation: { kind: 'csp-violation', identity: 'script-src → https://evil.example.org/skim.js' },
          prevalence: { first_seen: 1755600000123 },
          first_route: '/checkout',
          targetType: 'detection',
          inventoryRef: 'abc1234',
        },
        deps.inventory.alerts,
      )
    })

    it('alerts with a threshold of 1 — a first sighting proves exactly one session', async () => {
      const { deps, alertMock } = makeDeps([], mockTarget, { cspViolationReported: { destination: 'rum-csp-channel' }, cspViolationReportedMinSessions: 1 })

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome.outcome).toBe('alerted')
      expect(alertMock).toHaveBeenCalledTimes(1)
    })

    it('gates to recorded — with an explicit gated reason in the outcome — when the threshold exceeds the available prevalence', async () => {
      // Honest semantics: first sightings carry no live session counters, so
      // any floor above 1 defers alerting to operator-driven re-evaluation.
      const { deps, alertMock } = makeDeps([], mockTarget, { cspViolationReported: { destination: 'rum-csp-channel' }, cspViolationReportedMinSessions: 5 })

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome.outcome).toBe('recorded')
      expect(outcome.category).toBe('rum_csp_violation_reported')
      expect(outcome.gatedReason).toContain('cspViolationReportedMinSessions=5')
      expect(outcome.gatedReason).toContain('first sightings carry no live counters')
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('surfaces a failed CSP alert delivery like any other category (still routed, failure flagged)', async () => {
      const { deps, alertMock } = makeDeps([], mockTarget, { cspViolationReported: { destination: 'rum-csp-channel' } })
      alertMock.mockRejectedValueOnce(new Error('slack is down'))

      const outcome = await routeMessage(normaliseMessage(queueMessage(cspObservation())), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_csp_violation_reported', alertDeliveryFailed: true })
    })

    it('leaves the script categories on their existing paths (activation is per category, not per block)', async () => {
      const { deps, alertMock } = makeDeps([], mockTarget, { cspViolationReported: { destination: 'rum-csp-channel' } })

      const outcome = await routeMessage(normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js'))), deps)

      expect(outcome.category).toBe('rum_uninventoried_script_detected')
      expect(alertMock.mock.calls[0]![0]).toBe('rum_uninventoried_script_detected')
    })
  })

  describe('alert delivery failure', () => {
    it('still routes and surfaces the failure in the outcome', async () => {
      const { deps, alertMock } = makeDeps([])
      alertMock.mockRejectedValueOnce(new Error('slack is down'))

      const outcome = await routeMessage(normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js'))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: true })
      expect(silentLogger.error).toHaveBeenCalled()
    })
  })

  describe('idempotency boundary', () => {
    // Cross-run idempotency belongs to the novelty store (a pk is enqueued
    // once per 90-day window); routing itself is stateless per message. What
    // routing owns is the run-level (pk, inventory ref) dedupe from the queue
    // contract, carried by the per-run `seen` set.
    it('suppresses a duplicate delivery of the same pk within one drain run', async () => {
      const { deps, alertMock } = makeDeps([])
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'), { novelty: { pk: '1.0#dup#h', first_seen: 1755600000123, first_route: '/checkout' } })

      const first = await routeMessage(normaliseMessage(message), deps)
      const second = await routeMessage(normaliseMessage(message), deps)

      expect(first.outcome).toBe('alerted')
      expect(second).toEqual({ drain: 'routed', outcome: 'duplicate-suppressed', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(deps.seen.has(rumDedupeKey('1.0#dup#h', 'abc1234'))).toBe(true)
    })

    it('produces two identical alert calls when the same message is routed in two separate runs', async () => {
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'))
      const runOne = makeDeps([])
      const runTwo = makeDeps([])

      await routeMessage(normaliseMessage(message), runOne.deps)
      await routeMessage(normaliseMessage(message), runTwo.deps)

      expect(runOne.alertMock).toHaveBeenCalledTimes(1)
      expect(runTwo.alertMock).toHaveBeenCalledTimes(1)
      expect(runTwo.alertMock.mock.calls[0]).toEqual(runOne.alertMock.mock.calls[0])
    })
  })

  describe('seen-set ordering (in-run redelivery must be able to retry)', () => {
    it('does not mark the dedupe key when routing throws, so an in-run redelivery still alerts', async () => {
      const { deps, alertMock } = makeDeps([])
      const real = deps.scriptComparison
      let calls = 0
      // First delivery blows up mid-routing (after the old code had already
      // marked the key seen); the queue redelivers within the same run.
      deps.scriptComparison = {
        compare: real.compare.bind(real),
        compareScriptEvidence: real.compareScriptEvidence.bind(real),
        identifyScript: (script, scripts) => {
          calls += 1
          if (calls === 1) throw new Error('transient comparison failure')
          return real.identifyScript(script, scripts)
        },
      }
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'), { novelty: { pk: '1.0#retry#h', first_seen: 1755600000123, first_route: '/checkout' } })

      await expect(routeMessage(normaliseMessage(message), deps)).rejects.toThrow('transient comparison failure')
      expect(deps.seen.has(rumDedupeKey('1.0#retry#h', 'abc1234'))).toBe(false)

      const second = await routeMessage(normaliseMessage(message), deps)

      expect(second.outcome).toBe('alerted')
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(deps.seen.has(rumDedupeKey('1.0#retry#h', 'abc1234'))).toBe(true)
    })

    it('does not mark the dedupe key when alert delivery failed, so an in-run redelivery retries the alert', async () => {
      const { deps, alertMock } = makeDeps([])
      alertMock.mockRejectedValueOnce(new Error('slack is down'))
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'), { novelty: { pk: '1.0#alert-retry#h', first_seen: 1755600000123, first_route: '/checkout' } })

      const first = await routeMessage(normaliseMessage(message), deps)
      expect(first).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: true })
      expect(deps.seen.has(rumDedupeKey('1.0#alert-retry#h', 'abc1234'))).toBe(false)

      const second = await routeMessage(normaliseMessage(message), deps)

      expect(second).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(2)
      expect(deps.seen.has(rumDedupeKey('1.0#alert-retry#h', 'abc1234'))).toBe(true)
    })
  })

  describe('inventory-pass messages (candidate lane, US3 / data-model §7)', () => {
    // The pass target as orchestration builds it: type 'inventory', and — like
    // every repository-built target — carrying a workflowId. The candidate
    // lane must strip that id (a RUM observation cannot prove its variation).
    const inventoryTarget: Target = {
      type: 'inventory',
      url: 'https://staging.example.com',
      workflowId: 'default',
      workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
      logger: silentLogger,
    }
    const hash = 'b'.repeat(64)
    const inventoryMessage = (observation: QueueMessage['observation']) => normaliseMessage(queueMessage(observation, { target_type: 'inventory' }))

    it('produces a pending candidate for a novel external staging script — routed, no alert, no DLQ', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(externalObservation('https://sandbox.newpay.example/sdk.js')), deps)

      expect(outcome.drain).toBe('routed')
      expect(outcome.outcome).toBe('candidate')
      expect(outcome.alertDeliveryFailed).toBe(false)
      expect(alertMock).not.toHaveBeenCalled()
      expect(outcome.candidate).toBeInstanceOf(UnknownScriptFound)
      expect(outcome.candidate!.script.name).toBe('https://sandbox.newpay.example/sdk.js')
      expect(outcome.candidate!.script.url).toBe('https://sandbox.newpay.example/sdk.js')
      // External bodies are opaque client-side (R8): the candidate honestly
      // carries no hash — InventoryService authorises it by exact name.
      expect(outcome.candidate!.script.hash).toBeUndefined()
    })

    it('strips the unprovable workflowId from the candidate target so the generated entry is not workflow-scoped', async () => {
      const { deps } = makeDeps([], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(externalObservation('https://sandbox.newpay.example/sdk.js')), deps)

      expect(outcome.candidate!.target.type).toBe('inventory')
      expect(outcome.candidate!.target.workflowId).toBeUndefined()
    })

    it('records an identified external script (identification-only, R8) without producing a candidate', async () => {
      const entry = inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')
      const authorizeSpy = jest.spyOn(entry.authoriseWith.matcher, 'authorize')
      const { deps, alertMock } = makeDeps([entry], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(externalObservation('https://cdn.example.com/known.js')), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(outcome.candidate).toBeUndefined()
      expect(alertMock).not.toHaveBeenCalled()
      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('suppresses a duplicate delivery within one drain run — a single candidate outcome', async () => {
      const { deps } = makeDeps([], inventoryTarget)
      const message = queueMessage(externalObservation('https://sandbox.newpay.example/sdk.js'), { target_type: 'inventory', novelty: { pk: '1.0#dup-inv#h', first_seen: 1755600000123, first_route: '/checkout' } })

      const first = await routeMessage(normaliseMessage(message), deps)
      const second = await routeMessage(normaliseMessage(message), deps)

      expect(first.outcome).toBe('candidate')
      expect(second).toEqual({ drain: 'routed', outcome: 'duplicate-suppressed', alertDeliveryFailed: false })
      expect(second.candidate).toBeUndefined()
      expect(deps.seen.has(rumDedupeKey('1.0#dup-inv#h', 'abc1234'))).toBe(true)
    })

    it('records an identified + authorised inline script (client-computed hash matches)', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^inline_script/rum:', [hash])], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(inlineObservation(hash)), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(outcome.candidate).toBeUndefined()
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('produces a candidate carrying the client-computed hash for an unidentified inline script', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(inlineObservation(hash)), deps)

      expect(outcome.outcome).toBe('candidate')
      expect(outcome.candidate!.script.name).toBe(`inline_script/rum:${hash}`)
      expect(outcome.candidate!.script.hash).toEqual({ value: hash })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('proposes a pending candidate instead of auto-authorising when an identified inline script fails authorisation', async () => {
      // The synthetic inventory pass would append the new hash to the
      // identified entry — a de facto authorisation. The RUM lane must not
      // (FR-012): the observation becomes an explicitly unauthorised candidate.
      const { deps, alertMock } = makeDeps([inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(inlineObservation(hash)), deps)

      expect(outcome.outcome).toBe('candidate')
      expect(outcome.candidate!.script.hash).toEqual({ value: hash })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('proposes a pending candidate for an identified inline script that carried no hash (no verifiable evidence)', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])], inventoryTarget)

      const outcome = await routeMessage(inventoryMessage(inlineObservation()), deps)

      expect(outcome.outcome).toBe('candidate')
      expect(outcome.candidate!.script.hash).toBeUndefined()
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('records — no candidate — a hash-less inline script positively authorised by an anchored window content matcher (T028)', async () => {
      // A covered oversize script must not mint a duplicate candidate on
      // every run: window authorisation counts as positive coverage.
      const longSource = `window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');console.log('checkout ready');`
      const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const entry: InventoryScriptInfo = {
        identifyWith: createMatcher({ nameMatcher: '^inline_script/rum:' }),
        authoriseWith: {
          matcher: createMatcher({ contentMatcher: `^${escapeRegex(longSource.slice(0, 64))}` }),
          authorisationInfo: { description: 'Anchored snippet entry', authorised: true, date: new Date() },
        },
      }
      const { deps, alertMock } = makeDeps([entry], inventoryTarget)
      const observation: QueueMessage['observation'] = {
        kind: 'inline-script',
        ts: 1755600000000,
        route: '/checkout',
        length: longSource.length,
        head: longSource.slice(0, 128),
        tail: longSource.slice(-128),
        oversize: true,
        initiator: 'https://pay.example.com/checkout',
      }

      const outcome = await routeMessage(inventoryMessage(observation), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(outcome.candidate).toBeUndefined()
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('records CSP observations without producing a candidate or an alert — even when the target opted in (detection-lane category, FR-012)', async () => {
      const { deps, alertMock } = makeDeps([], inventoryTarget, { cspViolationReported: { destination: 'rum-csp-channel' } })

      const outcome = await routeMessage(inventoryMessage({ kind: 'csp-violation', ts: 1755600000000, route: '/checkout', directive: 'script-src', blockedUri: 'https://evil.example.org/skim.js' }), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false })
      expect(outcome.candidate).toBeUndefined()
      expect(alertMock).not.toHaveBeenCalled()
    })
  })
})
