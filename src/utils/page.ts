import type { Page } from 'puppeteer'

import type { ScriptMatcher } from '../types/matcher'
import type { PageScriptElement } from '../types/page'
import type { ScriptInfo } from '../types/script'
import { createSha256Hash } from './hash'
import { tryGetIdFromInLineScriptCode } from './script/inline'

export async function getInlineScriptsFromPage(page: Page, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
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
    const idToUse = pageScriptElement.id ? `inline_script/${pageScriptElement.id}` : tryGetIdFromInLineScriptCode(pageScriptElement)
    const maybeContentMatcher = scriptContentMatchers.find((matcher) => matcher.nameMatcher.test(idToUse) && matcher.contentMatcher.test(pageScriptElement.content))
    const scriptHash = maybeContentMatcher ? createSha256Hash(`${maybeContentMatcher.nameMatcher.source}|${maybeContentMatcher.contentMatcher.source}`) : createSha256Hash(pageScriptElement.content)

    if (pageScriptElement.content) {
      detectedScripts.push({
        source: {
          type: 'inline',
          id: idToUse,
          content: pageScriptElement.content,
        },
        hash: scriptHash,
      })
    }
  })

  return detectedScripts
}
