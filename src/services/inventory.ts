import type { Inventory } from '../types/inventory'
import type { ScriptComparisonSummary } from '../types/comparison'

import { uatWorkflow as uatWorkflow10 } from '../workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from '../workflows/2.0'
import { scriptInfoToInventoryScriptInfo } from '../utils/script'
import type { ExternalScriptSource } from '../types/script'
import { scriptHashToInventoryHashInfo } from '../utils/hash'

interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  push(comparisonSummary: ScriptComparisonSummary): Promise<void>
}

export class InMemoryScriptInventoryService implements IScriptInventoryService {
  private _inventory: Inventory[] = [
    {
      target: {
        inventory: { type: 'inventory', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' },
        detection: { type: 'detection', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' }, // TODO: replace with production target
        workflow: uatWorkflow10,
      },
      scripts: [],
    },
    {
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: uatWorkflow20,
      },
      scripts: [],
    },
  ]

  async pull(): Promise<Inventory[]> {
    return this._inventory
  }

  async push(comparisonSummary: ScriptComparisonSummary): Promise<void> {
    if (comparisonSummary.target.type !== 'inventory') {
      console.error('[Inventory] Cannot inventory scripts from detection target! Skipping...')
      return Promise.resolve()
    }

    const updateDate = new Date()

    this.pushNewScripts(comparisonSummary, updateDate)
    this.pushNewHashes(comparisonSummary, updateDate)
  }

  private pushNewScripts(comparisonSummary: ScriptComparisonSummary, updateDate: Date): void {
    const newScripts = comparisonSummary.externalScripts.newScripts.map((script) => scriptInfoToInventoryScriptInfo(script, updateDate))

    console.log(`[Inventory] Adding new scripts to inventory for target: '${comparisonSummary.target.url}'.`)
    this._inventory.find((inventory) => inventory.target.inventory === comparisonSummary.target)?.scripts.concat(newScripts)
    console.log(`[Inventory] New scripts successfully added to inventory for target: '${comparisonSummary.target.url}'.`)
  }

  private pushNewHashes(comparisonSummary: ScriptComparisonSummary, updateDate: Date): void {
    const newHashes = comparisonSummary.externalScripts.newHashes
    const inventory = this._inventory.find((inventory) => inventory.target.inventory === comparisonSummary.target)

    // We always expect to have an inventory entry for new hashes from the comparison stage.
    if (inventory === undefined) {
      throw new Error("[Inventory] Expected to find inventory for new script hash, but it doesn't exist!")
    }

    // Add new hash to inventory script known hashes
    newHashes.forEach((script) => {
      const scriptUrl = (script.source as ExternalScriptSource).url
      const inventoryScript = inventory.scripts.find((inventoryScript) => inventoryScript.matcher.test(scriptUrl))

      // We always expect to have an inventory script entry from the comparison stage
      if (inventoryScript === undefined) {
        throw new Error("[Inventory] Expected to find inventory script entry for new script hash, but it doesn't exist!")
      }

      console.log(`[Inventory] Adding new script hash to inventory script entry for target: '${comparisonSummary.target.url}'.`)
      inventoryScript.hashes.push(scriptHashToInventoryHashInfo(script, updateDate))
      console.log(`[Inventory] New script hash successfully added to inventory script entry for target: '${comparisonSummary.target.url}'.`)
    })
  }
}
