import type { InventoryDifferenceResult } from '../types/inventory/model.js'
import type { RawInventoryHeaderInfo, RawInventoryScriptInfo } from '../types/inventory/raw.js'
import { inventoryToRawInventory } from './inventory.js'

type InventoryChangeCounts = {
  newScripts: number
  newScriptHashes: number
  newHeaders: number
  newHeaderMatchers: number
  /** Existing entries that changed without adding anything a bucket above counts. */
  updatedEntries: number
}

type PerFileChange = InventoryChangeCounts & { fileName: string }

function matcherChildren(matcher: unknown): unknown[] {
  if (Array.isArray(matcher)) return matcher
  if (typeof matcher !== 'object' || matcher === null) return []

  const config = matcher as { orMatcher?: unknown; andMatcher?: unknown }
  return [...(Array.isArray(config.orMatcher) ? config.orMatcher : []), ...(Array.isArray(config.andMatcher) ? config.andMatcher : [])]
}

function countHashesInMatcher(matcher: unknown): number {
  if (typeof matcher !== 'object' || matcher === null) return 0

  const config = matcher as { hashes?: unknown }
  const ownHashes = Array.isArray(config.hashes) ? config.hashes.length : 0
  return ownHashes + matcherChildren(matcher).reduce<number>((total, child) => total + countHashesInMatcher(child), 0)
}

/**
 * Count the alternatives an `authoriseWith` accepts: array elements and
 * `orMatcher` children are alternatives, while anything else — a leaf of any
 * type, or an `andMatcher` (one alternative with several conjuncts) — counts
 * once. Deliberately type-agnostic: counting only `contentMatcher` leaves made a
 * new `cspDirectiveMatcher` alternative score zero, and the push was skipped.
 */
function countAlternatives(matcher: unknown): number {
  if (Array.isArray(matcher)) return matcher.reduce<number>((total, child) => total + countAlternatives(child), 0)
  if (typeof matcher !== 'object' || matcher === null) return 0

  const { orMatcher } = matcher as { orMatcher?: unknown }
  return Array.isArray(orMatcher) ? countAlternatives(orMatcher) : 1
}

function countScriptHashes(script: RawInventoryScriptInfo): number {
  return countHashesInMatcher(script.authoriseWith)
}

function countHeaderAlternatives(header: RawInventoryHeaderInfo): number {
  return countAlternatives(header.authoriseWith)
}

function sameEntry(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function computeCountsForDiff(diff: InventoryDifferenceResult): PerFileChange {
  const oldRaw = inventoryToRawInventory(diff.oldInventory)
  const newRaw = inventoryToRawInventory(diff.newInventory)

  const oldScriptCount = oldRaw.scripts.length
  const newScripts = Math.max(0, newRaw.scripts.length - oldScriptCount)

  // Backstop for every bucket: an existing entry whose serialised form changed
  // but added nothing a bucket counts is still a change. A diff the counters
  // cannot see must be committed under a generic message, never dropped —
  // the inventory alert has already told someone it was recorded.
  let updatedEntries = 0

  let newScriptHashes = 0
  for (let i = 0; i < oldScriptCount; i++) {
    const oldScript = oldRaw.scripts[i]
    const newScript = newRaw.scripts[i]
    if (!oldScript || !newScript) continue
    const added = Math.max(0, countScriptHashes(newScript) - countScriptHashes(oldScript))
    newScriptHashes += added
    if (added === 0 && !sameEntry(oldScript, newScript)) updatedEntries++
  }

  const oldHeaderCount = oldRaw.headers.length
  const newHeaders = Math.max(0, newRaw.headers.length - oldHeaderCount)

  let newHeaderMatchers = 0
  for (let i = 0; i < oldHeaderCount; i++) {
    const oldHeader = oldRaw.headers[i]
    const newHeader = newRaw.headers[i]
    if (!oldHeader || !newHeader) continue
    const added = Math.max(0, countHeaderAlternatives(newHeader) - countHeaderAlternatives(oldHeader))
    newHeaderMatchers += added
    if (added === 0 && !sameEntry(oldHeader, newHeader)) updatedEntries++
  }

  return {
    fileName: diff.newInventory.fileName,
    newScripts,
    newScriptHashes,
    newHeaders,
    newHeaderMatchers,
    updatedEntries,
  }
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatParts(counts: InventoryChangeCounts): string[] {
  const parts: string[] = []
  if (counts.newScripts > 0) parts.push(pluralize(counts.newScripts, 'script', 'scripts'))
  if (counts.newScriptHashes > 0) parts.push(pluralize(counts.newScriptHashes, 'script hash', 'script hashes'))
  if (counts.newHeaders > 0) parts.push(pluralize(counts.newHeaders, 'header', 'headers'))
  if (counts.newHeaderMatchers > 0) parts.push(pluralize(counts.newHeaderMatchers, 'header matcher', 'header matchers'))
  return parts
}

function hasChanges(counts: InventoryChangeCounts): boolean {
  return counts.newScripts > 0 || counts.newScriptHashes > 0 || counts.newHeaders > 0 || counts.newHeaderMatchers > 0 || counts.updatedEntries > 0
}

function joinParts(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function toScope(fileNames: string[]): string {
  const stems = fileNames.map((name) => name.replace(/\.json$/, ''))
  return stems.length === 0 ? '' : `(${stems.join(', ')})`
}

/**
 * Build a Conventional Commits-style message summarising inventory changes.
 *
 * Returns `null` when no diff contains any material change — callers should
 * treat that as "nothing to commit" and skip the push entirely.
 *
 * Examples:
 *   inventory(2.0): add 9 header matchers
 *   inventory(1.0, 2.0): add 1 script and 3 header matchers
 *
 * Only files whose counts changed are included in the scope. Buckets with a
 * zero count are omitted from the summary. An existing entry that changed
 * without adding anything counted is reported as `update N entries`, so a
 * matcher shape the counters do not know can never make a real diff read as
 * "nothing to commit".
 */
export function buildInventoryCommitMessage(diffs: InventoryDifferenceResult[]): string | null {
  const perFile = diffs.map(computeCountsForDiff)
  const changedFiles = perFile.filter(hasChanges)

  if (changedFiles.length === 0) {
    return null
  }

  const totals: InventoryChangeCounts = changedFiles.reduce(
    (acc, entry) => ({
      newScripts: acc.newScripts + entry.newScripts,
      newScriptHashes: acc.newScriptHashes + entry.newScriptHashes,
      newHeaders: acc.newHeaders + entry.newHeaders,
      newHeaderMatchers: acc.newHeaderMatchers + entry.newHeaderMatchers,
      updatedEntries: acc.updatedEntries + entry.updatedEntries,
    }),
    { newScripts: 0, newScriptHashes: 0, newHeaders: 0, newHeaderMatchers: 0, updatedEntries: 0 },
  )

  const scope = toScope(changedFiles.map((entry) => entry.fileName))
  const added = formatParts(totals)
  const clauses = [...(added.length > 0 ? [`add ${joinParts(added)}`] : []), ...(totals.updatedEntries > 0 ? [`update ${pluralize(totals.updatedEntries, 'entry', 'entries')}`] : [])]
  return `inventory${scope}: ${clauses.join(' and ')}`
}
