import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { ScriptInventoryService } from './services/inventory'
import { ScriptComparisonService } from './services/comparison'

import type { ScriptDetectionSummary } from './types/script'
import type { ScriptComparisonSummary } from './types/comparison'
import type { Inventory } from './types/inventory'
import { GitInventoryStore } from './stores/inventory/git'
import simpleGit from 'simple-git'

async function main() {
  const gitInventoryStore = new GitInventoryStore({ gitClient: simpleGit(), repositoryTarget: 'git@github.com:mr-yum/script-inventory.git', clonePath: './pulled_repo' })
  const scriptInventoryService = new ScriptInventoryService({ inventoryStore: gitInventoryStore })
  const scriptDetectionService = new ScriptDetectionService()
  const scriptComparisonService = new ScriptComparisonService()

  const detectedScriptToCompare = (inventory: Inventory[], detectionSummary: ScriptDetectionSummary[]): Promise<ScriptComparisonSummary>[] => {
    return detectionSummary.map((scriptDetectionSummary) => {
      const inventoryPayload = inventory.find((payload) => payload.target.inventory.url === scriptDetectionSummary.target.url)!
      return scriptComparisonService.compare(inventoryPayload, scriptDetectionSummary)
    })
  }

  while (true) {
    // Pull inventory
    const inventory = await scriptInventoryService.pull()

    // Launch new Browser for executing Puppeteer workflow
    const browser = await puppeteer.launch()

    // Prepare to run script detection
    const detectScriptsFromDetectionTarget = inventory.map((payload) => scriptDetectionService.detectScripts(browser, payload.target.detection, payload.target.workflow))
    const detectScriptsFromInventoryTarget = inventory.map((payload) => scriptDetectionService.detectScripts(browser, payload.target.inventory, payload.target.workflow))

    // Run script detection
    const detectionTargetScripts = await Promise.all(detectScriptsFromDetectionTarget)
    const inventoryTargetScripts = await Promise.all(detectScriptsFromInventoryTarget)

    // Prepare to run script comparison with inventory
    const detectionTargetScriptsToCompare = detectedScriptToCompare(inventory, detectionTargetScripts)
    const inventoryTargetScriptsToCompare = detectedScriptToCompare(inventory, inventoryTargetScripts)

    // Run script comparison with inventory
    const detectionTargetScriptComparisonResult = await Promise.all(detectionTargetScriptsToCompare)
    const inventoryTargetScriptComparisonResult = await Promise.all(inventoryTargetScriptsToCompare)

    // TODO: Alert on detection differences
    console.log(`[Alert]: '${detectionTargetScriptComparisonResult.length}' detection targets to alert on.`)

    // Prepare to run inventory sanity check
    const inventoryTargetComparisonResultToDiff = inventoryTargetScriptComparisonResult.map((result) => scriptInventoryService.diff(result, inventory))

    // Run inventory sanity check
    const inventoryTargetDiffResults = await Promise.all(inventoryTargetComparisonResultToDiff)

    // Push new inventory payloads
    await scriptInventoryService.push(inventoryTargetDiffResults)

    await browser.close()
    await delay(2500)
  }
}

const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch(console.error)
