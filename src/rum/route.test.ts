import type { IAlertService } from '../interfaces/alert.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import type { SHA256Hash } from '../types/hash.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { QueueMessage } from './drain.js'
import { normaliseMessage } from './normalise.js'
import { routeDetectionMessage, rumDedupeKey, RumRouteDeps } from './route.js'

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

const makeInventory = (scripts: InventoryScriptInfo[]): Inventory => ({
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

const makeDeps = (scripts: InventoryScriptInfo[]) => {
  const { mock, service } = makeAlertService()
  const deps: RumRouteDeps = {
    scriptComparison: new ScriptComparisonService(),
    alertService: service,
    inventory: makeInventory(scripts),
    target: mockTarget,
    inventoryRef: 'abc1234',
    log: silentLogger,
    seen: new Set<string>(),
  }
  return { deps, alertMock: mock }
}

describe('routeDetectionMessage', () => {
  describe('external scripts (identification-only, research R8)', () => {
    it('alerts rum_uninventoried_script_detected with full context for an unknown external script', async () => {
      const { deps, alertMock } = makeDeps([inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])
      const normalised = normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js')))

      const outcome = await routeDetectionMessage(normalised, deps)

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

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(externalObservation('https://cdn.example.com/known.js'))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
      expect(authorizeSpy).not.toHaveBeenCalled()
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

        const outcome = await routeDetectionMessage(normalised, deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
        expect(alertMock).toHaveBeenCalledTimes(1)
      })

      it('identifies a legitimate first-party external script by its own URL — recorded, no alert', async () => {
        const { deps, alertMock } = makeDeps([firstPartyDomainTrust()])
        const normalised = normaliseMessage(queueMessage(externalObservation('https://pay.example.com/assets/app.js')))

        const outcome = await routeDetectionMessage(normalised, deps)

        expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
        expect(alertMock).not.toHaveBeenCalled()
      })

      it('still carries the initiator in the alert context (provenance from the rum context, not Matchable.url)', async () => {
        const { deps, alertMock } = makeDeps([firstPartyDomainTrust()])

        await routeDetectionMessage(normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js'))), deps)

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

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

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

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(alertMock.mock.calls[0]![0]).toBe('rum_uninventoried_script_detected')
    })

    it('records an identified inline script whose client-computed hash matches an authorised hash — no alert (evidence-aware, T029 pulled forward)', async () => {
      const entry = inventoryEntry('^inline_script/rum:', [hash])
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(inlineObservation(hash))), deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
    })

    it('fails secure for an identified inline script that carried no hash', async () => {
      const entry = inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])
      const { deps, alertMock } = makeDeps([entry])

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(inlineObservation())), deps)

      expect(outcome.outcome).toBe('alerted')
      expect(outcome.category).toBe('rum_mismatched_script_detected')
      const [, context] = alertMock.mock.calls[0] as [string, { failureReason?: string }]
      expect(context.failureReason).toContain('no hash')
    })
  })

  describe('csp violations', () => {
    it('records without alerting (category activates in phase 4 / T035)', async () => {
      const { deps, alertMock } = makeDeps([])
      const normalised = normaliseMessage(queueMessage({ kind: 'csp-violation', ts: 1755600000000, route: '/checkout', directive: 'script-src', blockedUri: 'https://evil.example.org/skim.js' }))

      const outcome = await routeDetectionMessage(normalised, deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded', category: 'rum_csp_violation_reported', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
    })
  })

  describe('alert delivery failure', () => {
    it('still routes and surfaces the failure in the outcome', async () => {
      const { deps, alertMock } = makeDeps([])
      alertMock.mockRejectedValueOnce(new Error('slack is down'))

      const outcome = await routeDetectionMessage(normaliseMessage(queueMessage(externalObservation('https://evil.example.org/skim.js'))), deps)

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

      const first = await routeDetectionMessage(normaliseMessage(message), deps)
      const second = await routeDetectionMessage(normaliseMessage(message), deps)

      expect(first.outcome).toBe('alerted')
      expect(second).toEqual({ drain: 'routed', outcome: 'duplicate-suppressed', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(deps.seen.has(rumDedupeKey('1.0#dup#h', 'abc1234'))).toBe(true)
    })

    it('produces two identical alert calls when the same message is routed in two separate runs', async () => {
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'))
      const runOne = makeDeps([])
      const runTwo = makeDeps([])

      await routeDetectionMessage(normaliseMessage(message), runOne.deps)
      await routeDetectionMessage(normaliseMessage(message), runTwo.deps)

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

      await expect(routeDetectionMessage(normaliseMessage(message), deps)).rejects.toThrow('transient comparison failure')
      expect(deps.seen.has(rumDedupeKey('1.0#retry#h', 'abc1234'))).toBe(false)

      const second = await routeDetectionMessage(normaliseMessage(message), deps)

      expect(second.outcome).toBe('alerted')
      expect(alertMock).toHaveBeenCalledTimes(1)
      expect(deps.seen.has(rumDedupeKey('1.0#retry#h', 'abc1234'))).toBe(true)
    })

    it('does not mark the dedupe key when alert delivery failed, so an in-run redelivery retries the alert', async () => {
      const { deps, alertMock } = makeDeps([])
      alertMock.mockRejectedValueOnce(new Error('slack is down'))
      const message = queueMessage(externalObservation('https://evil.example.org/skim.js'), { novelty: { pk: '1.0#alert-retry#h', first_seen: 1755600000123, first_route: '/checkout' } })

      const first = await routeDetectionMessage(normaliseMessage(message), deps)
      expect(first).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: true })
      expect(deps.seen.has(rumDedupeKey('1.0#alert-retry#h', 'abc1234'))).toBe(false)

      const second = await routeDetectionMessage(normaliseMessage(message), deps)

      expect(second).toEqual({ drain: 'routed', outcome: 'alerted', category: 'rum_uninventoried_script_detected', alertDeliveryFailed: false })
      expect(alertMock).toHaveBeenCalledTimes(2)
      expect(deps.seen.has(rumDedupeKey('1.0#alert-retry#h', 'abc1234'))).toBe(true)
    })
  })

  describe('inventory-pass messages (T031 stub)', () => {
    it('returns the recorded-pending stub without alerting or dead-lettering', async () => {
      const { deps, alertMock } = makeDeps([])
      const normalised = normaliseMessage(queueMessage(externalObservation('https://cdn.example.com/new.js'), { target_type: 'inventory' }))

      const outcome = await routeDetectionMessage(normalised, deps)

      expect(outcome).toEqual({ drain: 'routed', outcome: 'recorded-pending', alertDeliveryFailed: false })
      expect(alertMock).not.toHaveBeenCalled()
      expect(silentLogger.log).toHaveBeenCalledWith(expect.stringContaining('T031'))
    })
  })
})
