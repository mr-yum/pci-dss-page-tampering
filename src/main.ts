import simpleGit from 'simple-git'

import { ScriptInventoryRepository } from './repositories/inventory'
import { SlackAlertService } from './services/alert'
import { ScriptComparisonService } from './services/comparison'
import { ScriptDetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { GitInventoryStore } from './stores/inventory/git'
import type { Inventory, InventoryDifferenceResult } from './types/inventory/model'
import puppeteer from 'puppeteer'
import type { Target } from './types/target'

async function main() {
  const gitInventoryStore = new GitInventoryStore({ gitClient: simpleGit(), repositoryTarget: 'git@github.com:mr-yum/script-inventory.git' })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const scriptDetectionService = new ScriptDetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const slackAlertService = new SlackAlertService()

  const runForTargetAsync = async (payload: Inventory, target: Target): Promise<InventoryDifferenceResult | null> => {
    // Launch new Browser for executing Puppeteer workflow
    const browser = await puppeteer.launch()

    // Prepare to run script detection
    const detectScriptsFromTarget = scriptDetectionService.detectScripts(browser, target, payload.target.workflow)

    // Run script detection
    const scriptDetectionSummaryForTarget = await detectScriptsFromTarget

    // Run script comparison with inventory
    const comparisonResultForTarget = await scriptComparisonService.compare(payload, scriptDetectionSummaryForTarget)

    // Alert for inventory and target
    await slackAlertService.alert(comparisonResultForTarget, target)

    // Close browser
    await browser.close()

    // Run inventory sanity check and return to push to inventory
    if (target.type === 'inventory') {
      return await scriptInventoryService.diff(comparisonResultForTarget, payload)
    } else {
      return null
    }
  }

  // Pull inventory
  const inventory = await scriptInventoryService.pull()

  // Run detection workflow
  const inventoryDiffResults = await Promise.all(
    inventory.map(async (inventory) => {
      await runForTargetAsync(inventory, inventory.target.detection)
      return {
        inventoryResult: (await runForTargetAsync(inventory, inventory.target.inventory)) ?? (await Promise.reject('Expected inventory diff result to exist, but received null!')),
      }
    }),
  )

  // Push inventories
  const inventoriesToPush = inventoryDiffResults.map((result) => result.inventoryResult!)
  await scriptInventoryService.push(inventoriesToPush)
}

main().catch(console.error)
