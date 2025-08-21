import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { InMemoryScriptInventoryService } from './services/inventory'
import { ScriptComparisonService } from './services/comparison'

import type { ScriptDetectionSummary } from './types/script'
import type { ScriptComparisonSummary } from './types/comparison'
import type { Inventory } from './types/inventory'

async function main() {
  const scriptInventoryService = new InMemoryScriptInventoryService()
  const scriptDetectionService = new ScriptDetectionService()
  const scriptComparisonService = new ScriptComparisonService()

  const detectedScriptToCompare = (inventory: Inventory[], detectionSummary: ScriptDetectionSummary[]): Promise<ScriptComparisonSummary>[] => {
    return detectionSummary.map((scriptDetectionSummary) => {
      const inventoryPayload = inventory.find((payload) => payload.target.inventory.url === scriptDetectionSummary.target.url)!
      return scriptComparisonService.compare(inventoryPayload, scriptDetectionSummary)
    })
  }

  while (true) {
    const inventory = await scriptInventoryService.pull()
    const browser = await puppeteer.launch()

    const detectScriptsFromDetectionTarget = inventory.map((payload) => scriptDetectionService.detectScripts(browser, payload.target.detection, payload.target.workflow))
    const detectScriptsFromInventoryTarget = inventory.map((payload) => scriptDetectionService.detectScripts(browser, payload.target.inventory, payload.target.workflow))

    const detectionTargetScripts = await Promise.all(detectScriptsFromDetectionTarget)
    const inventoryTargetScripts = await Promise.all(detectScriptsFromInventoryTarget)

    const detectionTargetScriptsToCompare = detectedScriptToCompare(inventory, detectionTargetScripts)
    const inventoryTargetScriptsToCompare = detectedScriptToCompare(inventory, inventoryTargetScripts)

    const detectionTargetScriptComparisonResult = await Promise.all(detectionTargetScriptsToCompare)
    const inventoryTargetScriptComparisonResult = await Promise.all(inventoryTargetScriptsToCompare)

    await Promise.all(inventoryTargetScriptComparisonResult.map((result) => scriptInventoryService.push(result)))
    await Promise.all(detectionTargetScriptComparisonResult.map((result) => scriptInventoryService.push(result)))

    await browser.close()
    await delay(2500)
  }
}

const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch(console.error)
