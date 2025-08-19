import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { InMemoryScriptInventoryService } from './services/inventory'
import { ScriptComparisonService } from './services/comparison'

import type { ScriptDetectionSummary } from './types/script'
import type { ScriptComparisonSummary } from './types/comparison'

async function main() {
  const browser = await puppeteer.launch()

  const scriptDetectionService = new ScriptDetectionService({ browser: browser })
  const scriptInventoryService = new InMemoryScriptInventoryService()
  const scriptComparisonService = new ScriptComparisonService()

  const inventory = await scriptInventoryService.pull()

  const detectScriptsFromDetectionTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.detection, payload.target.workflow))
  const detectScriptsFromInventoryTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.inventory, payload.target.workflow))

  const detectionTargetScripts = await Promise.all(detectScriptsFromDetectionTarget)
  const inventoryTargetScripts = await Promise.all(detectScriptsFromInventoryTarget)

  const detectedScriptToCompare = (detectionSummary: ScriptDetectionSummary[]): Promise<ScriptComparisonSummary>[] => {
    return detectionSummary.map((scriptDetectionSummary) => {
      const inventoryPayload = inventory.find((payload) => payload.target.inventory.url === scriptDetectionSummary.target.url)!
      return scriptComparisonService.compare(inventoryPayload, scriptDetectionSummary)
    })
  }

  const detectionTargetScriptsToCompare = detectedScriptToCompare(detectionTargetScripts)
  const inventoryTargetScriptsToCompare = detectedScriptToCompare(inventoryTargetScripts)

  const detectionTargetScriptComparisonResult = await Promise.all(detectionTargetScriptsToCompare)
  const inventoryTargetScriptComparisonResult = await Promise.all(inventoryTargetScriptsToCompare)

  await Promise.all(inventoryTargetScriptComparisonResult.map((result) => scriptInventoryService.push(result)))
  await Promise.all(detectionTargetScriptComparisonResult.map((result) => scriptInventoryService.push(result)))

  await browser.close()
}

main().catch(console.error)
