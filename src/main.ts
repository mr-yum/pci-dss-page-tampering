import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/script'
import { uatWorkflow as uatWorkflow10 } from './workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from './workflows/2.0'

async function main() {
  // Use a command-line argument for the URL, with a default fallback
  const browser = await puppeteer.launch({
    headless: true,
    // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })

  const scriptDetectionService = new ScriptDetectionService({
    browser: browser,
  })

  const workflows = [uatWorkflow10, uatWorkflow20]
  const tasksToExecute = workflows.map((workflow) => scriptDetectionService.getPageScripts(workflow))
  const detectedScripts = await Promise.all(tasksToExecute)

  await browser.close()
  console.log(JSON.stringify(detectedScripts))
}

main().catch(console.error)
