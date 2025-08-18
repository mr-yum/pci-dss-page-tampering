import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { InMemoryScriptInventoryService } from './services/inventory'
import { ScriptComparisonService } from './services/comparison'

async function main() {
  const browser = await puppeteer.launch()

  const scriptDetectionService = new ScriptDetectionService({ browser: browser })
  const scriptInventoryService = new InMemoryScriptInventoryService()
  const scriptComparisonService = new ScriptComparisonService()

  const inventory = await scriptInventoryService.pull()

  const detectScriptsFromDetectionTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.detection, payload.target.workflow))
  const detectScriptsFromInventoryTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.inventory, payload.target.workflow))

  // @ts-ignore
  const detectionTargetScripts = await Promise.all(detectScriptsFromDetectionTarget)
  const inventoryTargetScripts = await Promise.all(detectScriptsFromInventoryTarget)

  const inventoryTargetScriptsToCompare = inventoryTargetScripts.map((scriptDetectionSummary) => {
    const inventoryPayload = inventory.find((payload) => payload.target.inventory.url === scriptDetectionSummary.target.url)!
    return scriptComparisonService.compare(inventoryPayload, scriptDetectionSummary)
  })

  // @ts-ignore
  const comparisonResults = await Promise.all(inventoryTargetScriptsToCompare)
  await browser.close()
}

main().catch(console.error)
