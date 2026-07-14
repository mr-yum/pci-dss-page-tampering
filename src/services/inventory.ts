import type { IInventoryService, InventoryPushResult, IScriptInventoryRepository } from '../interfaces/inventory.js'
import type { ComparisonResultType, KnownScriptWithUnauthorisedContentFound, UnknownScriptFound } from '../types/comparison.js'
import type { KnownHeaderWithUnauthorisedContentFound } from '../types/comparison/known-header-unauthorised-content-found.js'
import type { UnknownHeaderFound } from '../types/comparison/unknown-header-found.js'
import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model.js'
import type { InventoryServiceProps } from '../types/inventory/props.js'
import { ContentMatcher } from '../types/matcher/content-matcher.js'
import { HashMatcher } from '../types/matcher/hash-matcher.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { OrMatcher } from '../types/matcher/or-matcher.js'
import type { PullTarget } from '../types/target.js'
import { buildInventoryCommitMessage } from '../utils/commit-message.js'
import { copyInventory, inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory.js'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script.js'
import { UNIDENTIFIED_INLINE_SCRIPT_ID } from '../utils/script/inline.js'

export class ScriptInventoryService implements IInventoryService {
  private _repository: IScriptInventoryRepository

  constructor(args: InventoryServiceProps) {
    this._repository = args.inventoryRepository
  }

  async pull(target: PullTarget, branchName?: string): Promise<Inventory[]> {
    console.log('[Inventory → Service] Pulling inventory from store.')
    return await this._repository.pull(target, branchName)
  }

  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult> {
    // Validation: Ensure all results are from inventory workflow (FR-008)
    const hasDetectionResults = comparisonResults.some((result) => result.target.type !== 'inventory')
    if (hasDetectionResults) {
      return Promise.reject(new Error('[Inventory → Service] Cannot run diff with results from detection target! Skipping...'))
    }

    const updateDate = new Date()
    const appliedResults: ComparisonResultType[] = []

    // First pass: partition results. Updates targeting an existing inventory entry
    // are grouped by `inventoryEntry` reference so that multiple updates for the
    // same entry can be applied together — otherwise the first update replaces
    // the entry with a new object, stranding later updates whose `inventoryEntry`
    // still points at the original reference.
    //
    // Eligibility gate: we use the inventory entry's top-level authoriseWith
    // matcher (not `result.authorizationMatcher`) because the latter is set by
    // the comparison service to the top-level matcher anyway, and reasoning
    // about the entry's structure is what determines whether a hash/content
    // matcher can be sensibly auto-appended. AndMatcher / pattern-based single
    // matchers are skipped — appending an OR'd alternative would weaken the
    // operator's chosen authorisation semantics.
    const unknownScripts: UnknownScriptFound[] = []
    const unknownHeaders: UnknownHeaderFound[] = []
    const scriptHashUpdates = new Map<InventoryScriptInfo, KnownScriptWithUnauthorisedContentFound[]>()
    const headerContentUpdates = new Map<InventoryHeaderInfo, KnownHeaderWithUnauthorisedContentFound[]>()

    for (const result of comparisonResults) {
      switch (result.type) {
        case 'unknown_script_found':
          unknownScripts.push(result)
          break
        case 'known_script_unauthorised_content': {
          const topLevelMatcher = result.inventoryEntry.authoriseWith.matcher
          // Only auto-append hashes when the inventory entry's authorisation is
          // hash-based (HashMatcher) or an OR of alternatives (where a new hash
          // entry is a natural new alternative). Anything else — ContentMatcher,
          // NameMatcher, AndMatcher — is left untouched so the operator can
          // review and decide whether the change is legitimate.
          if (topLevelMatcher instanceof HashMatcher || topLevelMatcher instanceof OrMatcher) {
            const existing = scriptHashUpdates.get(result.inventoryEntry) ?? []
            existing.push(result)
            scriptHashUpdates.set(result.inventoryEntry, existing)
          }
          break
        }
        case 'unknown_header_found':
          unknownHeaders.push(result)
          break
        case 'known_header_unauthorised_content': {
          const topLevelMatcher = result.inventoryEntry.authoriseWith.matcher
          // Same rationale as scripts: only auto-append a new ContentMatcher
          // when the existing authorisation is content-based or an OR of
          // alternatives. AndMatcher / NameMatcher / HashMatcher entries are
          // intentionally untouched.
          if (topLevelMatcher instanceof ContentMatcher || topLevelMatcher instanceof OrMatcher) {
            const existing = headerContentUpdates.get(result.inventoryEntry) ?? []
            existing.push(result)
            headerContentUpdates.set(result.inventoryEntry, existing)
          }
          break
        }
        case 'authorized_script':
        case 'authorized_header':
          break
        default: {
          const _exhaustive: never = result
          throw new Error(`[Inventory → Service] Unhandled comparison result type: ${(_exhaustive as any).type}`)
        }
      }
    }

    // Second pass: apply batched updates, one entry at a time. The apply helpers
    // return the per-result applied state so we can faithfully report which
    // results caused inventory mutations (used by the alert layer to decide
    // between "Inventory updated" and "manual review required" messaging).
    const updatedScripts = inventory.scripts.map((script) => {
      const updates = scriptHashUpdates.get(script)
      if (!updates || updates.length === 0) {
        return script
      }
      const { updated, applied } = this.applyScriptHashUpdates(script, updates, updateDate)
      appliedResults.push(...applied)
      return updated
    })

    const updatedHeaders = inventory.headers.map((header) => {
      const updates = headerContentUpdates.get(header)
      if (!updates || updates.length === 0) {
        return header
      }
      const { updated, applied } = this.applyHeaderContentUpdates(header, updates, updateDate)
      appliedResults.push(...applied)
      return updated
    })

    let updatedInventory = copyInventory(inventory, { newScripts: updatedScripts, newHeaders: updatedHeaders })

    // Append new scripts/headers from unknown_* results. Pending entries
    // (authorised: false) are invisible to identification in the comparison
    // service, so a script awaiting review comes back as unknown on every
    // run — skip the append when an existing entry already covers it, or the
    // inventory grows a duplicate entry per run until a human authorises.
    for (const result of unknownScripts) {
      if (this.isCoveredByExistingEntry(result, updatedInventory)) {
        continue
      }
      updatedInventory = this.addNewScript(result, updatedInventory, updateDate)
      appliedResults.push(result)
    }
    for (const result of unknownHeaders) {
      updatedInventory = this.addNewHeader(result, updatedInventory, updateDate)
      appliedResults.push(result)
    }

    return Promise.resolve({
      oldInventory: inventory,
      newInventory: updatedInventory,
      appliedResults,
    })
  }

  async push(diffs: InventoryDifferenceResult[], branchName?: string): Promise<InventoryPushResult> {
    if (diffs.length === 0) {
      return { pushed: false }
    }

    const commitMessage = buildInventoryCommitMessage(diffs)
    if (commitMessage === null) {
      // No material changes — skip the push entirely rather than letting git
      // error on "nothing to commit".
      console.log('[Inventory → Service] No inventory changes to push.')
      return { pushed: false }
    }

    console.log('[Inventory → Service] Pushing script differences to inventory.')
    const inventoriesToPush = diffs.map((diff) => diff.newInventory)
    return await this._repository.push(inventoriesToPush, branchName, commitMessage)
  }

  /**
   * Add a new script to inventory (FR-001).
   * Creates a new inventory entry from UnknownScriptFound result.
   */
  /**
   * True when an existing inventory entry already identifies this script AND
   * its matcher accepts the script's content/hash. Comparison only reports a
   * script as unknown when every entry that identifies it has
   * `authorised: false`, so a hit here is a pending entry from an earlier
   * run that a human has not reviewed yet — appending again would duplicate it.
   */
  private isCoveredByExistingEntry(result: UnknownScriptFound, inventory: Inventory): boolean {
    return inventory.scripts.some((entry) => entry.identifyWith.identify(result.script) && entry.authoriseWith.matcher.authorize(result.script).authorized)
  }

  /**
   * Builds the identification matcher for a newly discovered script.
   *
   * Scripts with a meaningful name (external URLs, inline ids) are identified
   * by exact name. Inline scripts that fell through to the shared
   * `inline_script/id_not_found` fallback cannot be — the name is identical
   * for every such script — so they are identified by provenance + content:
   * initiator host (from the page-attribution shim) AND an anchored snippet
   * of the script body.
   */
  private buildIdentifyMatcher(result: UnknownScriptFound): InventoryScriptInfo['identifyWith'] {
    const script = result.script

    if (script.name !== UNIDENTIFIED_INLINE_SCRIPT_ID) {
      return createMatcher({ nameMatcher: `^${this.escapeRegex(script.name)}$` })
    }

    const content = script.content ?? ''
    const contentSnippet = content.slice(0, 64)
    if (contentSnippet.trim() === '') {
      // Whitespace-only content would produce a bare `^` matcher that
      // identifies every script. Fall back to the (degenerate) exact-name
      // matcher rather than minting a universal one.
      return createMatcher({ nameMatcher: `^${this.escapeRegex(script.name)}$` })
    }
    // When the whole body fits in the snippet window, anchor both ends —
    // a prefix-only match would also identify any longer script that merely
    // starts with this content. Truncated snippets stay prefix-anchored.
    // Compare the original length, not the snippet's: content of exactly 64
    // chars is untruncated and must still get the end anchor.
    const endAnchor = content.length <= 64 ? '$' : ''
    const contentConfig = { contentMatcher: `^${this.escapeRegex(contentSnippet)}${endAnchor}` }

    let host = ''
    if (script.url) {
      try {
        host = new URL(script.url).host
      } catch {
        // Unparseable initiator URL — fall through to content-only identification.
      }
    }

    if (!host) {
      return createMatcher(contentConfig)
    }

    return createMatcher({
      andMatcher: [{ hostMatcher: `^${this.escapeRegex(host)}$` }, contentConfig],
    })
  }

  private addNewScript(result: UnknownScriptFound, inventory: Inventory, updateDate: Date): Inventory {
    const newScript: InventoryScriptInfo = {
      identifyWith: this.buildIdentifyMatcher(result),
      authoriseWith: {
        matcher: createMatcher({ hashes: [{ timestamp: result.timestamp, hash: result.script.hash }] }),
        authorisationInfo: {
          description: 'NO_DESCRIPTION',
          authorised: false,
          date: updateDate,
        },
      },
    }

    const newScripts = inventory.scripts.concat(newScript)
    return copyInventory(inventory, { newScripts })
  }

  /**
   * Apply a batch of new-hash updates to a single inventory script entry (FR-002a/FR-002b).
   *
   * Converts to raw once, accumulates all new hashes, then converts back once — this is
   * important because `rawInventoryScriptInfoToInventoryScriptInfo` produces a new object
   * on each call, so a per-result loop that replaced the entry between iterations would
   * strand subsequent updates whose `inventoryEntry` still referenced the original.
   *
   * Returns the updated entry alongside the subset of results that caused a real
   * mutation. Duplicate hashes already present in the entry's authoriseWith are
   * skipped silently and excluded from `applied` — the operator should not be
   * told "inventory updated" for a no-op.
   */
  private applyScriptHashUpdates(script: InventoryScriptInfo, results: KnownScriptWithUnauthorisedContentFound[], updateDate: Date): { updated: InventoryScriptInfo; applied: KnownScriptWithUnauthorisedContentFound[] } {
    const rawInventoryScript = inventoryScriptInfoToRawInventoryScriptInfo(script)
    const applied: KnownScriptWithUnauthorisedContentFound[] = []

    for (const result of results) {
      const newHashInfo = { timestamp: result.timestamp, hash: result.script.hash }

      if ('hashes' in rawInventoryScript.authoriseWith) {
        // Single HashMatcher: append to its hashes array.
        const hashAlreadyExists = rawInventoryScript.authoriseWith.hashes.some((h: any) => h.hash.value === newHashInfo.hash.value)
        if (!hashAlreadyExists) {
          rawInventoryScript.authoriseWith.hashes.push(newHashInfo)
          applied.push(result)
        }
      } else if (Array.isArray(rawInventoryScript.authoriseWith)) {
        // Top-level OrMatcher serialised as array syntax: append a new
        // hash matcher element to the OR.
        const hashAlreadyExists = rawInventoryScript.authoriseWith.some((element: any) => {
          return 'hashes' in element && element.hashes.some((h: any) => h.hash.value === newHashInfo.hash.value)
        })
        if (!hashAlreadyExists) {
          rawInventoryScript.authoriseWith.push({
            hashes: [newHashInfo],
            authorisationInfo: {
              description: `Hash detected during inventory run ${updateDate.toISOString()}`,
              authorised: true,
              date: updateDate.toISOString(),
            },
          })
          applied.push(result)
        }
      } else if ('orMatcher' in rawInventoryScript.authoriseWith) {
        // Top-level OrMatcher serialised as { orMatcher: [...], authorisationInfo }
        // (the variant where the OrMatcher itself carries its own metadata).
        // Append a new hash matcher child rather than turning the structure
        // into array syntax, which would drop the OrMatcher's own authInfo.
        const orChildren = rawInventoryScript.authoriseWith.orMatcher as any[]
        const hashAlreadyExists = orChildren.some((element: any) => {
          return 'hashes' in element && element.hashes.some((h: any) => h.hash.value === newHashInfo.hash.value)
        })
        if (!hashAlreadyExists) {
          orChildren.push({
            hashes: [newHashInfo],
            authorisationInfo: {
              description: `Hash detected during inventory run ${updateDate.toISOString()}`,
              authorised: true,
              date: updateDate.toISOString(),
            },
          })
          applied.push(result)
        }
      }
      // Other raw shapes are unreachable because the outer eligibility gate
      // only batches HashMatcher / OrMatcher entries.
    }

    return { updated: rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScript), applied }
  }

  /**
   * Add a new header to inventory (FR-004).
   */
  private addNewHeader(result: UnknownHeaderFound, inventory: Inventory, updateDate: Date): Inventory {
    const headerNamePattern = `^${result.header.name.toLowerCase()}$`
    const headerValuePattern = `^${this.escapeRegex(result.header.value)}$`

    const newHeader: InventoryHeaderInfo = {
      identifyWith: createMatcher({ headerNameMatcher: headerNamePattern }),
      authoriseWith: {
        matcher: createMatcher({ contentMatcher: headerValuePattern }),
        authorisationInfo: {
          description: 'NO_DESCRIPTION',
          authorised: false,
          date: updateDate,
        },
      },
    }

    return copyInventory(inventory, { newHeaders: inventory.headers.concat([newHeader]) })
  }

  /**
   * Apply a batch of new-content updates to a single inventory header entry (FR-003a/FR-003b).
   *
   * Returns the updated entry alongside the subset of results that caused a real
   * mutation. Duplicate patterns already present in the entry are skipped — the
   * operator should not be told "inventory updated" when nothing actually changed.
   */
  private applyHeaderContentUpdates(header: InventoryHeaderInfo, results: KnownHeaderWithUnauthorisedContentFound[], updateDate: Date): { updated: InventoryHeaderInfo; applied: KnownHeaderWithUnauthorisedContentFound[] } {
    const rawInventoryHeader = inventoryHeaderInfoToRawInventoryHeaderInfo(header)
    const applied: KnownHeaderWithUnauthorisedContentFound[] = []

    for (const result of results) {
      const headerValuePattern = `^${this.escapeRegex(result.header.value)}$`

      const newMatcherConfig = {
        contentMatcher: headerValuePattern,
        authorisationInfo: {
          description: `Header value detected during inventory run ${updateDate.toISOString()}`,
          authorised: true,
          date: updateDate.toISOString(),
        },
      }

      if (Array.isArray(rawInventoryHeader.authoriseWith)) {
        const patternAlreadyExists = rawInventoryHeader.authoriseWith.some((m: any) => 'contentMatcher' in m && m.contentMatcher === newMatcherConfig.contentMatcher)
        if (!patternAlreadyExists) {
          rawInventoryHeader.authoriseWith.push(newMatcherConfig)
          applied.push(result)
        }
      } else if ('orMatcher' in rawInventoryHeader.authoriseWith) {
        const orChildren = rawInventoryHeader.authoriseWith.orMatcher as any[]
        const patternAlreadyExists = orChildren.some((m: any) => 'contentMatcher' in m && m.contentMatcher === newMatcherConfig.contentMatcher)
        if (!patternAlreadyExists) {
          orChildren.push(newMatcherConfig)
          applied.push(result)
        }
      } else if ('contentMatcher' in rawInventoryHeader.authoriseWith) {
        // Single ContentMatcher: promote to array syntax with the new value
        // OR'd in. Skip if the pattern is already exactly the existing one.
        if (rawInventoryHeader.authoriseWith.contentMatcher !== newMatcherConfig.contentMatcher) {
          rawInventoryHeader.authoriseWith = [rawInventoryHeader.authoriseWith, newMatcherConfig]
          applied.push(result)
        }
      }
      // Other raw shapes unreachable because the outer eligibility gate only
      // batches ContentMatcher / OrMatcher entries.
    }

    return { updated: rawInventoryHeaderInfoToInventoryHeaderInfo(rawInventoryHeader), applied }
  }

  /**
   * Helper to escape regex special characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
