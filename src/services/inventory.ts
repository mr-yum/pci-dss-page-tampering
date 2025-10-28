import { HashMatcher } from 'src/types/matcher/hash-matcher'

import type { IInventoryService, IScriptInventoryRepository } from '../interfaces/inventory'
import type { ComparisonResultType, KnownScriptWithUnauthorisedContentFound, UnknownScriptFound } from '../types/comparison'
import type { KnownHeaderWithUnauthorisedContentFound } from '../types/comparison/known-header-unauthorised-content-found'
import type { UnknownHeaderFound } from '../types/comparison/unknown-header-found'
import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model'
import type { InventoryServiceProps } from '../types/inventory/props'
import { createMatcher } from '../types/matcher/matcher-factory'
import type { PullTarget } from '../types/target'
import { copyInventory, inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script'

export class ScriptInventoryService implements IInventoryService {
  private _repository: IScriptInventoryRepository

  constructor(args: InventoryServiceProps) {
    this._repository = args.inventoryRepository
  }

  async pull(target: PullTarget): Promise<Inventory[]> {
    console.log('[Inventory → Service] Pulling inventory from store.')
    return await this._repository.pull(target)
  }

  diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult> {
    // Validation: Ensure all results are from inventory workflow (FR-008)
    const hasDetectionResults = comparisonResults.some((result) => result.target.type !== 'inventory')
    if (hasDetectionResults) {
      return Promise.reject(new Error('[Inventory → Service] Cannot run diff with results from detection target! Skipping...'))
    }

    const updateDate = new Date()
    let updatedInventory = copyInventory(inventory)

    // Single pass through all comparison results
    for (const result of comparisonResults) {
      updatedInventory = this.processComparisonResult(result, updatedInventory, updateDate)
    }

    return Promise.resolve({
      oldInventory: inventory,
      newInventory: updatedInventory,
    })
  }

  push(diffs: InventoryDifferenceResult[]): Promise<void> {
    if (diffs.length !== 0) {
      console.log('[Inventory → Service] Pushing script differences to inventory.')
      const inventoriesToPush = diffs.map((diff) => diff.newInventory)
      return this._repository.push(inventoriesToPush)
    }

    return Promise.resolve()
  }

  /**
   * Process a single comparison result and return updated inventory.
   * Uses discriminated union exhaustive checking to handle all result types.
   *
   * @param result - Typed comparison result
   * @param inventory - Current inventory state
   * @param updateDate - Timestamp for authorization metadata
   * @returns Updated inventory with changes applied
   */
  private processComparisonResult(result: ComparisonResultType, inventory: Inventory, updateDate: Date): Inventory {
    switch (result.type) {
      case 'unknown_script_found':
        return this.addNewScript(result, inventory, updateDate)

      case 'known_script_unauthorised_content':
        // Only add new hash to existing entry if the authorization matcher is a hash matcher.
        // Content or name matchers authorize scripts by pattern matching, not by hash values,
        // so adding hashes would be inappropriate for those matcher types.
        if (result.authorizationMatcher instanceof HashMatcher) {
          return this.updateScriptWithNewHash(result, inventory, updateDate)
        }
        return inventory

      case 'authorized_script':
        // Script already authorized, no changes needed
        return inventory

      case 'unknown_header_found':
        return this.addNewHeader(result, inventory, updateDate)

      case 'known_header_unauthorised_content':
        return this.updateHeaderWithNewContent(result, inventory, updateDate)

      case 'authorized_header':
        // Header already authorized, no changes needed
        return inventory

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = result
        throw new Error(`[Inventory → Service] Unhandled comparison result type: ${(_exhaustive as any).type}`)
      }
    }
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
   * Update existing script entry with new hash (FR-002a/FR-002b).
   */
  private updateScriptWithNewHash(result: KnownScriptWithUnauthorisedContentFound, inventory: Inventory, updateDate: Date): Inventory {
    const updatedScripts = inventory.scripts.map((inventoryScript) => {
      if (inventoryScript !== result.inventoryEntry) {
        return inventoryScript
      }

      const rawInventoryScript = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)
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

      return rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScript)
    })

    return copyInventory(inventory, { newScripts: updatedScripts })
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
   * Update existing header entry with new content matcher (FR-003a/FR-003b).
   */
  private updateHeaderWithNewContent(result: KnownHeaderWithUnauthorisedContentFound, inventory: Inventory, updateDate: Date): Inventory {
    const updatedHeaders = inventory.headers.map((inventoryHeader) => {
      if (inventoryHeader !== result.inventoryEntry) {
        return inventoryHeader
      }

      const rawInventoryHeader = inventoryHeaderInfoToRawInventoryHeaderInfo(inventoryHeader)
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

      return rawInventoryHeaderInfoToInventoryHeaderInfo(rawInventoryHeader)
    })

    return copyInventory(inventory, { newHeaders: updatedHeaders })
  }

  /**
   * Helper to escape regex special characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
