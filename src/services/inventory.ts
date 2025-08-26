import type { IScriptInventoryRepository, IScriptInventoryService } from '../interfaces/inventory'
import type { Inventory, InventoryDifferenceResult } from '../types/inventory/model'
import type { InventoryServiceProps } from '../types/inventory/props'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'

import { getScriptSource, scriptInfoToInventoryScriptInfo } from '../utils/script'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { copyInventory } from '../utils/inventory'

export class ScriptInventoryService implements IScriptInventoryService {
  private _repository: IScriptInventoryRepository

  constructor(args: InventoryServiceProps) {
    this._repository = args.inventoryRepository
  }

  async pull(): Promise<Inventory[]> {
    console.log('[Inventory → Service] Pulling inventory from store.')
    return await this._repository.pull()
  }

  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory): Promise<InventoryDifferenceResult> {
    if (comparisonSummary.target.type !== 'inventory') {
      return Promise.reject(new Error('[Inventory → Service] Cannot run diff with inventory scripts from detection target! Skipping...'))
    }

    const updateDate = new Date()

    const updatedInventoryWithExternalScripts = this.getUpdatedInventoryWithNewScripts(comparisonSummary.externalScripts, inventory, updateDate)
    const updatedInventoryWithExternalHashes = this.getUpdatedInventoryWithNewHashes(comparisonSummary.externalScripts, updatedInventoryWithExternalScripts, updateDate)

    const updatedInventoryWithInLineScripts = this.getUpdatedInventoryWithNewScripts(comparisonSummary.inlineScripts, updatedInventoryWithExternalHashes, updateDate)
    const updatedInventoryWithInLineHashes = this.getUpdatedInventoryWithNewHashes(comparisonSummary.inlineScripts, updatedInventoryWithInLineScripts, updateDate)

    return Promise.resolve({
      oldInventory: inventory,
      newInventory: updatedInventoryWithInLineHashes,
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
    const newInventoryWithNewHashes = copyInventory(inventory)

    if (newHashesToAdd.length !== 0) {
      // Add new hash to inventory script known hashes
      newHashesToAdd.forEach((script) => {
        const inventoryScript = newInventoryWithNewHashes.scripts.find((inventoryScript) => inventoryScript.matcher.test(getScriptSource(script)))

        // We always expect to have an inventory script entry from the comparison stage
        if (!inventoryScript) {
          throw new Error("[Inventory → Service] Expected to find inventory script entry for new script hash, but it doesn't exist!")
        }

        inventoryScript.hashes.push(scriptHashToInventoryHashInfo(script, updateDate))
      })
    }

    return newInventoryWithNewHashes
  }
}
