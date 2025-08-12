import { Page } from 'puppeteer'
import { ScriptInfo } from 'src/types/scriptInfo'

import { createSha256Hash } from './hash'

export async function getInlineScriptsFromPage(
  page: Page,
): Promise<ScriptInfo[]> {
  const detectedScripts: ScriptInfo[] = []

  const inlineScripts = await page.evaluate(() => {
    const scriptElements = Array.from(
      document.querySelectorAll('script:not([src])'),
    )
    return scriptElements.map((script) => script.innerHTML)
  })

  inlineScripts.forEach((content, index) => {
    // Only process non-empty inline scripts
    if (content) {
      detectedScripts.push({
        type: 'Inline',
        source: `Inline Script #${index + 1}`,
        sha256: createSha256Hash(content),
      })
    }
  })

  return detectedScripts
}
