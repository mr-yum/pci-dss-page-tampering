/**
 * Trust inherited through loaders — pass 2 of the script comparison.
 *
 * Each fail-secure rule of `inheritAuthorisation` has its own test here, and
 * each was checked by breaking the rule in the code and watching its test
 * fail (see the transitive-trust section of AGENTS.md).
 */

import type { AuthorizedScriptFound, ComparisonResultType } from '../../types/comparison.js'
import type { SHA256Hash } from '../../types/hash.js'
import type { InitiatorHop } from '../../types/initiator-chain.js'
import type { Inventory } from '../../types/inventory/model.js'
import type { RawInventoryScriptInfo } from '../../types/inventory/raw.js'
import { RawInventoryScriptInfoSchema } from '../../types/inventory/zod.js'
import { createMatcher } from '../../types/matcher/matcher-factory.js'
import type { ScriptInfo } from '../../types/script.js'
import type { Target } from '../../types/target.js'
import { createSha256Hash } from '../../utils/hash.js'
import { createLogger } from '../../utils/logger.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../../utils/script.js'
import { ScriptInventoryService } from '../inventory.js'
import { ScriptComparisonService } from './script.js'

const target: Target = { type: 'detection', url: 'https://shop.example/pay', workflow: { fileName: 'w.json', definition: { steps: [] } }, logger: createLogger('test') }

const AUTHORISED = { description: 'Vendor SDK', authorised: true, date: '2026-10-01T00:00:00.000Z' }
// Readable labels in the tests, real SHA-256 values on the wire.
const h = (label: string): string => createSha256Hash(label).value
const hashes = (...labels: string[]) => labels.map((label) => ({ timestamp: '2026-10-01T00:00:00.000Z', hash: { value: h(label) } }))

const LOADER = 'https://js.vendor.example/v3/loader.js'
const MID = 'https://js.vendor.example/v3/mid.js'
const ASSET = 'https://assets.vendor.example/fraud.js'
const PAGE = 'https://shop.example/pay'

const script = (hop: InitiatorHop): InitiatorHop => hop
const s = (url: string): InitiatorHop => script({ url, kind: 'script' })
const page: InitiatorHop = { url: PAGE, kind: 'document' }

const external = (url: string, hash: string, chain?: InitiatorHop[], extra: Partial<ScriptInfo> = {}): ScriptInfo => ({
  source: { type: 'external', url, content: `/* ${url} */` },
  hash: { value: h(hash) } as SHA256Hash,
  ...(chain !== undefined ? { initiatorChain: chain } : {}),
  ...extra,
})

const entry = (raw: Omit<RawInventoryScriptInfo, 'authoriseWith'> & { authoriseWith?: RawInventoryScriptInfo['authoriseWith'] }) => {
  const parsed = RawInventoryScriptInfoSchema.parse({ authoriseWith: { hashes: hashes('loader-v1'), authorisationInfo: AUTHORISED }, ...raw })
  return rawInventoryScriptInfoToInventoryScriptInfo(parsed)
}

// Every grant needs a loadsMatching guard; this one admits any https load unless a test narrows it.
const ANY_HTTPS = { nameMatcher: '^https:' }
const loaderEntry = (grant: Partial<Pick<RawInventoryScriptInfo, 'authorisesLoads' | 'maxDepth' | 'loadsMatching'>> = { authorisesLoads: 'transitive' }) =>
  entry({ identifyWith: { nameMatcher: `^${LOADER.replaceAll('.', '\\.')}$` }, ...(grant.authorisesLoads !== undefined ? { loadsMatching: ANY_HTTPS } : {}), ...grant })

const inventory = (...scripts: ReturnType<typeof entry>[]): Inventory => ({
  fileName: 'shop.json',
  target: { inventory: { ...target, type: 'inventory' }, detection: target } as Inventory['target'],
  alerts: {
    inventory: { newScriptIdentified: { destination: '#i' }, newHeaderIdentified: { destination: '#i' } },
    detection: { newScriptDetected: { destination: '#d' }, scriptMismatchDetected: { destination: '#d' }, newHeaderDetected: { destination: '#d' } },
    successNotification: { destination: '#s' },
  },
  scripts,
  headers: [],
})

const compare = async (inv: Inventory, externalScripts: ScriptInfo[], inlineScripts: ScriptInfo[] = []): Promise<Map<string, ComparisonResultType>> => {
  const results = await new ScriptComparisonService().compare(target, inv, { externalScripts, inlineScripts })
  return new Map(results.filter((result) => 'script' in result).map((result) => [(result as { script: { name: string } }).script.name, result]))
}

describe('inherited authorisation (authorisesLoads)', () => {
  it('authorises an unknown script whose loader an authorised, granting entry authorised — citing the granting entry and the chain', async () => {
    const grant = loaderEntry()
    const results = await compare(inventory(grant), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s(LOADER), page])])
    const asset = results.get(ASSET) as AuthorizedScriptFound
    expect(asset.type).toBe('authorized_script')
    expect(asset.inventoryEntry).toBe(grant)
    expect(asset.inherited).toEqual({ from: LOADER, via: [s(LOADER)], mode: 'transitive' })
    expect(results.get(LOADER)?.type).toBe('authorized_script')
    expect((results.get(LOADER) as AuthorizedScriptFound).inherited).toBeUndefined()
  })

  it('reaches through intermediate loads up to the grant depth, and no further', async () => {
    const chain = [s(MID), s(LOADER), page]
    const observed = [external(LOADER, 'loader-v1', [page]), external(MID, 'mid', [s(LOADER), page]), external(ASSET, 'asset', chain)]

    expect((await compare(inventory(loaderEntry()), observed)).get(ASSET)?.type).toBe('authorized_script')
    expect((await compare(inventory(loaderEntry({ authorisesLoads: 'transitive', maxDepth: 2 })), observed)).get(ASSET)?.type).toBe('authorized_script')
    expect((await compare(inventory(loaderEntry({ authorisesLoads: 'transitive', maxDepth: 1 })), observed)).get(ASSET)?.type).toBe('unknown_script_found')
  })

  it('a direct grant covers only what the script inserted itself', async () => {
    const observed = [external(LOADER, 'loader-v1', [page]), external(MID, 'mid', [s(LOADER), page]), external(ASSET, 'asset', [s(MID), s(LOADER), page])]
    const results = await compare(inventory(loaderEntry({ authorisesLoads: 'direct' })), observed)
    expect(results.get(MID)?.type).toBe('authorized_script')
    expect(results.get(ASSET)?.type).toBe('unknown_script_found')
  })

  describe('fail-secure rules', () => {
    it('a mismatched root poisons its subtree: an identified but denied loader grants nothing', async () => {
      const results = await compare(inventory(loaderEntry()), [external(LOADER, 'tampered', [page]), external(ASSET, 'asset', [s(LOADER), page])])
      expect(results.get(LOADER)?.type).toBe('known_script_unauthorised_content')
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a mismatched root poisons its subtree even when another copy of it matched', async () => {
      // Two bodies at the loader URL: the walk cannot tell which one loaded the asset.
      const results = await compare(inventory(loaderEntry()), [external(LOADER, 'loader-v1', [page]), external(LOADER, 'tampered', [page]), external(ASSET, 'asset', [s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a denied intermediate poisons what is below it, whatever grants above it', async () => {
      const midEntry = entry({ identifyWith: { nameMatcher: `^${MID.replaceAll('.', '\\.')}$` }, authoriseWith: { hashes: hashes('mid-v1'), authorisationInfo: AUTHORISED } })
      const results = await compare(inventory(loaderEntry(), midEntry), [external(LOADER, 'loader-v1', [page]), external(MID, 'mid-tampered', [s(LOADER), page]), external(ASSET, 'asset', [s(MID), s(LOADER), page])])
      expect(results.get(MID)?.type).toBe('known_script_unauthorised_content')
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('an explicit verdict beats inheritance: a load the inventory identifies and denies stays denied', async () => {
      const assetEntry = entry({ identifyWith: { nameMatcher: `^${ASSET.replaceAll('.', '\\.')}$` }, authoriseWith: { hashes: hashes('asset-v1'), authorisationInfo: AUTHORISED } })
      const results = await compare(inventory(loaderEntry(), assetEntry), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset-tampered', [s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('known_script_unauthorised_content')
    })

    it('a broken chain stops inheritance: nothing past an unknown hop inherits', async () => {
      const results = await compare(inventory(loaderEntry()), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [{ url: MID, kind: 'unknown' }, s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a missing chain inherits nothing', async () => {
      const results = await compare(inventory(loaderEntry()), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset')])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a hop to a script absent from this comparison stops inheritance', async () => {
      const results = await compare(inventory(loaderEntry()), [external(ASSET, 'asset', [s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('an absent intermediate is not crossed to reach a grant further out', async () => {
      // MID is named as the inserter but was never observed (or sits in the other payment scope).
      const results = await compare(inventory(loaderEntry()), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s(MID), s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('an unvouched-for intermediate cuts its loads off from a grant further out', async () => {
      // The mid script is outside the guard, so it does not inherit; its own load must not inherit past it.
      const guarded = loaderEntry({ authorisesLoads: 'transitive', loadsMatching: { nameMatcher: '^https://assets\\.vendor\\.example/' } })
      const results = await compare(inventory(guarded), [external(LOADER, 'loader-v1', [page]), external(MID, 'mid', [s(LOADER), page]), external(ASSET, 'asset', [s(MID), s(LOADER), page])])
      expect(results.get(MID)?.type).toBe('unknown_script_found')
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('passes through an intermediate that is itself authorised', async () => {
      const midEntry = entry({ identifyWith: { nameMatcher: `^${MID.replaceAll('.', '\\.')}$` }, authoriseWith: { hashes: hashes('mid-v1'), authorisationInfo: AUTHORISED } })
      const results = await compare(inventory(loaderEntry(), midEntry), [external(LOADER, 'loader-v1', [page]), external(MID, 'mid-v1', [s(LOADER), page]), external(ASSET, 'asset', [s(MID), s(LOADER), page])])
      expect((results.get(ASSET) as AuthorizedScriptFound).inherited?.from).toBe(LOADER)
    })

    it('treats a grant that reached the comparison without a guard (built outside validation) as no grant', async () => {
      const unguarded = loaderEntry({})
      unguarded.authorisesLoads = { mode: 'transitive', maxDepth: 8 }
      const results = await compare(inventory(unguarded), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it("judges the guard on the load's own evidence: a host guard never admits an inline load on its initiator's word", async () => {
      const inline: ScriptInfo = {
        source: { type: 'inline', id: 'inline_script/id_not_found', content: 'skim()', instances: [{ token: 'k1-9', kind: 'script', inserterToken: null }], url: LOADER },
        hash: { value: h('skim') } as SHA256Hash,
        initiatorChain: [s(LOADER), page],
      }
      const hostGuard = loaderEntry({ authorisesLoads: 'transitive', loadsMatching: { hostMatcher: '^js\\.vendor\\.example$' } })
      const results = await compare(inventory(hostGuard), [external(LOADER, 'loader-v1', [page]), external(MID, 'mid', [s(LOADER), page])], [inline])
      expect(results.get(MID)?.type).toBe('authorized_script')
      expect(results.get('inline_script/id_not_found')?.type).toBe('unknown_script_found')
    })

    it('honours the loadsMatching guard', async () => {
      const guarded = loaderEntry({ authorisesLoads: 'transitive', loadsMatching: { nameMatcher: '^https://assets\\.vendor\\.example/' } })
      const elsewhere = 'https://cdn.other.example/x.js'
      const results = await compare(inventory(guarded), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s(LOADER), page]), external(elsewhere, 'x', [s(LOADER), page])])
      expect(results.get(ASSET)?.type).toBe('authorized_script')
      expect(results.get(elsewhere)?.type).toBe('unknown_script_found')
    })

    it('an authorised loader with no grant vouches for nothing', async () => {
      const results = await compare(inventory(loaderEntry({})), [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s(LOADER), page])])
      expect(results.get(LOADER)?.type).toBe('authorized_script')
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a document hop grants nothing', async () => {
      const results = await compare(inventory(loaderEntry()), [external(ASSET, 'asset', [{ url: LOADER, kind: 'document' }])])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('an inline script never grants, even under an authorised granting entry', async () => {
      const boot: ScriptInfo = {
        source: { type: 'inline', id: 'inline_script/boot', content: 'boot()', instances: [{ token: 'k1-1', kind: 'parser', inserterToken: null }], url: PAGE },
        hash: { value: h('boot') } as SHA256Hash,
        initiatorChain: [page],
      }
      const bootEntry = entry({ identifyWith: { contentMatcher: '^boot' }, authoriseWith: { hashes: hashes('boot'), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive', loadsMatching: ANY_HTTPS })
      const results = await compare(inventory(bootEntry), [external(ASSET, 'asset', [s('inline_script/boot#k1-1'), page])], [boot])
      expect(results.get('inline_script/boot')?.type).toBe('authorized_script')
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a script an entry identifies never inherits, even when it reached pass 2 as unknown (empty content)', async () => {
      const assetEntry = entry({ identifyWith: { nameMatcher: `^${ASSET.replaceAll('.', '\\.')}$` }, authoriseWith: { hashes: hashes('asset-v1'), authorisationInfo: AUTHORISED } })
      const empty = external(ASSET, 'asset', [s(LOADER), page])
      if (empty.source.type === 'external') empty.source.content = ''
      const results = await compare(inventory(loaderEntry(), assetEntry), [external(LOADER, 'loader-v1', [page]), empty])
      expect(results.get(ASSET)?.type).toBe('unknown_script_found')
    })

    it('a cycle in the evidence cannot vouch for itself', async () => {
      const a = 'https://cdn.example/a.js'
      const b = 'https://cdn.example/b.js'
      const results = await compare(inventory(loaderEntry()), [external(a, 'a', [s(b), s(a)]), external(b, 'b', [s(a), s(b)])])
      expect(results.get(a)?.type).toBe('unknown_script_found')
      expect(results.get(b)?.type).toBe('unknown_script_found')
    })
  })

  it('inherits along any recorded path when the walk forked', async () => {
    const results = await compare(inventory(loaderEntry()), [
      external(LOADER, 'loader-v1', [page]),
      external(MID, 'mid', [{ url: 'https://elsewhere.example/x.js', kind: 'unknown' }]),
      external(ASSET, 'asset', [s(MID), { url: 'https://elsewhere.example/x.js', kind: 'unknown' }], { alternateInitiatorChains: [[s(MID), s(LOADER), page]] }),
    ])
    // The mid script itself has only the broken path, so it does not inherit —
    // and the asset's alternate path crosses it, so the asset does not either.
    expect(results.get(MID)?.type).toBe('unknown_script_found')
    expect(results.get(ASSET)?.type).toBe('unknown_script_found')

    const forked = await compare(inventory(loaderEntry()), [
      external(LOADER, 'loader-v1', [page]),
      external(MID, 'mid', [s(LOADER), page], { alternateInitiatorChains: [[{ url: 'https://elsewhere.example/x.js', kind: 'unknown' }]] }),
      external(ASSET, 'asset', [s(MID), { url: 'https://elsewhere.example/x.js', kind: 'unknown' }], { alternateInitiatorChains: [[s(MID), s(LOADER), page]] }),
    ])
    expect(forked.get(MID)?.type).toBe('authorized_script')
    expect(forked.get(ASSET)?.type).toBe('authorized_script')
  })

  it('passes through an inline hop that an entry authorised on its content — the inline script itself never inherits', async () => {
    const inline: ScriptInfo = {
      source: { type: 'inline', id: 'inline_script/id_not_found', content: 'var s=document.createElement("script")', instances: [{ token: 'k1-7', kind: 'script', inserterToken: null }], url: LOADER },
      hash: { value: h('inline') } as SHA256Hash,
      initiatorChain: [s(LOADER), page],
    }
    const observed = [external(LOADER, 'loader-v1', [page]), external(ASSET, 'asset', [s('inline_script/id_not_found#k1-7'), s(LOADER), page])]

    // Inserted by the granting loader, but an inline load never inherits — so
    // nothing it inserted can reach the grant either.
    const ungranted = await compare(inventory(loaderEntry()), observed, [inline])
    expect(ungranted.get('inline_script/id_not_found')?.type).toBe('unknown_script_found')
    expect(ungranted.get(ASSET)?.type).toBe('unknown_script_found')

    // Authorised by an entry of its own, it carries the walk to the grant.
    const inlineEntry = entry({ identifyWith: { contentMatcher: '^var s=document\\.createElement\\("script"\\)$' }, authoriseWith: { hashes: hashes('inline'), authorisationInfo: AUTHORISED } })
    const results = await compare(inventory(loaderEntry(), inlineEntry), observed, [inline])
    expect((results.get('inline_script/id_not_found') as AuthorizedScriptFound).inherited).toBeUndefined()
    expect((results.get(ASSET) as AuthorizedScriptFound).inherited?.via.map((hop) => hop.url)).toEqual(['inline_script/id_not_found#k1-7', LOADER])
  })

  describe('inline loads never inherit', () => {
    // What a page that overrides the shim's built-ins (WeakMap.prototype.get/has)
    // can make the shim report for an inline script it inserted itself: an
    // insertion "by" the granting loader, under any element id it likes.
    const forged = (id: string): ScriptInfo => ({
      source: { type: 'inline', id, content: 'exfiltrate(document.forms)', instances: [{ token: 'forged-1', kind: 'script', inserterToken: null }], url: LOADER },
      hash: { value: h('payload') } as SHA256Hash,
      initiatorChain: [s(LOADER), page],
    })

    it('refuses a forged inline load even under a guard that would admit it by name and by content (built outside validation)', async () => {
      const grant = loaderEntry()
      grant.authorisesLoads = { mode: 'transitive', maxDepth: 8, loadsMatching: createMatcher({ orMatcher: [{ nameMatcher: '^inline_script/' }, { contentMatcher: 'exfiltrate' }] }) }
      const results = await compare(inventory(grant), [external(LOADER, 'loader-v1', [page])], [forged('inline_script/vendor-config')])
      expect(results.get(LOADER)?.type).toBe('authorized_script')
      expect(results.get('inline_script/vendor-config')?.type).toBe('unknown_script_found')
    })
  })

  describe('an entry pending review or declined is a standing verdict a grant cannot override', () => {
    const NEW = 'https://assets.vendor.example/new.js'
    const pendingEntry = (description: string) =>
      entry({ identifyWith: { nameMatcher: `^${NEW.replaceAll('.', '\\.')}$` }, authoriseWith: { nameMatcher: `^${NEW.replaceAll('.', '\\.')}$`, authorisationInfo: { ...AUTHORISED, description, authorised: false } } })

    it.each(['NO_DESCRIPTION', 'Declined: not needed on the payment page'])('a script identified only by an unauthorised entry (%s) stays unknown under a granting loader', async (description) => {
      const results = await compare(inventory(loaderEntry(), pendingEntry(description)), [external(LOADER, 'loader-v1', [page]), external(NEW, 'new', [s(LOADER), page])])
      expect(results.get(NEW)?.type).toBe('unknown_script_found')
      // Without the pending entry, the same load inherits.
      expect((await compare(inventory(loaderEntry()), [external(LOADER, 'loader-v1', [page]), external(NEW, 'new', [s(LOADER), page])])).get(NEW)?.type).toBe('authorized_script')
    })

    it('so detection alerts on it, and the inventory pass sees it as already covered by the pending entry', async () => {
      const inv = inventory(loaderEntry(), pendingEntry('NO_DESCRIPTION'))
      const observed = { externalScripts: [external(LOADER, 'loader-v1', [page]), external(NEW, 'new', [s(LOADER), page])], inlineScripts: [] }
      const unknownNames = (results: ComparisonResultType[]) => results.filter((result) => result.type === 'unknown_script_found').map((result) => (result as { script: { name: string } }).script.name)
      expect(unknownNames(await new ScriptComparisonService().compare(target, inv, observed))).toEqual([NEW])

      const inventoryPass = await new ScriptComparisonService().compare({ ...target, type: 'inventory' }, inv, observed)
      expect(unknownNames(inventoryPass)).toEqual([NEW])
      const diff = await new ScriptInventoryService({ inventoryRepository: {} as never }).diff(inv, inventoryPass)
      expect(diff.appliedResults).toEqual([])
      expect(diff.newInventory.scripts).toHaveLength(2)
    })
  })
})

describe('authorisesLoads validation', () => {
  it('refuses a grant on an entry that is not authorised', () => {
    const result = RawInventoryScriptInfoSchema.safeParse({
      identifyWith: { nameMatcher: '^x$' },
      authoriseWith: { hashes: hashes('h'), authorisationInfo: { ...AUTHORISED, authorised: false } },
      authorisesLoads: 'transitive',
      loadsMatching: ANY_HTTPS,
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('authorisesLoads requires an authorised entry')
  })

  it('refuses a grant on an array-syntax entry whose first alternative is not authorised', () => {
    const result = RawInventoryScriptInfoSchema.safeParse({
      identifyWith: { nameMatcher: '^x$' },
      authoriseWith: [{ hashes: hashes('h'), authorisationInfo: { ...AUTHORISED, authorised: false } }],
      authorisesLoads: 'direct',
      loadsMatching: ANY_HTTPS,
    })
    expect(result.success).toBe(false)
  })

  it('refuses maxDepth and loadsMatching without a grant, maxDepth with a direct grant, and depths outside 1..8', () => {
    const base = { identifyWith: { nameMatcher: '^x$' }, authoriseWith: { hashes: hashes('h'), authorisationInfo: AUTHORISED } }
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, maxDepth: 2 }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, loadsMatching: { nameMatcher: '^x' } }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, authorisesLoads: 'direct', maxDepth: 1, loadsMatching: ANY_HTTPS }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, authorisesLoads: 'transitive', maxDepth: 0, loadsMatching: ANY_HTTPS }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, authorisesLoads: 'transitive', maxDepth: 9, loadsMatching: ANY_HTTPS }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, authorisesLoads: 'sideways', loadsMatching: ANY_HTTPS }).success).toBe(false)
    expect(RawInventoryScriptInfoSchema.safeParse({ ...base, authorisesLoads: 'transitive', maxDepth: 8, loadsMatching: { nameMatcher: '^https://' } }).success).toBe(true)
  })

  it('refuses a grant without a loadsMatching guard', () => {
    const result = RawInventoryScriptInfoSchema.safeParse({ identifyWith: { nameMatcher: '^x$' }, authoriseWith: { hashes: hashes('h'), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive' })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('authorisesLoads requires loadsMatching')
  })

  describe('the guard must judge the load itself', () => {
    const base = { identifyWith: { nameMatcher: '^x$' }, authoriseWith: { hashes: hashes('h'), authorisationInfo: AUTHORISED }, authorisesLoads: 'transitive' }
    const issues = (loadsMatching: unknown): string => {
      const result = RawInventoryScriptInfoSchema.safeParse({ ...base, loadsMatching })
      return result.success ? '' : JSON.stringify(result.error.issues)
    }

    it.each([
      ['a workflowMatcher alone', { workflowMatcher: '.*' }],
      ['a targetTypeMatcher alone', { targetTypeMatcher: '^detection$' }],
      ['an initiatorHostMatcher alone (the guard never sees the initiator)', { initiatorHostMatcher: '^js\\.vendor\\.example$' }],
      ['an andMatcher of run metadata only', { andMatcher: [{ workflowMatcher: '^checkout$' }, { targetTypeMatcher: '^detection$' }] }],
      ['an orMatcher with a run-metadata alternative', { orMatcher: [{ nameMatcher: '^https://js\\.vendor\\.example/' }, { workflowMatcher: '^checkout$' }] }],
    ])('refuses %s', (_label, loadsMatching) => {
      expect(issues(loadsMatching)).toContain('loadsMatching must judge the loaded script on its own evidence')
    })

    it.each([
      ['a nameMatcher', { nameMatcher: '^https://js\\.vendor\\.example/' }],
      ['a urlMatcher', { urlMatcher: '^https://js\\.vendor\\.example/' }],
      ['a hostMatcher', { hostMatcher: '^js\\.vendor\\.example$' }],
      ['a hash list', { hashes: hashes('asset') }],
      ['an andMatcher narrowing a nameMatcher to one workflow', { andMatcher: [{ nameMatcher: '^https://js\\.vendor\\.example/' }, { workflowMatcher: '^checkout$' }] }],
    ])('accepts %s', (_label, loadsMatching) => {
      expect(issues(loadsMatching)).toBe('')
    })

    it.each([
      ['the inline prefix', { nameMatcher: '^inline_script/' }],
      ['one inline name', { nameMatcher: '^inline_script/vendor-config$' }],
      ['a pattern that admits any name', { nameMatcher: '.*' }],
      ['an inline alternative beside a URL', { orMatcher: [{ nameMatcher: '^https://js\\.vendor\\.example/' }, { nameMatcher: '^inline_script/' }] }],
    ])('refuses a guard that admits inline scripts: %s', (_label, loadsMatching) => {
      expect(issues(loadsMatching)).toContain('loadsMatching must not admit inline scripts')
    })

    it('refuses a headerNameMatcher: script URLs are case-sensitive', () => {
      expect(issues({ headerNameMatcher: '^x$' })).toContain('headerNameMatcher is not valid in loadsMatching')
      expect(issues({ orMatcher: [{ nameMatcher: '^https://' }, { headerNameMatcher: '^x$' }] })).toContain('headerNameMatcher is not valid in loadsMatching')
    })
  })

  it('refuses an invalid regex in loadsMatching', () => {
    const result = RawInventoryScriptInfoSchema.safeParse({ identifyWith: { nameMatcher: '^x$' }, authoriseWith: { hashes: hashes('h'), authorisationInfo: AUTHORISED }, authorisesLoads: 'direct', loadsMatching: { nameMatcher: '([' } })
    expect(result.success).toBe(false)
  })
})

// Not inheritance, but its sibling: trust that passes through a vendor's frame
// document. The comparison must hand the matcher the frame the browser loaded
// the script into, or a `document` hop could never be bound.
describe('scripts loaded inside a vendor frame (initiatorHostMatcher kinds: ["document"])', () => {
  const FRAME = 'https://pay.vendor.example/frame'
  const CAPTCHA = 'https://cdn.captcha.example/c.js'
  const inVendorFrames = { host: '^([a-z0-9-]+\\.)*vendor\\.example$', transitive: true as const, kinds: ['document' as const] }
  const ownUrl = { nameMatcher: '^(https|blob:https):\\/\\/([a-z0-9-]+\\.)*(vendor\\.example|captcha\\.example)\\/' }
  // The README's pattern: identify and authorise on the frame document AND the script's own URL.
  const framedEntry = () => entry({ identifyWith: { andMatcher: [{ initiatorHostMatcher: inVendorFrames }, ownUrl] }, authoriseWith: { andMatcher: [{ initiatorHostMatcher: inVendorFrames }, ownUrl], authorisationInfo: AUTHORISED } })
  const loadedIn = (frameUrl: string | null, chain: InitiatorHop[] = [s(LOADER), { url: FRAME, kind: 'document' }]): ScriptInfo => {
    const base = external(CAPTCHA, 'captcha', chain)
    return frameUrl === null ? base : { ...base, source: { ...(base.source as { type: 'external'; url: string; content: string }), frameUrl } }
  }

  it('identifies and authorises a script the browser loaded into the vendor frame', async () => {
    expect((await compare(inventory(framedEntry()), [loadedIn(FRAME)])).get(CAPTCHA)?.type).toBe('authorized_script')
  })

  it('leaves the same chain unknown when the script was loaded into the page, or into no known frame', async () => {
    expect((await compare(inventory(framedEntry()), [loadedIn(PAGE)])).get(CAPTCHA)?.type).toBe('unknown_script_found')
    expect((await compare(inventory(framedEntry()), [loadedIn(null)])).get(CAPTCHA)?.type).toBe('unknown_script_found')
  })
})
