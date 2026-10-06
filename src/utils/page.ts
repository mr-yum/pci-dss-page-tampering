import type { Page } from 'puppeteer'

import type { ScriptMatcher } from '../types/matcher.js'
import type { PageScriptElement } from '../types/page.js'
import type { ScriptInfo } from '../types/script.js'
import { createSha256Hash } from './hash.js'
import type { ScriptElementRecord, ScriptInsertionRecord } from './page-attribution.js'
import { tryGetIdFromInLineScriptCode } from './script/inline.js'

/** One scan of the current top-level document. */
export type PageScripts = {
  inlineScripts: ScriptInfo[]
  /** Script elements inserted with a `src`, as the attribution shim logged them (empty when the shim did not run). */
  insertions: ScriptInsertionRecord[]
}

type AttributionApi = { describe(el: Element): ScriptElementRecord | null; insertions(): ScriptInsertionRecord[] }

export async function readPageScripts(page: Page, scriptContentMatchers: ScriptMatcher[]): Promise<PageScripts> {
  const scanned = await page.evaluate(() => {
    const api = (window as unknown as { __pciAttribution?: AttributionApi }).__pciAttribution
    const scriptElements = Array.from(document.querySelectorAll('script:not([src])'))
    const inline = scriptElements.map<PageScriptElement>((elem) => {
      // What the attribution shim recorded. Without it, fall back to the page
      // URL so parser-inserted inline scripts still have a sensible
      // attribution (configured behaviour: parser inserts attribute to the
      // page itself) — and no instance, so no chain evidence.
      let described: ScriptElementRecord | null
      try {
        described = api?.describe(elem) ?? null
      } catch {
        described = null
      }
      const initiatorUrl = described?.initiatorUrl ?? (typeof location !== 'undefined' ? location.href : undefined)
      return {
        id: elem.id,
        content: elem.innerHTML,
        ...(initiatorUrl !== undefined && initiatorUrl !== null ? { initiatorUrl } : {}),
        ...(described !== null ? { instance: { token: described.token, kind: described.kind, inserterToken: described.inserterToken } } : {}),
      }
    })
    let insertions: ScriptInsertionRecord[]
    try {
      insertions = api?.insertions() ?? []
    } catch {
      insertions = []
    }
    return { inline, insertions }
  })

  const inlineScripts: ScriptInfo[] = []
  scanned.inline.forEach((pageScriptElement) => {
    const idToUse = pageScriptElement.id ? `inline_script/${pageScriptElement.id}` : tryGetIdFromInLineScriptCode(pageScriptElement)
    const maybeContentMatcher = scriptContentMatchers.find((matcher) => matcher.nameMatcher.test(idToUse) && matcher.contentMatcher.test(pageScriptElement.content))
    const scriptHash = maybeContentMatcher ? createSha256Hash(`${maybeContentMatcher.nameMatcher.source}|${maybeContentMatcher.contentMatcher.source}`) : createSha256Hash(pageScriptElement.content)

    if (pageScriptElement.content) {
      inlineScripts.push({
        source: {
          type: 'inline',
          id: idToUse,
          content: pageScriptElement.content,
          ...(pageScriptElement.initiatorUrl !== undefined ? { url: pageScriptElement.initiatorUrl } : {}),
          ...(pageScriptElement.instance !== undefined ? { instances: [pageScriptElement.instance] } : {}),
        },
        hash: scriptHash,
      })
    }
  })

  return { inlineScripts, insertions: scanned.insertions }
}

export async function getInlineScriptsFromPage(page: Page, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
  return (await readPageScripts(page, scriptContentMatchers)).inlineScripts
}
