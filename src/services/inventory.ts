import type { Inventory, InventoryScriptInfo } from '../types/inventory'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'

import { uatWorkflow as uatWorkflow10 } from '../workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from '../workflows/2.0'

import { getScriptSource, scriptInfoToInventoryScriptInfo } from '../utils/script'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { maybeGetInventoryForTarget } from '../utils/inventory'

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
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://app-dev\\.meandu\\.com/config\\.production\\.js\\?v=.+$')),
        this.createDefaultInventoryScript(RegExp('^blob:https://app-dev\\.meandu\\.com/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/[a-z]{2}_[A-Z]{2}/sdk\\.js\\?hash=[a-f0-9]{32}$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise\\.js\\?render=.+$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise/webworker\\.js\\?.*$')),
      ],
    },
    {
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: uatWorkflow20,
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://www\\.googletagmanager\\.com/gtag/js\\?id=G-[A-Z0-9]+$')),
        this.createDefaultInventoryScript(RegExp('^https://hcaptcha\\.com/1/api\\.js\\?.*$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/signals/config/\\d+\\?.*$')),
      ],
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
    const target = comparisonSummary.target

    this.pushNewScripts(comparisonSummary.externalScripts, updateDate, target)
    this.pushNewHashes(comparisonSummary.externalScripts, updateDate, target)

    this.pushNewScripts(comparisonSummary.inlineScripts, updateDate, target)
    this.pushNewHashes(comparisonSummary.inlineScripts, updateDate, target)
  }

  private pushNewScripts(scriptComparisonResult: ScriptComparisonResult, updateDate: Date, target: Target): void {
    const newScripts = scriptComparisonResult.newScripts.map((script) => scriptInfoToInventoryScriptInfo(script, updateDate))
    const inventory = maybeGetInventoryForTarget(this._inventory, target)

    // We always expect to have an inventory entry for new hashes from the comparison stage.
    if (inventory === undefined) {
      throw new Error("[Inventory] Expected to find inventory for new script hash, but it doesn't exist!")
    } else if (newScripts.length !== 0) {
      console.log(`[Inventory] Adding new scripts to inventory for target: '${target.url}'.`)
      inventory.scripts = inventory.scripts.concat(newScripts) // Mutation :vomit:
      console.log(`[Inventory] New scripts successfully added to inventory for target: '${target.url}'.`)
    }
  }

  private pushNewHashes(scriptComparisonResult: ScriptComparisonResult, updateDate: Date, target: Target): void {
    const newHashes = scriptComparisonResult.newHashes
    const inventory = maybeGetInventoryForTarget(this._inventory, target)

    // We always expect to have an inventory entry for new hashes from the comparison stage.
    if (inventory === undefined) {
      throw new Error("[Inventory] Expected to find inventory for new script hash, but it doesn't exist!")
    } else if (newHashes.length !== 0) {
      // Add new hash to inventory script known hashes
      newHashes.forEach((script) => {
        const inventoryScript = inventory.scripts.find((inventoryScript) => inventoryScript.matcher.test(getScriptSource(script)))

        // We always expect to have an inventory script entry from the comparison stage
        if (inventoryScript === undefined) {
          throw new Error("[Inventory] Expected to find inventory script entry for new script hash, but it doesn't exist!")
        }

        console.log(`[Inventory] Adding new script hash to inventory script entry for target: '${target.url}'.`)
        inventoryScript.hashes.push(scriptHashToInventoryHashInfo(script, updateDate))
        console.log(`[Inventory] New script hash successfully added to inventory script entry for target: '${target.url}'.`)
      })
    }
  }

  private createDefaultInventoryScript(regex: RegExp): InventoryScriptInfo {
    return {
      matcher: regex,
      hashes: [],
      authorisationInfo: {
        description: 'Script that doesnt save with default implementation due to query string',
        authorised: true,
        date: new Date(),
      },
    }
  }
}
