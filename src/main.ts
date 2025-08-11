import puppeteer from 'puppeteer'
import { ScriptDetectionService } from './services/ScriptDetectionService'

async function main() {
  // Use a command-line argument for the URL, with a default fallback
  const targetUrl = process.argv[2] || 'https://www.google.com'
  const browser = await puppeteer.launch()
  const scriptDetectionService = new ScriptDetectionService({
    browser: browser,
  })
  const detectedScripts = await scriptDetectionService.getPageScripts(targetUrl)

  console.log(detectedScripts)
}

main().catch(console.error)
