import type { InventoryDifferenceResult } from '../types/inventory/model.js'
import type { RawInventoryHeaderInfo, RawInventoryScriptInfo } from '../types/inventory/raw.js'
import { inventoryToRawInventory } from './inventory.js'

type InventoryChangeCounts = {
  newScripts: number
  newScriptHashes: number
  newHeaders: number
  newHeaderMatchers: number
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

function countContentMatchersInMatcher(matcher: unknown): number {
  if (typeof matcher !== 'object' || matcher === null) return 0

  const ownMatcher = 'contentMatcher' in matcher ? 1 : 0
  return ownMatcher + matcherChildren(matcher).reduce<number>((total, child) => total + countContentMatchersInMatcher(child), 0)
}

function countScriptHashes(script: RawInventoryScriptInfo): number {
  return countHashesInMatcher(script.authoriseWith)
}

function countHeaderContentMatchers(header: RawInventoryHeaderInfo): number {
  return countContentMatchersInMatcher(header.authoriseWith)
}

function computeCountsForDiff(diff: InventoryDifferenceResult): PerFileChange {
  const oldRaw = inventoryToRawInventory(diff.oldInventory)
  const newRaw = inventoryToRawInventory(diff.newInventory)

  const oldScriptCount = oldRaw.scripts.length
  const newScripts = Math.max(0, newRaw.scripts.length - oldScriptCount)

  let newScriptHashes = 0
  for (let i = 0; i < oldScriptCount; i++) {
    const oldScript = oldRaw.scripts[i]
    const newScript = newRaw.scripts[i]
    if (!oldScript || !newScript) continue
    newScriptHashes += Math.max(0, countScriptHashes(newScript) - countScriptHashes(oldScript))
  }

  const oldHeaderCount = oldRaw.headers.length
  const newHeaders = Math.max(0, newRaw.headers.length - oldHeaderCount)

  let newHeaderMatchers = 0
  for (let i = 0; i < oldHeaderCount; i++) {
    const oldHeader = oldRaw.headers[i]
    const newHeader = newRaw.headers[i]
    if (!oldHeader || !newHeader) continue
    newHeaderMatchers += Math.max(0, countHeaderContentMatchers(newHeader) - countHeaderContentMatchers(oldHeader))
  }

  return {
    fileName: diff.newInventory.fileName,
    newScripts,
    newScriptHashes,
    newHeaders,
    newHeaderMatchers,
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
 * zero count are omitted from the summary.
 */
export function buildInventoryCommitMessage(diffs: InventoryDifferenceResult[]): string | null {
  const perFile = diffs.map(computeCountsForDiff)
  const changedFiles = perFile.filter((entry) => entry.newScripts > 0 || entry.newScriptHashes > 0 || entry.newHeaders > 0 || entry.newHeaderMatchers > 0)

  if (changedFiles.length === 0) {
    return null
  }

  const totals: InventoryChangeCounts = changedFiles.reduce(
    (acc, entry) => ({
      newScripts: acc.newScripts + entry.newScripts,
      newScriptHashes: acc.newScriptHashes + entry.newScriptHashes,
      newHeaders: acc.newHeaders + entry.newHeaders,
      newHeaderMatchers: acc.newHeaderMatchers + entry.newHeaderMatchers,
    }),
    { newScripts: 0, newScriptHashes: 0, newHeaders: 0, newHeaderMatchers: 0 },
  )

  const scope = toScope(changedFiles.map((entry) => entry.fileName))
  const summary = joinParts(formatParts(totals))
  return `inventory${scope}: add ${summary}`
}
