import type { Page } from 'puppeteer'

import type { ScriptMatcher } from '../types/matcher.js'
import type { PageScriptElement } from '../types/page.js'
import type { ScriptInfo } from '../types/script.js'
import { createSha256Hash } from './hash.js'
import { tryGetIdFromInLineScriptCode } from './script/inline.js'

export async function getInlineScriptsFromPage(page: Page, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
  const detectedScripts: ScriptInfo[] = []

  const inlineScripts = await page.evaluate(() => {
    const scriptElements = Array.from(document.querySelectorAll('script:not([src])'))
    return scriptElements.map<PageScriptElement>((elem) => {
      // Read the initiator URL tagged by the page-attribution shim. Falls
      // back to the page URL so parser-inserted inline scripts still have a
      // sensible attribution (configured behaviour: parser inserts attribute
      // to the page itself).
      const tagged = (elem as unknown as { __pciInitiatorUrl?: string }).__pciInitiatorUrl
      const initiatorUrl = tagged ?? (typeof location !== 'undefined' ? location.href : undefined)
      return {
        id: elem.id,
        content: elem.innerHTML,
        ...(initiatorUrl !== undefined ? { initiatorUrl } : {}),
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
          ...(pageScriptElement.initiatorUrl !== undefined ? { url: pageScriptElement.initiatorUrl } : {}),
        },
        hash: scriptHash,
      })
    }
  })

  return detectedScripts
}
