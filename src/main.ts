import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { InMemoryScriptInventoryService } from './services/inventory'

async function main() {
  const browser = await puppeteer.launch()
  const scriptDetectionService = new ScriptDetectionService({ browser: browser })
  const scriptInventoryService = new InMemoryScriptInventoryService()

  const inventory = await scriptInventoryService.pull()

  const detectScriptsFromDetectionTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.detection, payload.target.workflow))
  const detectScriptsFromInventoryTarget = inventory.map((payload) => scriptDetectionService.detectScripts(payload.target.inventory, payload.target.workflow))

  const detectionTargetScripts = await Promise.all(detectScriptsFromDetectionTarget)
  const inventoryTargetScripts = await Promise.all(detectScriptsFromInventoryTarget)

  await browser.close()

  console.log(JSON.stringify(detectionTargetScripts, null, 2))
  console.log(JSON.stringify(inventoryTargetScripts, null, 2))
}

main().catch(console.error)
