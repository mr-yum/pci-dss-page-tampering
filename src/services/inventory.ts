import type { IInventoryService, IScriptInventoryRepository } from '../interfaces/inventory'
import type { ComparisonResultType, KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header, KnownScriptWithUnauthorisedContentFound, UnknownHeaderFound, UnknownScriptFound } from '../types/comparison'
import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventoryHeaderInfo, RawInventoryScriptInfo } from '../types/inventory/raw'
import type { InventoryServiceProps } from '../types/inventory/props'
import type { PullTarget } from '../types/target'
import { createMatcher } from '../types/matcher/matcher-factory'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { unauthorisedHeadersToInventoryHeaderInfo } from '../utils/header'
import { copyInventory } from '../utils/inventory'
import { getScriptSource, inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo, scriptInfoToInventoryScriptInfo } from '../utils/script'

// Legacy imports for backwards compatibility during migration
import type { HeaderComparisonSummary, ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'

// Import helper functions for header operations
function inventoryHeaderInfoToRawInventoryHeaderInfo(inventoryHeaderInfo: InventoryHeaderInfo): RawInventoryHeaderInfo {
  // Helper function to convert Matcher back to RawMatcherConfig
  function matcherToConfig(matcher: InventoryHeaderInfo['identifyWith']): RawInventoryHeaderInfo['identifyWith'] {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'header-name':
        return { headerNameMatcher: pattern as string }
      case 'content':
        return { contentMatcher: pattern as string }
      default:
        throw new Error(`Unknown matcher type for header: ${matcherType}`)
    }
  }

  // Convert matcher to config and spread into authoriseWith alongside authorisationInfo
  const matcherConfig = matcherToConfig(inventoryHeaderInfo.authoriseWith.matcher)

  return {
    identifyWith: matcherToConfig(inventoryHeaderInfo.identifyWith),
    authoriseWith: {
      ...matcherConfig,
      authorisationInfo: {
        description: inventoryHeaderInfo.authoriseWith.authorisationInfo.description,
        authorised: inventoryHeaderInfo.authoriseWith.authorisationInfo.authorised,
        date: inventoryHeaderInfo.authoriseWith.authorisationInfo.date.toISOString(),
      },
    },
  }
}

function rawInventoryHeaderInfoToInventoryHeaderInfo(rawInventoryHeaderInfo: RawInventoryHeaderInfo): InventoryHeaderInfo {
  const processAuthorizeWith = (rawAuthorizeWith: RawInventoryHeaderInfo['authoriseWith']) => {
    if (Array.isArray(rawAuthorizeWith)) {
      // Array syntax - create OrMatcher
      throw new Error('Array syntax for headers not yet fully implemented - placeholder for processAuthorizeWith')
    }

    const { authorisationInfo, ...matcherConfig } = rawAuthorizeWith
    return {
      matcher: createMatcher(matcherConfig as any),
      authorisationInfo: {
        description: authorisationInfo.description,
        authorised: authorisationInfo.authorised,
        date: new Date(authorisationInfo.date),
      },
    }
  }

  return {
    identifyWith: createMatcher(rawInventoryHeaderInfo.identifyWith),
    authoriseWith: processAuthorizeWith(rawInventoryHeaderInfo.authoriseWith),
  }
}

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
        return this.updateScriptWithNewHash(result, inventory, updateDate)

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

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = result
        throw new Error(`[Inventory → Service] Unhandled comparison result type: ${(_exhaustive as any).type}`)
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
        const hashAlreadyExists = rawInventoryScript.authoriseWith.hashes.some((h) => h.hash.value === newHashInfo.hash.value)
        if (!hashAlreadyExists) {
          rawInventoryScript.authoriseWith.hashes.push(newHashInfo)
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
    const headerValues = [...result.header.value.values()]

    const newHeaders = headerValues.map<InventoryHeaderInfo>((headerValue) => {
      const headerValuePattern = `^${this.escapeRegex(headerValue)}$`

      return {
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
    })

    return copyInventory(inventory, { newHeaders: inventory.headers.concat(newHeaders) })
  }

  /**
   * Update existing header entry with new content matcher (FR-003a/FR-003b).
   */
  private updateHeaderWithNewContent(result: KnownHeaderWithUnauthorisedContentFound_Header, inventory: Inventory, updateDate: Date): Inventory {
    const updatedHeaders = inventory.headers.map((inventoryHeader) => {
      if (inventoryHeader !== result.inventoryEntry) {
        return inventoryHeader
      }

      const rawInventoryHeader = inventoryHeaderInfoToRawInventoryHeaderInfo(inventoryHeader)
      const headerValues = [...result.header.value.values()]

      const newMatcherConfigs = headerValues.map((headerValue) => {
        const headerValuePattern = `^${this.escapeRegex(headerValue)}$`
        return {
          contentMatcher: headerValuePattern,
          authorisationInfo: {
            description: `Header value detected during inventory run ${updateDate.toISOString()}`,
            authorised: true,
            date: updateDate.toISOString(),
          },
        }
      })

      if (Array.isArray(rawInventoryHeader.authoriseWith)) {
        for (const newConfig of newMatcherConfigs) {
          const patternAlreadyExists = rawInventoryHeader.authoriseWith.some((m) => 'contentMatcher' in m && m.contentMatcher === newConfig.contentMatcher)
          if (!patternAlreadyExists) {
            rawInventoryHeader.authoriseWith.push(newConfig)
          }
        }
      } else {
        rawInventoryHeader.authoriseWith = [rawInventoryHeader.authoriseWith, ...newMatcherConfigs]
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

  // Legacy methods - to be removed in Phase 4 (US2)
  private getUpdatedInventoryWithNewScripts(scriptComparisonResult: ScriptComparisonResult, inventory: Inventory, updateDate: Date): Inventory {
    const newScriptsToAdd = scriptComparisonResult.newScripts.map((script) => scriptInfoToInventoryScriptInfo(script, updateDate))
    return copyInventory(inventory, { newScripts: inventory.scripts.concat(newScriptsToAdd) })
  }

  private getUpdatedInventoryWithNewHashes(scriptComparisonResult: ScriptComparisonResult, inventory: Inventory, updateDate: Date): Inventory {
    const newHashesToAdd = scriptComparisonResult.newHashes

    if (newHashesToAdd.length === 0) {
      return copyInventory(inventory)
    }

    // Phase 4 Update: Work with matcher-based inventory structure
    // Need to find matching entries and update their authoriseWith matchers with new hashes
    const updatedScripts = inventory.scripts.map((inventoryScript) => {
      // Check if any of the new hashes belong to this inventory entry
      const matchingNewHashScripts = newHashesToAdd.filter((script) => {
        const detectedScript = {
          name: getScriptSource(script),
          content: script.source.type === 'inline' ? script.source.content : getScriptSource(script),
          hash: script.hash,
        }
        return inventoryScript.identifyWith.identify(detectedScript)
      })

      if (matchingNewHashScripts.length === 0) {
        // No new hashes for this entry, return as-is
        return inventoryScript
      }

      // Convert to raw format to access matcher patterns/hashes
      const rawInventoryScript = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

      // Add new hashes to the authoriseWith configuration
      // Only add if authoriseWith is a hash matcher
      if ('hashes' in rawInventoryScript.authoriseWith) {
        const newHashInfos = matchingNewHashScripts.map((script) => scriptHashToInventoryHashInfo(script, updateDate))
        rawInventoryScript.authoriseWith.hashes.push(...newHashInfos)
      } else {
        // authoriseWith is not a hash matcher (it's content or name matcher)
        // This shouldn't happen in normal flow, but log a warning
        console.warn(`[Inventory → Service] Script identified but authoriseWith is not a hash matcher. Cannot add new hash. Entry: ${JSON.stringify(rawInventoryScript.identifyWith)}`)
      }

      // Convert back to InventoryScriptInfo with updated matchers
      return rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScript)
    })

    return copyInventory(inventory, { newScripts: updatedScripts })
  }

  private getUpdatedInventoryWithNewHeaders(headerComparisonSummary: HeaderComparisonSummary, inventory: Inventory, updateDate: Date): Inventory {
    let headers: InventoryHeaderInfo[]

    if (headerComparisonSummary.unauthorisedHeaders) {
      headers = unauthorisedHeadersToInventoryHeaderInfo(headerComparisonSummary.unauthorisedHeaders, updateDate).concat(inventory.headers)
    } else {
      headers = inventory.headers
    }

    return {
      fileName: inventory.fileName,
      target: inventory.target,
      alerts: inventory.alerts,
      scripts: inventory.scripts,
      headers: headers,
    }
  }
}
