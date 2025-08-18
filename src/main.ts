import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/detection'
import { InMemoryScriptInventoryService } from './services/inventory'

import { uatWorkflow as uatWorkflow10 } from './workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from './workflows/2.0'

async function main() {
  const browser = await puppeteer.launch()

  const scriptDetectionService = new ScriptDetectionService({ browser: browser })
  // @ts-ignore
  const scriptInventoryService = new InMemoryScriptInventoryService()

  const workflows = [uatWorkflow10, uatWorkflow20]
  const tasksToExecute = workflows.map((workflow) => scriptDetectionService.detectScripts(workflow))
  const detectedScripts = await Promise.all(tasksToExecute)

  await browser.close()
  console.log(JSON.stringify(detectedScripts, null, 2))
}

main().catch(console.error)
