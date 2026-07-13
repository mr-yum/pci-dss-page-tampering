import type { SHA256Hash } from './hash.js'

export type ExternalScriptSource = {
  type: 'external'
  url: string
  /**
   * The script's response body, captured at detection time. Guaranteed
   * non-empty by `scriptResponseHandler` (empty responses are dropped).
   * This is what `ContentMatcher` and content snippets in alerts operate
   * on — the URL is never used as a stand-in for content.
   */
  content: string
}

export type InlineScriptSource = {
  type: 'inline'
  id: string
  content: string
  /**
   * URL of the script that initiated the inline script's insertion. Captured
   * synchronously at insertion time by the page-attribution shim (see
   * `src/utils/page-attribution.ts`). For inline scripts that were part of the
   * original page HTML (parser-inserted), this is `location.href` of the page
   * the script was detected on. Undefined only when the shim didn't run or
   * the page hadn't navigated yet.
   */
  url?: string
}

export type ScriptSource = ExternalScriptSource | InlineScriptSource

export type ScriptInfo = {
  source: ScriptSource
  hash: SHA256Hash
}

export type ScriptDetectionSummary = {
  externalScripts: ScriptInfo[]
  inlineScripts: ScriptInfo[]
}
