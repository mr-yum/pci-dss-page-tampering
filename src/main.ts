import simpleGit from 'simple-git'
import puppeteer, { type Browser } from 'puppeteer'

import { ScriptInventoryRepository } from './repositories/inventory'
import { SlackAlertService } from './services/alert/slack'
import { ScriptComparisonService } from './services/comparison/script'
import { DetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { GitInventoryStore } from './stores/inventory/git'
import { PullTarget, type Target } from './types/target'
import { HeaderComparisonService } from './services/comparison/header'

import type { Inventory, InventoryDifferenceResult } from './types/inventory/model'
import { getScriptContentMatchersFromInventory } from './utils/script/matcher'

// Just to test the CI run-on-github workflow
async function main() {
  const gitToken =
    process.env['INVENTORY_REPO_PAT'] ??
    (() => {
      throw new Error('INVENTORY_REPO_PAT environment variable is required')
    })()
  const slackToken =
    process.env['SLACK_OATH_TOKEN'] ??
    (() => {
      throw new Error('SLACK_OATH_TOKEN environment variable is required')
    })()
  const gitInventoryStore = new GitInventoryStore({ gitClient: simpleGit(), repositoryTarget: `https://x-access-token:${gitToken}@github.com/mr-yum/script-inventory.git` })
  const scriptInventoryRepository = new ScriptInventoryRepository({ inventoryStore: gitInventoryStore })
  const scriptInventoryService = new ScriptInventoryService({ inventoryRepository: scriptInventoryRepository })
  const detectionService = new DetectionService()
  const scriptComparisonService = new ScriptComparisonService()
  const headerComparisonService = new HeaderComparisonService()
  const slackAlertService = new SlackAlertService(slackToken)

  const log = (message: string): void => {
    console.log(`[Main]: ${message}`)
  }

  const runForTargetAsync = async (browser: Browser, payload: Inventory, target: Target): Promise<InventoryDifferenceResult | null> => {
    try {
      console.log(`[Main]: Starting processing for target: ${target.url}`)

      // Get content matchers for in-script detection
      const scriptMatchers = getScriptContentMatchersFromInventory(payload)

      // Prepare to run resource detection
      const detectResourcesForTarget = detectionService.detect(browser, target, scriptMatchers)

      // Run resource detection
      const detectionSummaryForTarget = await detectResourcesForTarget

      // Run script comparison with inventory
      const scriptComparisonSummaryForTarget = await scriptComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.scriptSummary, scriptMatchers)

      // Run header comparison with inventory
      const headerComparisonSummaryForTarget = await headerComparisonService.compare(detectionSummaryForTarget.target, payload, detectionSummaryForTarget.headerSummary)

      // Alert for inventory and target
      await slackAlertService.alertForScripts(scriptComparisonSummaryForTarget, target, payload.alerts)
      await slackAlertService.alertForHeaders(headerComparisonSummaryForTarget, target, payload.alerts)

      // Run inventory sanity check and return to push to inventory
      if (target.type === 'inventory') {
        return await scriptInventoryService.diff(payload, scriptComparisonSummaryForTarget, headerComparisonSummaryForTarget)
      } else {
        return null
      }
    } catch (error) {
      console.error(`[Main]: Error processing target: ${target.url}`)
      if (error instanceof Error) {
        console.error(`[Main]: Error name: ${error.name}`)
        console.error(`[Main]: Error message: ${error.message}`)
        console.error(`[Main]: Stack trace:`, error.stack)
      } else {
        console.error(`[Main]: Error: ${error}`)
      }
      throw error // Re-throw to maintain error propagation
    }
  }

  // Launch new Browser for executing Puppeteer workflow
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  // Pull inventory
  log('Preparing to pull inventory.')
  const inventory = await scriptInventoryService.pull(PullTarget.Inventory)

  // Run inventory workflow
  log('Preparing to run inventory workflow.')
  const inventoryDiffResults = await Promise.all(
    inventory.map(async (inventory) => {
      const inventoryResult = await runForTargetAsync(browser, inventory, inventory.target.inventory)
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
      await runForTargetAsync(browser, inventory, inventory.target.detection)
    }),
  )

  // Close browser
  await browser.close()
}

main().catch((error) => {
  console.error('[Main]: Application failed')
  if (error instanceof Error) {
    console.error(`[Main]: Error name: ${error.name}`)
    console.error(`[Main]: Error message: ${error.message}`)
    console.error(`[Main]: Stack trace:`, error.stack)
  } else {
    console.error(`[Main]: Error: ${error}`)
  }
  process.exit(1)
})
