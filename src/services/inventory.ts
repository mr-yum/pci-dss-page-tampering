import type { IInventoryService, IScriptInventoryRepository } from '../interfaces/inventory'
import type { HeaderComparisonSummary, ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'
import type { Inventory, InventoryDifferenceResult, InventoryHeaderInfo } from '../types/inventory/model'
import type { InventoryServiceProps } from '../types/inventory/props'
import type { PullTarget } from '../types/target'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { unauthorisedHeadersToInventoryHeaderInfo } from '../utils/header'
import { copyInventory } from '../utils/inventory'
import { getScriptSource, inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo, scriptInfoToInventoryScriptInfo } from '../utils/script'

export class ScriptInventoryService implements IInventoryService {
  private _repository: IScriptInventoryRepository

  constructor(args: InventoryServiceProps) {
    this._repository = args.inventoryRepository
  }

  async pull(target: PullTarget): Promise<Inventory[]> {
    console.log('[Inventory → Service] Pulling inventory from store.')
    return await this._repository.pull(target)
  }

  diff(inventory: Inventory, scriptComparisonSummary: ScriptComparisonSummary, headerComparisonSummary: HeaderComparisonSummary): Promise<InventoryDifferenceResult> {
    if (scriptComparisonSummary.target.type !== 'inventory' || headerComparisonSummary.target.type !== 'inventory') {
      return Promise.reject(new Error('[Inventory → Service] Cannot run diff with inventory scripts from detection target! Skipping...'))
    }

    const updateDate = new Date()

    const updatedInventoryWithExternalScripts = this.getUpdatedInventoryWithNewScripts(scriptComparisonSummary.externalScripts, inventory, updateDate)
    const updatedInventoryWithExternalHashes = this.getUpdatedInventoryWithNewHashes(scriptComparisonSummary.externalScripts, updatedInventoryWithExternalScripts, updateDate)

    const updatedInventoryWithInLineScripts = this.getUpdatedInventoryWithNewScripts(scriptComparisonSummary.inlineScripts, updatedInventoryWithExternalHashes, updateDate)
    const updatedInventoryWithInLineHashes = this.getUpdatedInventoryWithNewHashes(scriptComparisonSummary.inlineScripts, updatedInventoryWithInLineScripts, updateDate)

    const updatedInventoryWithHeaders = this.getUpdatedInventoryWithNewHeaders(headerComparisonSummary, updatedInventoryWithInLineHashes, updateDate)

    return Promise.resolve({
      oldInventory: inventory,
      newInventory: updatedInventoryWithHeaders,
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
