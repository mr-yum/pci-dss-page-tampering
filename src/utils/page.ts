import type { Page } from 'puppeteer'
import type { ScriptInfo } from '../types/script'

import { createSha256Hash } from './hash'
import type { PageScriptElement } from '../types/page'

export async function getInlineScriptsFromPage(page: Page): Promise<ScriptInfo[]> {
  const detectedScripts: ScriptInfo[] = []

  const inlineScripts = await page.evaluate(() => {
    const scriptElements = Array.from(document.querySelectorAll('script:not([src])'))
    return scriptElements.map<PageScriptElement>((elem) => {
      return {
        id: elem.id,
        content: elem.innerHTML,
      }
    })
  })

  inlineScripts.forEach((pageScriptElement) => {
    const idToUse = pageScriptElement.id ? `inline_script_id_${pageScriptElement.id}` : 'inline_script_id_not_found'

    if (pageScriptElement.content) {
      detectedScripts.push({
        source: {
          type: 'inline',
          id: idToUse,
          content: pageScriptElement.content,
        },
        hash: createSha256Hash(pageScriptElement.content),
      })
    }
  })

  return detectedScripts
}
