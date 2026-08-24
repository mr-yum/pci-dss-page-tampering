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
  /**
   * URL of whatever caused this script to load, derived from the CDP request
   * initiator (`HTTPRequest.initiator()`): the top call frame's URL for
   * script-issued requests (the same "immediate inserter" semantics as the
   * RUM agent's `document.currentScript` capture), the initiator/document URL
   * for parser-inserted tags, falling back to the requesting frame's URL when
   * the stack is anonymous (eval'd code — mirroring the RUM agent's
   * `location.href` fallback). Undefined when attribution genuinely failed.
   * Consumed by `InitiatorHostMatcher`.
   */
  initiator?: string
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
