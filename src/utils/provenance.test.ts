/**
 * Unit tests for the provenance resolver.
 *
 * Every test builds an inventory from a raw JSON string, runs a real comparison
 * through the real comparison service, and then asserts both the JSON pointer
 * *and* that the reported line/column actually lands on the expected token in
 * that string. Asserting the pointer alone would not catch a position index
 * that is subtly off, and asserting the line alone would not catch a pointer
 * built from the wrong syntax.
 *
 * @see ./provenance.ts
 * @see ./json-position.ts
 */

import { HeaderComparisonService } from '../services/comparison/header.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import type { ComparisonResultType } from '../types/comparison.js'
import type { HeaderDetectionSummary } from '../types/header.js'
import type { Inventory } from '../types/inventory/model.js'
import type { RawInventory } from '../types/inventory/raw.js'
import { RawInventorySchema } from '../types/inventory/zod.js'
import type { ScriptDetectionSummary, ScriptInfo } from '../types/script.js'
import type { Target, TargetDetection, TargetInventory } from '../types/target.js'
import { rawInventoryHeaderInfoToInventoryHeaderInfo } from './inventory.js'
import { buildJsonPositionIndex } from './json-position.js'
import { createLogger } from './logger.js'
import { createProvenanceResolver, type ProvenanceNode, type SourceProvenance } from './provenance.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from './script.js'

describe('createProvenanceResolver', () => {
  const SCRIPT_URL = 'https://cdn.example.com/analytics.js'
  const SCRIPT_BODY = 'window.analytics=1'
  // SHA-256 of SCRIPT_BODY, computed once and reused so fixtures stay consistent.
  const SCRIPT_HASH = 'e9f2bd0a5cbb56cdbd0dbc0a0f8a4fe10cb4a0eaeb64bcbcbf7f0a3a5f0f2b64'
  const OTHER_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

  const workflow = { fileName: 'test-workflow.json', definition: { steps: [] } }

  const target: Target = {
    type: 'detection',
    workflowId: 'checkout',
    url: 'https://checkout.example.com/pay',
    workflow,
    logger: createLogger('provenance-test'),
  }

  const inventoryTarget: TargetInventory = { type: 'inventory', workflowId: 'checkout', url: 'https://staging.example.test/pay', workflow, logger: createLogger('provenance-test') }
  const detectionTarget: TargetDetection = { type: 'detection', workflowId: 'checkout', url: 'https://checkout.example.com/pay', workflow, logger: createLogger('provenance-test') }

  const alerts = {
    inventory: { newScriptIdentified: { destination: 'c' }, newHeaderIdentified: { destination: 'c' } },
    detection: { newScriptDetected: { destination: 'c' }, scriptMismatchDetected: { destination: 'c' }, newHeaderDetected: { destination: 'c' } },
    successNotification: { destination: 'c' },
  }

  /**
   * Build an Inventory from raw JSON text exactly as the repository does, and
   * attach the text as `source` so provenance can be resolved against it.
   */
  const buildInventory = (text: string): Inventory => {
    const raw: RawInventory = RawInventorySchema.parse(JSON.parse(text))

    return {
      fileName: 'targets.json',
      target: { inventory: inventoryTarget, detection: detectionTarget },
      alerts,
      scripts: raw.scripts.map(rawInventoryScriptInfoToInventoryScriptInfo),
      headers: (raw.headers ?? []).map(rawInventoryHeaderInfoToInventoryHeaderInfo),
      source: { file: 'targets/example.json', text },
    }
  }

  /** Assert a resolved location lands on text starting with `expected`. */
  const expectLocationShows = (text: string, location: SourceProvenance, expected: string): void => {
    const line = text.split('\n')[location.line - 1]

    expect(line).toBeDefined()
    expect(line!.slice(location.column - 1, location.column - 1 + expected.length)).toBe(expected)
  }

  const scriptSummary = (overrides: Partial<ScriptInfo> = {}): ScriptDetectionSummary => ({
    externalScripts: [
      {
        source: { type: 'external', url: SCRIPT_URL, content: SCRIPT_BODY },
        hash: { value: SCRIPT_HASH },
        ...overrides,
      } as ScriptInfo,
    ],
    inlineScripts: [],
  })

  const compareScripts = async (inventory: Inventory, summary = scriptSummary()): Promise<ComparisonResultType[]> => new ScriptComparisonService().compare(target, inventory, summary)

  const compareHeaders = async (inventory: Inventory, name: string, value: string): Promise<ComparisonResultType[]> => {
    const summary: HeaderDetectionSummary = { headers: new Map([[name, new Map([[value, new Set(['https://checkout.example.com/pay'])]])]]) }

    return new HeaderComparisonService().compare(target, inventory, summary)
  }

  /** The single authorising leaf, for the many cases that have exactly one. */
  const deepestChild = (node: ProvenanceNode): ProvenanceNode => (node.children && node.children.length === 1 ? deepestChild(node.children[0]!) : node)

  const scriptEntry = (authoriseWith: string): string =>
    `{
  "target": { "inventory": { "type": "inventory", "url": "https://staging.example.test/pay", "workflow": "w.json" }, "detection": { "type": "detection", "url": "https://checkout.example.com/pay", "workflow": "w.json" } },
  "alerts": { "inventory": { "newScriptIdentified": { "destination": "c" }, "newHeaderIdentified": { "destination": "c" } }, "detection": { "newScriptDetected": { "destination": "c" }, "scriptMismatchDetected": { "destination": "c" }, "newHeaderDetected": { "destination": "c" } }, "successNotification": { "destination": "c" } },
  "scripts": [
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\\\.example\\\\.com/analytics\\\\.js$" },
      "authoriseWith": ${authoriseWith}
    }
  ],
  "headers": []
}`

  describe('when the inventory has no retained source text', () => {
    it('returns null rather than guessing', () => {
      const inventory = buildInventory(
        scriptEntry(`{ "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }], "authorisationInfo": { "description": "d", "authorised": true, "date": "2025-10-01T00:00:00.000Z" } }`),
      )
      const { source, ...withoutSource } = inventory

      expect(source).toBeDefined()
      expect(createProvenanceResolver(withoutSource)).toBeNull()
    })
  })

  describe('single hash matcher', () => {
    const text = scriptEntry(`{
        "hashes": [
          { "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } },
          { "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }
        ],
        "authorisationInfo": { "description": "Analytics v2", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      }`)

    it('points at the specific hash element that authorised the script', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)

      expect(result!.type).toBe('authorized_script')

      const provenance = resolve(result!)!

      expect(provenance.entry.pointer).toBe('/scripts/0')
      expect(provenance.identifyWith.pointer).toBe('/scripts/0/identifyWith')
      expect(provenance.authoriseWith.pointer).toBe('/scripts/0/authoriseWith')
      expect(provenance.authorisedBy?.matcherType).toBe('hash')
      expect(provenance.authorisedBy?.authorisationInfo?.description).toBe('Analytics v2')

      // The matching hash is the SECOND element, so the pointer must say so.
      expect(deepestChild(provenance.authorisedBy!).pointer).toBe('/scripts/0/authoriseWith/hashes/1')
    })

    it('reports a line and column that lands on the hash entry in the file', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!

      expectLocationShows(text, deepestChild(provenance.authorisedBy!), '{ "timestamp": "2025-10-02')
      expectLocationShows(text, provenance.entry, '{')
      expectLocationShows(text, provenance.identifyWith, '{ "nameMatcher"')
    })
  })

  describe('array syntax', () => {
    const text = scriptEntry(`[
        { "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }], "authorisationInfo": { "description": "Version 1", "authorised": true, "date": "2025-10-01T00:00:00.000Z" } },
        { "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }, { "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }], "authorisationInfo": { "description": "Version 2", "authorised": true, "date": "2025-10-02T00:00:00.000Z" } }
      ]`)

    it('addresses the winning alternative positionally, without an orMatcher segment', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!

      expect(provenance.authorisedBy?.matcherType).toBe('or')
      expect(provenance.authorisedBy?.children).toHaveLength(1)

      const alternative = provenance.authorisedBy!.children![0]!

      expect(alternative.pointer).toBe('/scripts/0/authoriseWith/1')
      expect(deepestChild(alternative).pointer).toBe('/scripts/0/authoriseWith/1/hashes/1')
    })

    it('reads the authorisation description from the winning alternative, not the entry', async () => {
      // processAuthorizeWith copies element[0]'s authorisationInfo up to the
      // entry level, so the entry-level description says "Version 1" while the
      // alternative that actually authorised says "Version 2". Reporting the
      // entry-level value here would misattribute the authorisation.
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!

      expect(inventory.scripts[0]!.authoriseWith.authorisationInfo.description).toBe('Version 1')
      expect(provenance.authorisedBy!.children![0]!.authorisationInfo?.description).toBe('Version 2')
    })
  })

  describe('orMatcher object syntax', () => {
    const text = scriptEntry(`{
        "orMatcher": [
          { "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }] },
          { "hashes": [{ "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }] }
        ],
        "authorisationInfo": { "description": "Either build", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      }`)

    it('includes the orMatcher segment, which array syntax omits', async () => {
      // Both syntaxes load into an identical OrMatcher, so this pointer can only
      // be produced by reading the raw file — inference would emit
      // `/scripts/0/authoriseWith/1` and send an auditor to the wrong place.
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!

      const alternative = provenance.authorisedBy!.children![0]!

      expect(alternative.pointer).toBe('/scripts/0/authoriseWith/orMatcher/1')
      expect(deepestChild(alternative).pointer).toBe('/scripts/0/authoriseWith/orMatcher/1/hashes/0')
      expectLocationShows(text, alternative, '{ "hashes"')
    })
  })

  describe('andMatcher with a workflow-scoped hash', () => {
    const text = scriptEntry(`[
        {
          "andMatcher": [
            { "workflowMatcher": "^checkout$" },
            { "hashes": [{ "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }] }
          ],
          "authorisationInfo": { "description": "Checkout build", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
        }
      ]`)

    it('reports every conjunct, because an AND has no single authorising leaf', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!

      const andNode = provenance.authorisedBy!.children![0]!

      expect(andNode.matcherType).toBe('and')
      expect(andNode.pointer).toBe('/scripts/0/authoriseWith/0')
      expect(andNode.children?.map((child) => child.pointer)).toEqual(['/scripts/0/authoriseWith/0/andMatcher/0', '/scripts/0/authoriseWith/0/andMatcher/1'])
      expect(andNode.children?.map((child) => child.matcherType)).toEqual(['workflow', 'hash'])

      const hashConjunct = andNode.children![1]!

      expect(hashConjunct.children?.[0]?.pointer).toBe('/scripts/0/authoriseWith/0/andMatcher/1/hashes/0')
      expectLocationShows(text, hashConjunct, '{ "hashes"')
    })
  })

  describe('unauthorised and unknown results', () => {
    const text = scriptEntry(`{
        "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }],
        "authorisationInfo": { "description": "Pinned build", "authorised": true, "date": "2025-10-01T00:00:00.000Z" }
      }`)

    it('resolves the entry for a known script whose content is unauthorised', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)

      expect(result!.type).toBe('known_script_unauthorised_content')

      const provenance = resolve(result!)!

      expect(provenance.entry.pointer).toBe('/scripts/0')
      // Nothing authorised it, so there is no authorising node to point at.
      expect(provenance.authorisedBy).toBeNull()
      expect(provenance.unresolvedReason).toBeDefined()
    })

    it('returns null for an unknown script, which has no inventory entry at all', async () => {
      const inventory = buildInventory(
        scriptEntry(`{ "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "${OTHER_HASH}" } }], "authorisationInfo": { "description": "d", "authorised": true, "date": "2025-10-01T00:00:00.000Z" } }`),
      )
      const resolve = createProvenanceResolver(inventory)!
      const summary: ScriptDetectionSummary = {
        externalScripts: [{ source: { type: 'external', url: 'https://evil.example.test/skim.js', content: 'steal()' }, hash: { value: OTHER_HASH } } as ScriptInfo],
        inlineScripts: [],
      }
      const [result] = await new ScriptComparisonService().compare(target, inventory, summary)

      expect(result!.type).toBe('unknown_script_found')
      expect(resolve(result!)).toBeNull()
    })
  })

  describe('headers', () => {
    const text = `{
  "target": { "inventory": { "type": "inventory", "url": "https://staging.example.test/pay", "workflow": "w.json" }, "detection": { "type": "detection", "url": "https://checkout.example.com/pay", "workflow": "w.json" } },
  "alerts": { "inventory": { "newScriptIdentified": { "destination": "c" }, "newHeaderIdentified": { "destination": "c" } }, "detection": { "newScriptDetected": { "destination": "c" }, "scriptMismatchDetected": { "destination": "c" }, "newHeaderDetected": { "destination": "c" } }, "successNotification": { "destination": "c" } },
  "scripts": [],
  "headers": [
    {
      "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
      "authoriseWith": {
        "andMatcher": [
          { "contentMatcher": "default-src 'self'" },
          { "contentMatcher": "object-src 'none'" }
        ],
        "authorisationInfo": { "description": "CSP requires both directives", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      }
    }
  ]
}`

    it('resolves a header entry through the same replay path as scripts', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const results = await compareHeaders(inventory, 'content-security-policy', "default-src 'self'; object-src 'none'")
      const authorized = results.find((result) => result.type === 'authorized_header')

      expect(authorized).toBeDefined()

      const provenance = resolve(authorized!)!

      expect(provenance.entry.pointer).toBe('/headers/0')
      expect(provenance.authorisedBy?.matcherType).toBe('and')
      expect(provenance.authorisedBy?.children?.map((child) => child.pointer)).toEqual(['/headers/0/authoriseWith/andMatcher/0', '/headers/0/authoriseWith/andMatcher/1'])
      expectLocationShows(text, provenance.authorisedBy!.children![1]!, `{ "contentMatcher": "object-src 'none'" }`)
    })
  })

  describe('fail-safe behaviour', () => {
    const text = scriptEntry(`{
        "hashes": [{ "timestamp": "2025-10-02T00:00:00.000Z", "hash": { "value": "${SCRIPT_HASH}" } }],
        "authorisationInfo": { "description": "Pinned", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }
      }`)

    it('refuses to resolve a result against a different inventory instance', async () => {
      // Stands in for the pre/post-diff mistake: the diff rebuilds mutated
      // entries, so the result's entry is no longer in the array by identity.
      // Guessing an index here would cite the wrong authorisation.
      const inventory = buildInventory(text)
      const [result] = await compareScripts(inventory)
      const rebuilt = buildInventory(text)
      const resolve = createProvenanceResolver(rebuilt)!

      expect(resolve(result!)).toBeNull()
    })

    it('refuses to resolve when the retained text does not match the loaded matchers', async () => {
      const inventory = buildInventory(text)
      const [result] = await compareScripts(inventory)

      // Same entry, but the retained text now describes a different structure.
      const drifted: Inventory = {
        ...inventory,
        source: { file: 'targets/example.json', text: scriptEntry(`{ "contentMatcher": "analytics", "authorisationInfo": { "description": "d", "authorised": true, "date": "2025-10-02T00:00:00.000Z" } }`) },
      }
      const provenance = createProvenanceResolver(drifted)!(result!)!

      expect(provenance.authorisedBy).toBeNull()
      expect(provenance.unresolvedReason).toBe('inventory file structure did not match the matcher that ran')
    })

    it('returns null when the retained text is not valid JSON', () => {
      const inventory = buildInventory(text)

      expect(createProvenanceResolver({ ...inventory, source: { file: 'targets/example.json', text: '{ not json' } })).toBeNull()
    })

    it('produces pointers that resolve in the position index', async () => {
      const inventory = buildInventory(text)
      const resolve = createProvenanceResolver(inventory)!
      const [result] = await compareScripts(inventory)
      const provenance = resolve(result!)!
      const index = buildJsonPositionIndex(text)

      const collect = (node: ProvenanceNode): string[] => [node.pointer, ...(node.children ?? []).flatMap(collect)]

      for (const pointer of [provenance.entry.pointer, provenance.identifyWith.pointer, provenance.authoriseWith.pointer, ...collect(provenance.authorisedBy!)]) {
        expect(index.has(pointer)).toBe(true)
      }
    })
  })
})
