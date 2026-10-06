/**
 * Initiator chains on the RUM lane (beacon v2): normalisation binds the
 * agent's chain, URL-only observations are judged on URL evidence where the
 * entry's authoriser allows it, and an ancestor judged on URL evidence can
 * vouch for what it loads. Each fail-secure rule has its own test.
 */

import type { IAlertService } from '../interfaces/alert.js'
import { rumAlertContextLines } from '../services/alert/rum.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import type { InitiatorHop } from '../types/initiator-chain.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import type { RawInventoryScriptInfo } from '../types/inventory/raw.js'
import { RawInventoryScriptInfoSchema } from '../types/inventory/zod.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { Target } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script.js'
import type { QueueMessage } from './drain.js'
import { normaliseMessage } from './normalise.js'
import { routeMessage, type RumRouteDeps } from './route.js'
import { consumesOnlyUrlEvidence, inheritOnUrlEvidence } from './url-evidence.js'

const log: Logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
const target: Target = { type: 'detection', url: 'https://pay.example.com/checkout', workflow: { fileName: 'w.json', definition: { steps: [] } }, logger: log }
const AUTHORISED = { description: 'Vendor', authorised: true, date: '2026-10-01T00:00:00.000Z' }
const HASH = 'a'.repeat(64)

const PAGE = 'https://pay.example.com/checkout'
const MAIN = 'https://pay.example.com/assets/main.js'
const SDK = 'https://js.vendor.example/v3/sdk.js'
const ASSET = 'https://assets.vendor.example/fraud.js'
// The agent never emits a `document` hop: the page is where every chain ends,
// as an `unknown` hop (no currentScript, or an inserter it never saw inserted).
const page: InitiatorHop = { url: PAGE, kind: 'unknown' }
const s = (url: string): InitiatorHop => ({ url, kind: 'script' })

const entry = (raw: Partial<RawInventoryScriptInfo>): InventoryScriptInfo => rawInventoryScriptInfoToInventoryScriptInfo(RawInventoryScriptInfoSchema.parse(raw))
const exact = (url: string): string => `^${url.replaceAll('.', '\\.').replaceAll('/', '\\/')}$`
/** The vendor SDK, authorised by URL (it ships continuously), vouching for vendor-hosted loads. */
const sdkByUrl = (grant: Partial<RawInventoryScriptInfo> = { authorisesLoads: 'transitive', loadsMatching: { nameMatcher: '^https:\\/\\/[a-z.]*vendor\\.example\\/' } }) =>
  entry({ identifyWith: { nameMatcher: exact(SDK) }, authoriseWith: { urlMatcher: exact(SDK), authorisationInfo: AUTHORISED }, ...grant })
const sdkByHash = () =>
  entry({
    identifyWith: { nameMatcher: exact(SDK) },
    authoriseWith: { hashes: [{ timestamp: '2026-10-01T00:00:00.000Z', hash: { value: HASH } }], authorisationInfo: AUTHORISED },
    authorisesLoads: 'transitive',
    loadsMatching: { nameMatcher: '^https:' },
  })

const inventory = (scripts: InventoryScriptInfo[]): Inventory => ({
  fileName: 't.json',
  target: { inventory: { ...target, type: 'inventory' }, detection: target } as Inventory['target'],
  alerts: {
    inventory: { newScriptIdentified: { destination: '#i' }, newHeaderIdentified: { destination: '#i' } },
    detection: { newScriptDetected: { destination: '#d' }, scriptMismatchDetected: { destination: '#m' }, newHeaderDetected: { destination: '#d' } },
    successNotification: { destination: '#s' },
  },
  scripts,
  headers: [],
})

const message = (observation: QueueMessage['observation'], targetType: 'inventory' | 'detection' = 'detection'): QueueMessage => ({
  v: 1,
  target_id: '1.0',
  target_type: targetType,
  observation,
  novelty: { pk: `1.0#${Math.random()}`, first_seen: 1755600000123, first_route: '/checkout' },
  received_at: 1755600000500,
  session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
})
const external = (url: string, initiatorChain?: InitiatorHop[]): QueueMessage['observation'] => ({
  kind: 'external-script',
  ts: 1755600000000,
  route: '/checkout',
  url,
  ...(initiatorChain !== undefined ? { initiator: initiatorChain[0]!.url.startsWith('inline_script/') ? PAGE : initiatorChain[0]!.url, initiatorChain } : {}),
})

const route = async (scripts: InventoryScriptInfo[], observation: QueueMessage['observation'], targetType: 'inventory' | 'detection' = 'detection') => {
  const alert = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined)
  const deps: RumRouteDeps = {
    scriptComparison: new ScriptComparisonService(),
    alertService: { alertForRumObservation: alert } as unknown as IAlertService,
    inventory: inventory(scripts),
    target,
    inventoryRef: 'abc1234',
    log,
    seen: new Set(),
  }
  const outcome = await routeMessage(normaliseMessage(message(observation, targetType)), deps)
  return { outcome: outcome.outcome, category: alert.mock.calls[0]?.[0], context: alert.mock.calls[0]?.[1] as Record<string, unknown> | undefined, candidate: outcome.candidate }
}

describe('normalisation (beacon v2)', () => {
  it('binds the agent chain onto the matchable for external and inline observations', () => {
    const chain = [s(SDK), page]
    expect(normaliseMessage(message(external(ASSET, chain))).kind === 'script' && normaliseMessage(message(external(ASSET, chain)))).toMatchObject({ matchable: { initiatorChain: chain } })
    const inline = normaliseMessage(message({ kind: 'inline-script', ts: 1, route: '/', length: 3, head: 'x()', tail: 'x()', initiator: SDK, initiatorChain: chain }))
    expect(inline).toMatchObject({ matchable: { initiatorChain: chain, initiator: SDK } })
  })
})

describe('URL-evidence authorisation of identification-only observations', () => {
  it('knows which authorisers a URL can satisfy, and refuses a mixed one', () => {
    expect(consumesOnlyUrlEvidence(createMatcher({ urlMatcher: '^x' }))).toBe(true)
    expect(consumesOnlyUrlEvidence(createMatcher({ andMatcher: [{ hostMatcher: '^x' }, { initiatorHostMatcher: '^y' }, { targetTypeMatcher: '^detection$' }] }))).toBe(true)
    expect(consumesOnlyUrlEvidence(createMatcher({ orMatcher: [{ urlMatcher: '^x' }, { hashes: [{ timestamp: new Date(), hash: { value: HASH } }] }] }))).toBe(false)
    expect(consumesOnlyUrlEvidence(createMatcher({ workflowMatcher: '^checkout$' }))).toBe(false)
    expect(consumesOnlyUrlEvidence(createMatcher({ contentMatcher: 'x' }))).toBe(false)
  })

  it('records an external script its URL authoriser accepts', async () => {
    expect((await route([sdkByUrl({})], external(SDK, [page]))).outcome).toBe('recorded')
  })

  it('alerts mismatched when a URL-only authoriser denies the observed evidence', async () => {
    const pinned = entry({ identifyWith: { nameMatcher: exact(SDK) }, authoriseWith: { initiatorHostMatcher: '^pay\\.example\\.com$', authorisationInfo: AUTHORISED } })
    const result = await route([pinned], external(SDK, [s('https://evil.example/loader.js'), page]))
    expect(result.category).toBe('rum_mismatched_script_detected')
    expect(result.context?.['failureReason']).toContain("initiator host 'evil.example'")
  })

  it('keeps an entry whose authoriser needs a hash identification-only: recorded, never a false mismatch', async () => {
    expect((await route([sdkByHash()], external(SDK, [page]))).outcome).toBe('recorded')
  })

  it('records, never proposes, on the inventory pass when a URL authoriser denies: a new candidate would sit behind the identifying entry', async () => {
    const pinned = entry({ identifyWith: { nameMatcher: exact(SDK) }, authoriseWith: { initiatorHostMatcher: '^pay\\.example\\.com$', authorisationInfo: AUTHORISED } })
    expect((await route([pinned], external(SDK, [s('https://evil.example/loader.js'), page]), 'inventory')).outcome).toBe('recorded')
  })

  describe('a transitive initiatorHostMatcher limited to document hops (a synthetic-lane control)', () => {
    const FRAME = 'https://pay.vendor.example/frame'
    const docHops = { host: '^([a-z0-9-]+\\.)*vendor\\.example$', transitive: true as const, kinds: ['document' as const] }

    it('is never URL evidence: no beacon can bind a document hop, so it cannot be evaluated', () => {
      expect(consumesOnlyUrlEvidence(createMatcher({ initiatorHostMatcher: docHops }))).toBe(false)
      const observed = normaliseMessage(message(external(SDK, [s(MAIN), page])))
      if (observed.kind !== 'script') throw new Error('expected a script observation')
      expect(consumesOnlyUrlEvidence(createMatcher({ initiatorHostMatcher: docHops }), observed.matchable)).toBe(false)
      expect(consumesOnlyUrlEvidence(createMatcher({ andMatcher: [{ nameMatcher: '^https:' }, { initiatorHostMatcher: docHops }] }))).toBe(false)
      // Script hops the agent does report: evaluable, as before kinds existed.
      expect(consumesOnlyUrlEvidence(createMatcher({ initiatorHostMatcher: { ...docHops, kinds: ['script'] } }))).toBe(true)
      expect(consumesOnlyUrlEvidence(createMatcher({ initiatorHostMatcher: { ...docHops, kinds: ['script', 'document'] } }))).toBe(true)
      expect(consumesOnlyUrlEvidence(createMatcher({ initiatorHostMatcher: { host: docHops.host, transitive: true } }))).toBe(true)
    })

    it('leaves an entry that authorises with it identification-only: recorded, never a false mismatch', async () => {
      const framed = entry({ identifyWith: { nameMatcher: exact(SDK) }, authoriseWith: { andMatcher: [{ initiatorHostMatcher: docHops }, { nameMatcher: '^https:' }], authorisationInfo: AUTHORISED } })
      const result = await route([framed], external(SDK, [s(MAIN), page]))
      expect(result.outcome).toBe('recorded')
      expect(result.category).toBeUndefined()
    })

    it('never identifies a real-user observation, even one whose beacon claims a document hop on the vendor host', async () => {
      const framed = entry({ identifyWith: { andMatcher: [{ initiatorHostMatcher: docHops }, { nameMatcher: '^https:\\/\\/([a-z0-9-]+\\.)*vendor\\.example\\/' }] }, authoriseWith: { nameMatcher: '^https:', authorisationInfo: AUTHORISED } })
      // The beacon schema accepts a `document` hop the agent never produces: a page-authored claim.
      const claimed = await route([framed], external(ASSET, [{ url: FRAME, kind: 'document' }]))
      expect(claimed.category).toBe('rum_uninventoried_script_detected')
      expect((await route([framed], external(ASSET, [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })
  })

  it('does not judge an initiator-host authoriser when the first hop is unknown (the agent fell back to the page URL)', async () => {
    const pinned = entry({ identifyWith: { nameMatcher: exact(SDK) }, authoriseWith: { initiatorHostMatcher: '^js\\.vendor\\.example$', authorisationInfo: AUTHORISED } })
    expect((await route([pinned], external(SDK, [{ url: PAGE, kind: 'unknown' }]))).outcome).toBe('recorded')
    expect((await route([pinned], external(SDK))).outcome).toBe('recorded')
  })
})

describe('inheritance on the RUM lane', () => {
  it('records an unknown script an ancestor authorised on URL evidence vouches for', async () => {
    expect((await route([sdkByUrl()], external(ASSET, [s(SDK), page]))).outcome).toBe('recorded')
  })

  it('records it on the inventory pass too, instead of proposing a candidate', async () => {
    expect((await route([sdkByUrl()], external(ASSET, [s(SDK), page]), 'inventory')).outcome).toBe('recorded')
  })

  it('never applies to inline observations, even under a guard that would admit one by its content', async () => {
    const grant = sdkByUrl({ authorisesLoads: 'direct', loadsMatching: { orMatcher: [{ nameMatcher: '^https:\\/\\/[a-z.]*vendor\\.example\\/' }, { contentMatcher: '^x\\(\\)$' }] } })
    const inline = { kind: 'inline-script' as const, ts: 1, route: '/', length: 3, head: 'x()', tail: 'x()', initiator: SDK, initiatorChain: [s(SDK), page] }
    expect((await route([grant], inline)).category).toBe('rum_uninventoried_script_detected')
    expect((await route([grant], inline, 'inventory')).outcome).toBe('candidate')
    // And the walk itself refuses one, whoever calls it.
    const normalised = normaliseMessage(message(inline))
    if (normalised.kind !== 'script') throw new Error('expected a script observation')
    expect(inheritOnUrlEvidence(normalised.matchable, [grant], (ancestor) => new ScriptComparisonService().identifyScript(ancestor, [grant]))).toBeNull()
  })

  it('never overrides an entry pending review or declined: the observation keeps alerting, and the inventory pass proposes it to the existing flow', async () => {
    const pending = entry({ identifyWith: { nameMatcher: exact(ASSET) }, authoriseWith: { nameMatcher: exact(ASSET), authorisationInfo: { ...AUTHORISED, description: 'NO_DESCRIPTION', authorised: false } } })
    expect((await route([sdkByUrl(), pending], external(ASSET, [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    expect((await route([sdkByUrl(), pending], external(ASSET, [s(SDK), page]), 'inventory')).outcome).toBe('candidate')
    expect((await route([sdkByUrl()], external(ASSET, [s(SDK), page]))).outcome).toBe('recorded')
  })

  describe('fail-secure rules', () => {
    it('an ancestor that can only be judged on a hash grants nothing (identification is not authorisation)', async () => {
      expect((await route([sdkByHash()], external(ASSET, [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it('an ancestor whose authoriser mixes URL and hash alternatives grants nothing: the URL alone cannot show it authorised', async () => {
      const mixed = entry({
        identifyWith: { nameMatcher: exact(SDK) },
        authoriseWith: [
          { urlMatcher: exact(SDK), authorisationInfo: AUTHORISED },
          { hashes: [{ timestamp: '2026-10-01T00:00:00.000Z', hash: { value: HASH } }], authorisationInfo: AUTHORISED },
        ],
        authorisesLoads: 'transitive',
        loadsMatching: { nameMatcher: '^https:' },
      })
      expect((await route([mixed], external(ASSET, [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it("a guard on hosts never admits an inline load: an inline script's url is only who claims to have inserted it", async () => {
      const hostGuard = sdkByUrl({ authorisesLoads: 'direct', loadsMatching: { hostMatcher: '^js\\.vendor\\.example$' } })
      const skimmer = { kind: 'inline-script' as const, ts: 1, route: '/', length: 9, head: 'skim(c)()', tail: 'skim(c)()', initiator: SDK, initiatorChain: [s(SDK), page] }
      expect((await route([hostGuard], skimmer)).category).toBe('rum_uninventoried_script_detected')
    })

    it("never takes an unknown hop as an ancestor's initiator", async () => {
      const pinnedSdk = entry({
        identifyWith: { nameMatcher: exact(SDK) },
        authoriseWith: { andMatcher: [{ urlMatcher: exact(SDK) }, { initiatorHostMatcher: '^pay\\.example\\.com$' }], authorisationInfo: AUTHORISED },
        authorisesLoads: 'transitive',
        loadsMatching: { nameMatcher: '^https:' },
      })
      // The SDK sits on the page (an unknown hop): nothing shows who loaded it.
      expect((await route([pinnedSdk], external(ASSET, [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
      // The page's own bundle inserted it: that hop is evidence.
      expect((await route([pinnedSdk], external(ASSET, [s(SDK), s(MAIN), page]))).outcome).toBe('recorded')
    })

    it('an inline hop never grants, even when an entry would identify and authorise its identity', async () => {
      const inlineGranter = entry({
        identifyWith: { nameMatcher: '^inline_script\\/' },
        authoriseWith: { nameMatcher: '^inline_script\\/', authorisationInfo: AUTHORISED },
        authorisesLoads: 'transitive',
        loadsMatching: { nameMatcher: '^https:' },
      })
      expect((await route([inlineGranter], external(ASSET, [s('inline_script/rum#3'), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it('an ancestor its URL authoriser denies grants nothing', async () => {
      const pinned = sdkByUrl({ authorisesLoads: 'transitive', loadsMatching: { nameMatcher: '^https:' } })
      pinned.authoriseWith.matcher = createMatcher({ andMatcher: [{ urlMatcher: exact(SDK) }, { initiatorHostMatcher: '^pay\\.example\\.com$' }] })
      const result = await route([pinned], external(ASSET, [s(SDK), s('https://evil.example/loader.js'), page]))
      expect(result.category).toBe('rum_uninventoried_script_detected')
    })

    it('the loadsMatching guard decides: a load outside it is alerted', async () => {
      expect((await route([sdkByUrl()], external('https://evil.example/skim.js', [s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it('an inline hop carries no evidence and ends the walk', async () => {
      expect((await route([sdkByUrl()], external(ASSET, [s('inline_script/rum#3'), s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it('a broken chain stops inheritance; no chain inherits nothing', async () => {
      expect((await route([sdkByUrl()], external(ASSET, [{ url: SDK, kind: 'unknown' }, page]))).category).toBe('rum_uninventoried_script_detected')
      expect((await route([sdkByUrl()], external(ASSET))).category).toBe('rum_uninventoried_script_detected')
    })

    it('a direct grant reaches one hop only', async () => {
      const MID = 'https://assets.vendor.example/mid.js'
      const mid = entry({ identifyWith: { nameMatcher: exact(MID) }, authoriseWith: { urlMatcher: exact(MID), authorisationInfo: AUTHORISED } })
      const direct = sdkByUrl({ authorisesLoads: 'direct', loadsMatching: { nameMatcher: '^https:' } })
      expect((await route([direct, mid], external(ASSET, [s(MID), s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
      const transitive = sdkByUrl({ authorisesLoads: 'transitive', loadsMatching: { nameMatcher: '^https:' } })
      expect((await route([transitive, mid], external(ASSET, [s(MID), s(SDK), page]))).outcome).toBe('recorded')
    })

    it('an unidentified intermediate is not crossed', async () => {
      expect((await route([sdkByUrl()], external(ASSET, [s('https://cdn.other.example/x.js'), s(SDK), page]))).category).toBe('rum_uninventoried_script_detected')
    })

    it('an identified, denied observation never inherits', async () => {
      const pinnedAsset = entry({ identifyWith: { nameMatcher: exact(ASSET) }, authoriseWith: { urlMatcher: '^https:\\/\\/never\\.example\\/', authorisationInfo: AUTHORISED } })
      expect((await route([sdkByUrl(), pinnedAsset], external(ASSET, [s(SDK), page]))).category).toBe('rum_mismatched_script_detected')
    })
  })

  it('carries the chain in rum_* alert context as a "loaded by" line', async () => {
    const result = await route([], external('https://evil.example/skim.js', [s(`${SDK}?k=secret`), page]))
    expect(result.context?.['initiatorChain']).toEqual([s(`${SDK}?k=secret`), page])
    const lines = rumAlertContextLines('rum_uninventoried_script_detected', result.context as never)
    const loadedBy = lines.find((line) => line.label === 'Loaded by')
    expect(loadedBy?.value).toBe(`${SDK} ← ${PAGE} (unverified)`)
    expect(lines.find((line) => line.label === 'Initiator')?.value).toBe(SDK)
    expect(JSON.stringify(lines)).not.toContain('secret')
  })
})
