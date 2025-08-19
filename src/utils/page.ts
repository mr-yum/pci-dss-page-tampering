import type { Page } from 'puppeteer'
import type { ScriptInfo } from '../types/script'

import { createSha256Hash } from './hash'

export async function getInlineScriptsFromPage(page: Page): Promise<ScriptInfo[]> {
  const detectedScripts: ScriptInfo[] = []

  const inlineScripts = await page.evaluate(() => {
    const scriptElements = Array.from(document.querySelectorAll('script:not([src])'))
    return scriptElements.map((script) => script.innerHTML)
  })

  inlineScripts.forEach((content) => {
    // Only process non-empty inline scripts
    if (content) {
      detectedScripts.push({
        source: {
          type: 'inline',
          content: content,
        },
        hash: createSha256Hash(content),
      })
    }
  })

  return detectedScripts
}
