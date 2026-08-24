/**
 * Resolve a comparison result back to the exact place in the inventory repo
 * that authorised it — file, JSON pointer, line and column.
 *
 * An assessor's question is "show me where this script is authorised". Answering
 * it means bridging three representations that do not line up:
 *
 * 1. The **raw JSON** on disk, which is what they will open.
 * 2. The **in-memory matcher tree**, which is what actually ran.
 * 3. The **authorisation trace**, which says which branches of that tree the
 *    decision went down.
 *
 * The hard constraint is that in-memory shape does not determine raw shape.
 * `processAuthorizeWith` turns both array syntax (`"authoriseWith": [ ... ]`)
 * and object syntax (`"authoriseWith": { "orMatcher": [ ... ] }`) into an
 * OrMatcher carrying no authorisation info of its own, so the two are
 * indistinguishable once loaded. Any rule that guesses the raw key names from
 * the matcher tree is therefore wrong for one of them. This module reads the
 * raw node at every step instead of inferring it.
 *
 * Guiding principle: **a wrong pointer in a compliance report is worse than an
 * absent one.** Every step asserts that the three structures agree, and any
 * disagreement yields `authorisedBy: null` with a stated reason rather than a
 * plausible-looking guess.
 *
 * @see ./json-position.ts for text positions
 * @see ../types/matcher/authorization-trace.ts for the trace shape
 */

import type { ComparisonResultType } from '../types/comparison.js'
import type { Inventory, InventoryAuthorisationInfo, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model.js'
import { type AuthorizationTrace, leafTrace, type MatcherKind } from '../types/matcher/authorization-trace.js'
import type { AuthorisationInfo, Matchable, Matcher } from '../types/matcher/matcher.interface.js'
import { detectedHeaderToMatchable } from './header.js'
import { buildJsonPositionIndex, type JsonPositionIndex, resolveJsonPointer } from './json-position.js'

/** A location in an inventory file. Line and column are 1-based. */
export type SourceProvenance = {
  /** Path relative to the inventory repo root, e.g. `targets/2.0.json`. */
  file: string
  /** RFC 6901 pointer into that file's JSON. */
  pointer: string
  line: number
  column: number
}

/**
 * One matcher node on the path that authorised a resource.
 *
 * A tree rather than a single location because an AndMatcher has no single
 * authorising leaf — every conjunct contributed, and an auditor needs to see
 * all of them.
 */
export type ProvenanceNode = SourceProvenance & {
  matcherType: MatcherKind
  /** `matcher.getDescription()` — the same string the run logs printed. */
  description: string
  /** This node's own authorisation metadata, if it carries any. */
  authorisationInfo?: InventoryAuthorisationInfo | undefined
  /** For `or`, the single winning alternative; for `and`, every evaluated conjunct. */
  children?: ProvenanceNode[] | undefined
}

/** Everything the report knows about where an inventory entry lives. */
export type EntryProvenance = {
  /** The entry itself, e.g. `/scripts/7`. */
  entry: SourceProvenance
  identifyWith: SourceProvenance
  authoriseWith: SourceProvenance
  /** The `requiredOn` clause, for entries (header or script) that declare one. */
  requiredOn?: SourceProvenance | undefined
  /**
   * The node that actually authorised this resource.
   *
   * Populated only for authorised results — naming a node here for a denial
   * would assert an authorisation that never happened. For denials the
   * `authoriseWith` pointer still locates the matcher that refused, and the
   * comparison result carries the failure reason.
   */
  authorisedBy: ProvenanceNode | null
  /** Why `authorisedBy` is null. Absent when it is populated. */
  unresolvedReason?: string | undefined
}

/** Resolves comparison results against one inventory file. */
export type ProvenanceResolver = (result: ComparisonResultType) => EntryProvenance | null

/** Resolves an arbitrary JSON pointer in one inventory file to a source location. */
export type SourceLocator = (pointer: string) => SourceProvenance | null

/**
 * Locate arbitrary pointers in an inventory file.
 *
 * Used for entries that have no comparison result to trace — notably inventory
 * entries nothing matched during a run, which still need a real file and line
 * so an auditor can go and look at them.
 */
export function createSourceLocator(inventory: Inventory): SourceLocator | null {
  const source = inventory.source

  if (source === undefined) return null

  let positions: JsonPositionIndex

  try {
    positions = buildJsonPositionIndex(source.text)
  } catch {
    return null
  }

  return (pointer: string): SourceProvenance | null => {
    const position = positions.get(pointer)

    return position === undefined ? null : { file: source.file, pointer, line: position.line, column: position.column }
  }
}

type ScriptResultWithEntry = Extract<ComparisonResultType, { inventoryEntry: InventoryScriptInfo }>
type HeaderResultWithEntry = Extract<ComparisonResultType, { inventoryEntry: InventoryHeaderInfo }>
type ResultWithEntry = ScriptResultWithEntry | HeaderResultWithEntry

const SCRIPT_RESULT_TYPES = new Set(['known_script_unauthorised_content', 'authorized_script', 'missing_required_script'])
const HEADER_RESULT_TYPES = new Set(['known_header_unauthorised_content', 'authorized_header', 'missing_required_header'])

/** Results that were authorised, and so should have a resolvable authorising node. */
const AUTHORIZED_RESULT_TYPES = new Set(['authorized_script', 'authorized_header'])

function hasInventoryEntry(result: ComparisonResultType): result is ResultWithEntry {
  return SCRIPT_RESULT_TYPES.has(result.type) || HEADER_RESULT_TYPES.has(result.type)
}

/** Matchers optionally expose authorisation metadata; the base interface does not. */
function readAuthorisationInfo(matcher: Matcher<never>): AuthorisationInfo | undefined {
  const accessor = (matcher as { getAuthorisationInfo?: () => AuthorisationInfo | undefined }).getAuthorisationInfo

  return typeof accessor === 'function' ? accessor.call(matcher) : undefined
}

function toInventoryAuthorisationInfo(info: AuthorisationInfo | undefined): InventoryAuthorisationInfo | undefined {
  return info === undefined ? undefined : { description: info.description, authorised: info.authorised, date: info.date }
}

/**
 * The authorisation metadata written at this node in the file.
 *
 * Read from the raw JSON in preference to the matcher, because
 * `processAuthorizeWith` strips `authorisationInfo` off single-matcher configs
 * before constructing the matcher — so a HashMatcher written as
 * `{ "hashes": [...], "authorisationInfo": {...} }` carries none of its own,
 * even though the file plainly shows it. Falls back to the matcher for nodes
 * the raw tree cannot describe.
 */
function authorisationInfoAt(raw: unknown, matcher: Matcher<never>): InventoryAuthorisationInfo | undefined {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const candidate = (raw as Record<string, unknown>)['authorisationInfo']

    if (typeof candidate === 'object' && candidate !== null) {
      const { description, authorised, date } = candidate as Record<string, unknown>

      if (typeof description === 'string' && typeof authorised === 'boolean' && (typeof date === 'string' || date instanceof Date)) {
        return { description, authorised, date: new Date(date) }
      }
    }
  }

  return toInventoryAuthorisationInfo(readAuthorisationInfo(matcher))
}

/** Child matchers of a composite, or an empty list for a leaf. */
function childMatchersOf(matcher: Matcher<never>): Matcher<never>[] {
  const pattern = matcher.getPattern()

  return Array.isArray(pattern) && pattern.every((entry) => typeof entry === 'object' && entry !== null && 'getType' in entry) ? (pattern as Matcher<never>[]) : []
}

/**
 * Which raw key holds a composite's children, and the array itself.
 *
 * Read from the raw node rather than inferred from the matcher, because array
 * syntax and `{ "orMatcher": [...] }` produce identical matcher trees.
 */
function rawChildren(raw: unknown): { segment: string | null; children: unknown[] } | null {
  if (Array.isArray(raw)) return { segment: null, children: raw }

  if (typeof raw !== 'object' || raw === null) return null

  const node = raw as Record<string, unknown>

  for (const key of ['orMatcher', 'andMatcher'] as const) {
    const value = node[key]
    if (Array.isArray(value)) return { segment: key, children: value }
  }

  return null
}

function rawHashes(raw: unknown): unknown[] | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const hashes = (raw as Record<string, unknown>)['hashes']

  return Array.isArray(hashes) ? hashes : null
}

/**
 * Build a resolver for one inventory file.
 *
 * Returns `null` when the inventory carries no source text — an honest "cannot
 * attribute" rather than a partial answer. The parsed tree and position index
 * are computed once and shared across every result for the file.
 *
 * IMPORTANT: pass the inventory the comparison actually ran against
 * (`diffResult.oldInventory`, identically the `inventory` argument to `diff`),
 * never `newInventory`. Entry lookup is by object identity, and the diff
 * rebuilds mutated entries — so a post-diff inventory silently fails to resolve.
 */
export function createProvenanceResolver(inventory: Inventory): ProvenanceResolver | null {
  const source = inventory.source

  if (source === undefined) return null

  let rawRoot: unknown
  let positions: JsonPositionIndex

  try {
    rawRoot = JSON.parse(source.text)
    positions = buildJsonPositionIndex(source.text)
  } catch {
    // A file that parsed during pull but not here would mean the retained text
    // does not match what was validated. Degrade rather than emit bad pointers.
    return null
  }

  const file = source.file

  const locate = (pointer: string): SourceProvenance | null => {
    const position = positions.get(pointer)

    return position === undefined ? null : { file, pointer, line: position.line, column: position.column }
  }

  /**
   * Walk raw JSON, matcher tree and trace in lockstep, emitting a node per step.
   *
   * Bails to null the moment the three disagree — that is the fail-safe that
   * makes the array-syntax/orMatcher ambiguity harmless and catches any future
   * drift between the loader and the serialiser.
   */
  const walk = (raw: unknown, matcher: Matcher<never>, trace: AuthorizationTrace, pointer: string): ProvenanceNode | null => {
    const here = locate(pointer)

    if (here === null) return null

    const matcherType = matcher.getType()

    // The trace must describe the matcher we think we are standing on.
    if (trace.type !== matcherType) return null

    const node: ProvenanceNode = {
      ...here,
      matcherType,
      description: matcher.getDescription(),
      authorisationInfo: authorisationInfoAt(raw, matcher),
    }

    if (trace.consulted.length === 0) return node

    const children: ProvenanceNode[] = []

    for (const step of trace.consulted) {
      if (step.slot === 'hashes') {
        // Terminal: a hash element has no matcher of its own, so the node is
        // the position of the hash entry inside this matcher's list.
        if (matcherType !== 'hash') return null

        const hashes = rawHashes(raw)

        if (hashes === null || step.index >= hashes.length) return null

        const hashLocation = locate(`${pointer}/hashes/${step.index}`)

        if (hashLocation === null) return null

        children.push({ ...hashLocation, matcherType: 'hash', description: `hash entry ${step.index}` })
        continue
      }

      if (matcherType !== 'or' && matcherType !== 'and') return null

      const rawComposite = rawChildren(raw)
      const matcherChildren = childMatchersOf(matcher)

      if (rawComposite === null) return null

      // An OrMatcher may be written as an array or as `{ "orMatcher": [...] }`;
      // an AndMatcher only ever as `{ "andMatcher": [...] }`.
      if (matcherType === 'and' && rawComposite.segment !== 'andMatcher') return null
      if (matcherType === 'or' && rawComposite.segment !== null && rawComposite.segment !== 'orMatcher') return null

      // Raw and in-memory must agree on arity, or the indices mean different things.
      if (rawComposite.children.length !== matcherChildren.length) return null
      if (step.index >= matcherChildren.length) return null

      const childMatcher = matcherChildren[step.index]
      const childRaw = rawComposite.children[step.index]
      const childTrace = step.child

      if (childMatcher === undefined || childTrace === undefined) return null

      const childPointer = rawComposite.segment === null ? `${pointer}/${step.index}` : `${pointer}/${rawComposite.segment}/${step.index}`
      const childNode = walk(childRaw, childMatcher, childTrace, childPointer)

      if (childNode === null) return null

      children.push(childNode)
    }

    node.children = children

    return node
  }

  return (result: ComparisonResultType): EntryProvenance | null => {
    if (!hasInventoryEntry(result)) return null

    const isScript = SCRIPT_RESULT_TYPES.has(result.type)
    const collection: readonly (InventoryScriptInfo | InventoryHeaderInfo)[] = isScript ? inventory.scripts : inventory.headers
    const index = collection.indexOf(result.inventoryEntry)

    // -1 means this entry is not in the inventory we were given — most likely a
    // post-diff inventory. Refuse loudly rather than guessing an index.
    if (index === -1) return null

    const basePointer = `${isScript ? '/scripts' : '/headers'}/${index}`
    const entry = locate(basePointer)
    const identifyWith = locate(`${basePointer}/identifyWith`)
    const authoriseWith = locate(`${basePointer}/authoriseWith`)

    if (entry === null || identifyWith === null || authoriseWith === null) return null

    const unresolved = (reason: string): EntryProvenance => ({ entry, identifyWith, authoriseWith, authorisedBy: null, unresolvedReason: reason })

    // A required resource that never arrived was never authorised; the absence
    // is the finding, and `requiredOn` is the clause that makes it one.
    if (result.type === 'missing_required_header' || result.type === 'missing_required_script') {
      const requiredOn = locate(`${basePointer}/requiredOn`)

      return {
        entry,
        identifyWith,
        authoriseWith,
        ...(requiredOn !== null ? { requiredOn } : {}),
        authorisedBy: null,
        unresolvedReason: result.type === 'missing_required_header' ? 'required header absent from the response; no authorisation was evaluated' : 'required script absent from the page; no authorisation was evaluated',
      }
    }

    // Only an authorised result has something that authorised it. Naming a node
    // for a denial would assert an authorisation that never happened.
    if (!AUTHORIZED_RESULT_TYPES.has(result.type)) {
      return unresolved('the identified entry did not authorise this resource')
    }

    const matchable = toMatchable(result)

    if (matchable === null) return unresolved('detected resource could not be mapped for replay')

    // Replay through the real matcher rather than reimplementing its semantics.
    // Matchers are pure (all `new RegExp` without `g`/`y`), so this re-runs the
    // same decision — which is what lets the report claim to reflect what the
    // system actually did.
    const replay = result.inventoryEntry.authoriseWith.matcher.authorize(matchable as never, { collectTrace: true })

    if (replay.authorized !== AUTHORIZED_RESULT_TYPES.has(result.type)) {
      return unresolved('replayed authorisation disagreed with the recorded result')
    }

    const rootMatcher = result.inventoryEntry.authoriseWith.matcher as Matcher<never>

    // Leaf matchers produce no trace of their own — a composite parent
    // describes them from the outside. When the entry's root `authoriseWith` is
    // itself a leaf (a bare `contentMatcher`, which is the common shape for
    // headers) there is no parent, so synthesise the node here. Without this
    // every leaf-rooted entry would report "no trace" and lose its line number.
    const trace = replay.trace ?? leafTrace(rootMatcher)

    const rawAuthoriseWith = resolveJsonPointer(rawRoot, `${basePointer}/authoriseWith`)
    const authorisedBy = walk(rawAuthoriseWith, rootMatcher, trace, `${basePointer}/authoriseWith`)

    if (authorisedBy === null) return unresolved('inventory file structure did not match the matcher that ran')

    return { entry, identifyWith, authoriseWith, authorisedBy }
  }
}

/** Rebuild the `Matchable` the comparison service authorised, for replay. */
function toMatchable(result: ResultWithEntry): Matchable | null {
  switch (result.type) {
    case 'authorized_script':
    case 'known_script_unauthorised_content':
      return result.script
    case 'authorized_header':
    case 'known_header_unauthorised_content':
      return detectedHeaderToMatchable(result.header, result.target)
    default:
      return null
  }
}
