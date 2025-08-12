import puppeteer from 'puppeteer'

import { ScriptDetectionService } from './services/script'

async function main() {
  // Use a command-line argument for the URL, with a default fallback
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  const scriptDetectionService = new ScriptDetectionService({
    browser: browser,
  })

  const detectedScripts = await scriptDetectionService.getPageScripts()
  console.log(detectedScripts)
}

main().catch(console.error)
