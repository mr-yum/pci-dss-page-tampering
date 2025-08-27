import simpleGit from 'simple-git'
import puppeteer from 'puppeteer'

import { ScriptInventoryRepository } from './repositories/inventory'
import { SlackAlertService } from './services/alert'
import { ScriptComparisonService } from './services/comparison/script'
import { DetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { GitInventoryStore } from './stores/inventory/git'
import { PullTarget, type Target } from './types/target'

import type { Inventory, InventoryDifferenceResult } from './types/inventory/model'
import { HeaderComparisonService } from './services/comparison/header'

async function main() {
  const gitInventoryStore = new GitInventoryStore({ gitClient: simpleGit(), repositoryTarget: 'git@github.com:mr-yum/script-inventory.git' })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()
  const slackAlertService = new SlackAlertService()

  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

  const runForTargetAsync = async (payload: Inventory, target: Target): Promise<InventoryDifferenceResult | null> => {
    // Launch new Browser for executing Puppeteer workflow
    const browser = await puppeteer.launch()

    // Prepare to run resource detection
    const detectResourcesForTarget = detectionService.detect(browser, target, payload.target.workflow)

    // Run resource detection
    const detectionSummaryForTarget = await detectResourcesForTarget

    console.log(detectionSummaryForTarget.headerSummary.headers)

    // Run script comparison with inventory
    const scriptComparisonSummaryForTarget = await scriptComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.scriptSummary)

    // Run header comparison with inventory
    const headerComparisonSummaryForTarget = await headerComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.headerSummary)

    // Alert for inventory and target
    await slackAlertService.alertForScripts(scriptComparisonSummaryForTarget, target)
    await slackAlertService.alertForHeaders(headerComparisonSummaryForTarget, target)

    // Close browser
    await browser.close()

    // Run inventory sanity check and return to push to inventory
    if (target.type === 'inventory') {
      return await scriptInventoryService.diff(payload, scriptComparisonSummaryForTarget, headerComparisonSummaryForTarget)
    } else {
      return null
    }
  }

  // Pull inventory
  log('Preparing to pull inventory.')
  const inventory = await scriptInventoryService.pull(PullTarget.Inventory)

  // Run inventory workflow
  log('Preparing to run inventory workflow.')
  const inventoryDiffResults = await Promise.all(
    inventory.map(async (inventory) => {
      const inventoryResult = await runForTargetAsync(inventory, inventory.target.inventory)
      return {
        inventoryResult: inventoryResult ?? (await Promise.reject('Expected inventory diff result to exist, but received null!')),
      }
    }),
  )

  // Push inventory
  log('Preparing to push inventory.')
  const inventoriesToPush = inventoryDiffResults.map((result) => result.inventoryResult!)
  await scriptInventoryService.push(inventoriesToPush)

  // Pull inventory
  log('Preparing to pull inventory.')
  const detectionInventory = await scriptInventoryService.pull(PullTarget.Detection)

  // Run detection workflow
  log('Preparing to run detection workflow.')
  await Promise.all(
    detectionInventory.map(async (inventory) => {
      await runForTargetAsync(inventory, inventory.target.detection)
    }),
  )
}

main().catch(console.error)
