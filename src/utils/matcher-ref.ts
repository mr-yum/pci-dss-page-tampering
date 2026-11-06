/**
 * Shared matcher definitions (`shared/matchers.json`) and `{ "matcherRef" }`.
 *
 * The contract, end to end:
 *
 * - **Load** — `expandMatcherRefs` replaces every `{ "matcherRef": "x" }` node
 *   in a target file with a deep copy of definition `x` *before* Zod runs, so
 *   every schema refinement (the `loadsMatching` guard, the inline-name
 *   probes, the header `requiredOn` checks) and every consumer after it —
 *   comparison, alerts, RUM, the inventory diff, the commit counter — sees an
 *   ordinary matcher config. Nothing downstream knows refs exist.
 * - **Write-back** — `collapseMatcherRefs` runs at the final file write only.
 *   Each recorded ref site is written back as the ref when the serialised
 *   node at that site — or, after the update wrapped a single-matcher
 *   `authoriseWith` into array syntax, under its first element — still equals
 *   the definition put through the same serialiser. By value, because the
 *   diff rebuilds matcher instances from raw; at the recorded site only, so an
 *   inline copy elsewhere (the inventory pass writes inline
 *   `workflowMatcher` scopes beside every alternative it appends) is never
 *   turned into a ref that would start following edits to the definition. A
 *   ref whose subtree the tool changed (e.g. a hash appended inside a shared
 *   hash list) cannot collapse; it is written inline — visible in the
 *   inventory PR — and a warning names the site, so a shared definition is
 *   never edited by automation.
 *
 * Definitions are pure matching logic: neither `authorisationInfo` nor a
 * nested `matcherRef` may appear anywhere inside one. Approval belongs to the
 * entry that uses it, written at the ref site — `{ "matcherRef": "x",
 * "authorisationInfo": {...} }` — and lands on the root of the expansion.
 */
import { z } from 'zod'

import { MatcherConfigSchema } from '../types/inventory/matcher-config-schema.js'
import type { InventoryMatcherRefs, MatcherRefSite, SharedMatchers } from '../types/inventory/matcher-ref.js'
import type { RawInventory } from '../types/inventory/raw.js'
import type { Matcher } from '../types/matcher/matcher.interface.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { headerMatcherToRawConfig } from './inventory.js'
import { decodeJsonPointerSegment, encodeJsonPointerSegment } from './json-position.js'
import { scriptMatcherToRawConfig } from './script.js'

const MATCHER_REF_NAME = /^[a-z0-9][a-z0-9._-]*$/u

const SharedMatchersFileSchema = z
  .object({
    matchers: z.record(
      z.string().regex(MATCHER_REF_NAME, 'Shared matcher names must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens'),
      z
        .object({
          description: z.string().min(1, 'description must not be empty'),
          matcher: MatcherConfigSchema,
        })
        .strict(),
    ),
  })
  .strict()

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/** First `authorisationInfo` / `matcherRef` key inside a definition, as a pointer suffix. */
function forbiddenKeyIn(node: unknown, pointer: string): { key: string; pointer: string } | null {
  if (Array.isArray(node)) {
    for (const [index, child] of node.entries()) {
      const found = forbiddenKeyIn(child, `${pointer}/${index}`)
      if (found !== null) return found
    }
    return null
  }
  if (!isJsonObject(node)) return null
  for (const [key, child] of Object.entries(node)) {
    if (key === 'authorisationInfo' || key === 'matcherRef') return { key, pointer: `${pointer}/${encodeJsonPointerSegment(key)}` }
    const found = forbiddenKeyIn(child, `${pointer}/${encodeJsonPointerSegment(key)}`)
    if (found !== null) return found
  }
  return null
}

/**
 * Parse and validate the shared file.
 *
 * The definitions are kept as raw JSON, not as Zod output: expansion must
 * produce exactly what an author writing the matcher inline would have
 * written, and Zod's output has hash timestamps already coerced to `Date`.
 */
export function parseSharedMatchers(text: string, file: string): SharedMatchers {
  const json: unknown = JSON.parse(text)

  if (isJsonObject(json) && isJsonObject(json['matchers'])) {
    for (const [name, definition] of Object.entries(json['matchers'])) {
      const found = isJsonObject(definition) ? forbiddenKeyIn(definition['matcher'], `/matchers/${encodeJsonPointerSegment(name)}/matcher`) : null
      if (found !== null) {
        throw new Error(
          found.key === 'authorisationInfo'
            ? `${file}: shared matcher "${name}" carries authorisationInfo at ${found.pointer}. Definitions are matching logic only; approval belongs to the entry that uses one — write it at the ref site: { "matcherRef": "${name}", "authorisationInfo": {...} }.`
            : `${file}: shared matcher "${name}" contains a matcherRef at ${found.pointer}. A definition cannot reference another definition.`,
        )
      }
    }
  }

  SharedMatchersFileSchema.parse(json)

  const definitions = (json as { matchers: SharedMatchers['definitions'] }).matchers

  return { file, text, definitions }
}

function refNameOf(node: JsonObject, pointer: string, file: string): string {
  const extraKeys = Object.keys(node).filter((key) => key !== 'matcherRef' && key !== 'authorisationInfo')
  if (extraKeys.length > 0) {
    throw new Error(`${file}: matcherRef at ${pointer} has unexpected key(s) ${extraKeys.map((key) => `"${key}"`).join(', ')}. A ref carries only "matcherRef" and, where the entry needs it, "authorisationInfo".`)
  }
  const name = node['matcherRef']
  if (typeof name !== 'string' || name.length === 0) throw new Error(`${file}: matcherRef at ${pointer} must be a non-empty string.`)
  return name
}

/**
 * Replace every `{ "matcherRef" }` in a target file's `scripts` and `headers`
 * with a deep copy of its definition, recording where each one was.
 *
 * Fails loudly — naming the target file, the pointer and the shared file — on
 * an unknown name or a ref with no shared file: a ref that silently resolved
 * to nothing would leave an entry that can never match.
 */
export function expandMatcherRefs(json: unknown, shared: SharedMatchers | undefined, file: string): { expanded: unknown; sites: MatcherRefSite[] } {
  const sites: MatcherRefSite[] = []

  if (!isJsonObject(json)) return { expanded: json, sites }

  const expand = (node: unknown, pointer: string, collection: MatcherRefSite['collection'], entryIndex: number): unknown => {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${pointer}/${index}`, collection, entryIndex))
    if (!isJsonObject(node)) return node

    if ('matcherRef' in node) {
      const name = refNameOf(node, pointer, file)
      if (shared === undefined) {
        throw new Error(`${file}: matcherRef "${name}" at ${pointer} cannot be resolved: the inventory repository has no shared matcher file (shared/matchers.json).`)
      }
      const definition = Object.hasOwn(shared.definitions, name) ? shared.definitions[name] : undefined
      if (definition === undefined) {
        const known = Object.keys(shared.definitions).sort()
        throw new Error(`${file}: matcherRef "${name}" at ${pointer} is not defined in ${shared.file} (defined: ${known.length === 0 ? 'none' : known.join(', ')}).`)
      }
      sites.push({ collection, entryIndex, pointer, name })
      const copy = structuredClone(definition.matcher) as JsonObject
      return 'authorisationInfo' in node ? { ...copy, authorisationInfo: node['authorisationInfo'] } : copy
    }

    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, expand(child, `${pointer}/${encodeJsonPointerSegment(key)}`, collection, entryIndex)]))
  }

  const expanded: JsonObject = { ...json }
  for (const collection of ['scripts', 'headers'] as const) {
    const entries = json[collection]
    if (Array.isArray(entries)) expanded[collection] = entries.map((entry, entryIndex) => expand(entry, `/${collection}/${entryIndex}`, collection, entryIndex))
  }

  return { expanded, sites }
}

/**
 * Point a schema failure inside an expanded ref at the ref.
 *
 * Zod reports paths into the expanded tree (`/scripts/3/authoriseWith/andMatcher/1`)
 * while the file only says `{ "matcherRef": "x" }` there; without this note a
 * reader would look for a node that is not in the file.
 */
export function annotateMatcherRefIssues(error: unknown, sites: readonly MatcherRefSite[], shared: SharedMatchers | undefined): unknown {
  if (!(error instanceof z.ZodError) || sites.length === 0) return error

  const notes = new Set<string>()
  for (const issue of error.issues) {
    const pointer = issue.path.length === 0 ? '' : `/${issue.path.map((segment) => encodeJsonPointerSegment(String(segment))).join('/')}`
    for (const site of sites) {
      if (pointer === site.pointer || pointer.startsWith(`${site.pointer}/`)) {
        notes.add(`issue at ${pointer} is inside matcherRef "${site.name}" (written at ${site.pointer}, defined in ${shared?.file ?? 'shared/matchers.json'})`)
      }
    }
  }

  return notes.size === 0 ? error : new Error(`${error.message}\n${[...notes].join('\n')}`, { cause: error })
}

/** Names defined in the shared file that no site in any loaded target uses. */
export function unusedSharedMatchers(shared: SharedMatchers, sites: readonly MatcherRefSite[]): string[] {
  const used = new Set(sites.map((site) => site.name))
  return Object.keys(shared.definitions)
    .filter((name) => !used.has(name))
    .sort()
}

/** Key-order-independent JSON form; Dates become ISO strings exactly as JSON.stringify writes them. */
function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort)
    if (!isJsonObject(node)) return node
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .map((key) => [key, sort(node[key])]),
    )
  }
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))))
}

function nodeAt(root: unknown, pointer: string): { parent: JsonObject | unknown[]; key: string } | null {
  if (pointer === '') return null
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => decodeJsonPointerSegment(segment))
  let parent: unknown = root
  for (const segment of segments.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent[Number(segment)] : isJsonObject(parent) ? parent[segment] : undefined
    if (parent === undefined) return null
  }
  return Array.isArray(parent) || isJsonObject(parent) ? { parent, key: segments[segments.length - 1]! } : null
}

function valueAt(root: unknown, pointer: string): unknown {
  const location = nodeAt(root, pointer)
  if (location === null) return undefined
  return Array.isArray(location.parent) ? location.parent[Number(location.key)] : location.parent[location.key]
}

/** The node at `pointer` is a matcher config equal to `canonical`, ignoring its own `authorisationInfo`. */
function matchesAt(root: unknown, pointer: string, canonical: string): boolean {
  const node = valueAt(root, pointer)
  if (!isJsonObject(node)) return false
  const { authorisationInfo: _authorisationInfo, ...matcherPart } = node
  return canonicalJson(matcherPart) === canonical
}

function replaceAt(root: unknown, pointer: string, replace: (node: JsonObject) => JsonObject): void {
  const location = nodeAt(root, pointer)
  if (location === null) return
  if (Array.isArray(location.parent)) location.parent[Number(location.key)] = replace(location.parent[Number(location.key)] as JsonObject)
  else location.parent[location.key] = replace(location.parent[location.key] as JsonObject)
}

/**
 * Write refs back into a serialised inventory before it is committed.
 *
 * @see the module comment for why this matches by value, per entry.
 */
export function collapseMatcherRefs(raw: RawInventory, refs: InventoryMatcherRefs | undefined, file: string, warn: (message: string) => void = console.warn): RawInventory {
  if (refs === undefined || refs.sites.length === 0) return raw

  const canonicalCache = new Map<string, string>()
  const canonicalFor = (collection: MatcherRefSite['collection'], name: string): string | undefined => {
    const cacheKey = `${collection}\u0000${name}`
    const cached = canonicalCache.get(cacheKey)
    if (cached !== undefined) return cached
    const definition = Object.hasOwn(refs.shared.definitions, name) ? refs.shared.definitions[name] : undefined
    if (definition === undefined) return undefined
    // The same parse + factory + serialiser the entry itself went through, so
    // normalisation (dates, initiator-host forms, hash cloning) cannot make an
    // untouched ref look changed.
    const matcher: Matcher = createMatcher(MatcherConfigSchema.parse(structuredClone(definition.matcher)))
    const canonical = canonicalJson(collection === 'scripts' ? scriptMatcherToRawConfig(matcher) : headerMatcherToRawConfig(matcher))
    canonicalCache.set(cacheKey, canonical)
    return canonical
  }

  const sitesByEntry = new Map<string, MatcherRefSite[]>()
  for (const site of refs.sites) {
    const key = `${site.collection}/${site.entryIndex}`
    sitesByEntry.set(key, [...(sitesByEntry.get(key) ?? []), site])
  }

  const collapseEntry = (entry: unknown, collection: MatcherRefSite['collection'], entryIndex: number): unknown => {
    const sites = sitesByEntry.get(`${collection}/${entryIndex}`)
    if (sites === undefined) return entry

    const result = structuredClone(entry)
    const entryPointer = `/${collection}/${entryIndex}`

    for (const site of sites) {
      const canonical = canonicalFor(collection, site.name)
      const relative = site.pointer.slice(entryPointer.length)
      // Where the ref now sits: where it was written, or — when the update
      // wrapped a single-matcher authoriseWith into array syntax to append an
      // alternative — the same place under its first element. Nothing else
      // the tool does to an existing entry moves a node: it only appends.
      const candidates = relative.startsWith('/authoriseWith') ? [relative, `/authoriseWith/0${relative.slice('/authoriseWith'.length)}`] : [relative]
      const at = canonical === undefined ? undefined : candidates.find((pointer) => matchesAt(result, pointer, canonical))

      if (at === undefined) {
        warn(
          `[Inventory → Repository] ${file} ${site.pointer}: matcherRef "${site.name}" no longer equals its definition in ${refs.shared.file} after this run's update, so it is written inline. Review the change and either keep it inline or move it into the shared definition.`,
        )
        continue
      }

      replaceAt(result, at, (node) => (node['authorisationInfo'] === undefined ? { matcherRef: site.name } : { matcherRef: site.name, authorisationInfo: node['authorisationInfo'] }))
    }

    return result
  }

  return {
    ...raw,
    scripts: raw.scripts.map((entry, index) => collapseEntry(entry, 'scripts', index)) as RawInventory['scripts'],
    headers: raw.headers.map((entry, index) => collapseEntry(entry, 'headers', index)) as RawInventory['headers'],
  }
}
