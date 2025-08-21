import type { Inventory, InventoryDifferenceResult } from '../types/inventory'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'
import type { IInventoryStore } from '../stores/inventory'

import { getScriptSource, scriptInfoToInventoryScriptInfo } from '../utils/script'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { copyInventory, maybeGetInventoryForTarget } from '../utils/inventory'

interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory[]): Promise<InventoryDifferenceResult>
  push(diffs: InventoryDifferenceResult[]): Promise<void>
}

export type InventoryStoreProps = {
  inventoryStore: IInventoryStore
}

export class ScriptInventoryService implements IScriptInventoryService {
  private _inventoryStore: IInventoryStore

  constructor(args: InventoryStoreProps) {
    this._inventoryStore = args.inventoryStore
  }

  pull(): Promise<Inventory[]> {
    return this._inventoryStore.pull()
  }

  diff(comparisonSummary: ScriptComparisonSummary, inventory: Inventory[]): Promise<InventoryDifferenceResult> {
    if (comparisonSummary.target.type !== 'inventory') {
      return Promise.reject(new Error('[Inventory] Cannot run diff with inventory scripts from detection target! Skipping...'))
    }

    const updateDate = new Date()
    const target = comparisonSummary.target
    const inventoryForTarget = maybeGetInventoryForTarget(inventory, target)

    if (!inventoryForTarget) {
      throw new Error(`[Inventory] Expected inventory for target '${target.url}', but it doesn't exist!`)
    }

    const updatedInventoryWithExternalScripts = this.getUpdatedInventoryWithNewScripts(comparisonSummary.externalScripts, inventoryForTarget, updateDate)
    const updatedInventoryWithExternalHashes = this.getUpdatedInventoryWithNewHashes(comparisonSummary.externalScripts, updatedInventoryWithExternalScripts, updateDate)

    const updatedInventoryWithInLineScripts = this.getUpdatedInventoryWithNewScripts(comparisonSummary.inlineScripts, updatedInventoryWithExternalHashes, updateDate)
    const updatedInventoryWithInLineHashes = this.getUpdatedInventoryWithNewHashes(comparisonSummary.inlineScripts, updatedInventoryWithInLineScripts, updateDate)

    return Promise.resolve({
      oldInventory: inventoryForTarget,
      newInventory: updatedInventoryWithInLineHashes,
    })
  }

  push(diffs: InventoryDifferenceResult[]): Promise<void> {
    console.log('[Inventory] Pushing script differences to inventory store.')
    return this._inventoryStore.push(diffs.map((diff) => diff.newInventory))
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
          throw new Error("[Inventory] Expected to find inventory script entry for new script hash, but it doesn't exist!")
        }

        inventoryScript.hashes.push(scriptHashToInventoryHashInfo(script, updateDate))
      })
    }

    return newInventoryWithNewHashes
  }
}
