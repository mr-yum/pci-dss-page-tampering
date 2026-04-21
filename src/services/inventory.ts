import type { IInventoryService, IScriptInventoryRepository } from '../interfaces/inventory'
import type { ComparisonResultType, KnownScriptWithUnauthorisedContentFound, UnknownScriptFound } from '../types/comparison'
import type { KnownHeaderWithUnauthorisedContentFound } from '../types/comparison/known-header-unauthorised-content-found'
import type { UnknownHeaderFound } from '../types/comparison/unknown-header-found'
import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model'
import type { InventoryServiceProps } from '../types/inventory/props'
import { HashMatcher } from '../types/matcher/hash-matcher'
import { createMatcher } from '../types/matcher/matcher-factory'
import type { PullTarget } from '../types/target'
import { copyInventory, inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script'

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

    // First pass: partition results. Updates targeting an existing inventory entry
    // are grouped by `inventoryEntry` reference so that multiple updates for the
    // same entry can be applied together — otherwise the first update replaces
    // the entry with a new object, stranding later updates whose `inventoryEntry`
    // still points at the original reference.
    const unknownScripts: UnknownScriptFound[] = []
    const unknownHeaders: UnknownHeaderFound[] = []
    const scriptHashUpdates = new Map<InventoryScriptInfo, KnownScriptWithUnauthorisedContentFound[]>()
    const headerContentUpdates = new Map<InventoryHeaderInfo, KnownHeaderWithUnauthorisedContentFound[]>()

    for (const result of comparisonResults) {
      switch (result.type) {
        case 'unknown_script_found':
          unknownScripts.push(result)
          break
        case 'known_script_unauthorised_content':
          // Only batch when authorization was by hash matcher (other matcher types
          // authorize by pattern, not by hash, so hash additions are inappropriate).
          if (result.authorizationMatcher instanceof HashMatcher) {
            const existing = scriptHashUpdates.get(result.inventoryEntry) ?? []
            existing.push(result)
            scriptHashUpdates.set(result.inventoryEntry, existing)
          }
          break
        case 'unknown_header_found':
          unknownHeaders.push(result)
          break
        case 'known_header_unauthorised_content': {
          const existing = headerContentUpdates.get(result.inventoryEntry) ?? []
          existing.push(result)
          headerContentUpdates.set(result.inventoryEntry, existing)
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

    // Second pass: apply batched updates, one entry at a time.
    const updatedScripts = inventory.scripts.map((script) => {
      const updates = scriptHashUpdates.get(script)
      return updates && updates.length > 0 ? this.applyScriptHashUpdates(script, updates, updateDate) : script
    })

    const updatedHeaders = inventory.headers.map((header) => {
      const updates = headerContentUpdates.get(header)
      return updates && updates.length > 0 ? this.applyHeaderContentUpdates(header, updates, updateDate) : header
    })

    let updatedInventory = copyInventory(inventory, { newScripts: updatedScripts, newHeaders: updatedHeaders })

    // Append new scripts/headers from unknown_* results.
    for (const result of unknownScripts) {
      updatedInventory = this.addNewScript(result, updatedInventory, updateDate)
    }
    for (const result of unknownHeaders) {
      updatedInventory = this.addNewHeader(result, updatedInventory, updateDate)
    }

    return Promise.resolve({
      oldInventory: inventory,
      newInventory: updatedInventory,
    })
  }

  push(diffs: InventoryDifferenceResult[], branchName?: string): Promise<void> {
    if (diffs.length !== 0) {
      console.log('[Inventory → Service] Pushing script differences to inventory.')
      const inventoriesToPush = diffs.map((diff) => diff.newInventory)
      return this._repository.push(inventoriesToPush, branchName)
    }

    return Promise.resolve()
  }

  /**
   * Add a new script to inventory (FR-001).
   * Creates a new inventory entry from UnknownScriptFound result.
   */
  private addNewScript(result: UnknownScriptFound, inventory: Inventory, updateDate: Date): Inventory {
    const scriptSource = result.script.name
    const escapedPattern = `^${this.escapeRegex(scriptSource)}$`

    const newScript: InventoryScriptInfo = {
      identifyWith: createMatcher({ nameMatcher: escapedPattern }),
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
   */
  private applyScriptHashUpdates(script: InventoryScriptInfo, results: KnownScriptWithUnauthorisedContentFound[], updateDate: Date): InventoryScriptInfo {
    const rawInventoryScript = inventoryScriptInfoToRawInventoryScriptInfo(script)

    for (const result of results) {
      const newHashInfo = { timestamp: result.timestamp, hash: result.script.hash }

      // FR-002a: If authoriseWith has hashes array, add to it
      if ('hashes' in rawInventoryScript.authoriseWith) {
        const hashAlreadyExists = rawInventoryScript.authoriseWith.hashes.some((h: any) => h.hash.value === newHashInfo.hash.value)
        if (!hashAlreadyExists) {
          rawInventoryScript.authoriseWith.hashes.push(newHashInfo)
        }
      } else if (Array.isArray(rawInventoryScript.authoriseWith)) {
        // FR-002b: Already array syntax, append new hash matcher
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
        }
      } else {
        // FR-002b: Convert single matcher to array syntax
        rawInventoryScript.authoriseWith = [
          rawInventoryScript.authoriseWith,
          {
            hashes: [newHashInfo],
            authorisationInfo: {
              description: `Hash detected during inventory run ${updateDate.toISOString()}`,
              authorised: true,
              date: updateDate.toISOString(),
            },
          },
        ]
      }
    }

    return rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScript)
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
   * Converts to raw once, accumulates all new content matchers, then converts back once.
   * Batching is required because multiple unauthorised values detected in one run often
   * share the same `inventoryEntry` (e.g. many CSP directives matched by one header entry);
   * applying them one at a time would replace the entry after the first update and strand
   * the rest.
   */
  private applyHeaderContentUpdates(header: InventoryHeaderInfo, results: KnownHeaderWithUnauthorisedContentFound[], updateDate: Date): InventoryHeaderInfo {
    const rawInventoryHeader = inventoryHeaderInfoToRawInventoryHeaderInfo(header)

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
        }
      } else {
        rawInventoryHeader.authoriseWith = [rawInventoryHeader.authoriseWith, newMatcherConfig]
      }
    }

    return rawInventoryHeaderInfoToInventoryHeaderInfo(rawInventoryHeader)
  }

  /**
   * Helper to escape regex special characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
