import type { DocumentId } from './document.js'
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
  /**
   * Top-level browser document the script was observed in (see
   * `DocumentLedger`). Undefined when it could not be attributed, which keeps
   * it in payment scope. Part of the dedupe key: the same script observed on
   * an earlier page and again on the payment page must keep both copies, or
   * the payment-page copy would be lost to scoping.
   */
  document?: DocumentId
}

/**
 * A script response the browser received but whose body the monitor could not
 * read, so the script was neither hashed nor compared. Recorded rather than
 * dropped: a script nobody read is an unmonitored script, and a run that
 * silently loses one would look exactly like a clean run.
 *
 * Unredacted here; every surface that displays it redacts it (see
 * `toUnreadScriptRecord`).
 */
export type UnreadScriptResponse = {
  url: string
  /** Puppeteer resource type of the request — `script` for everything recorded today. */
  resourceType: string
  /** HTTP status of the response whose body could not be read. */
  status: number
  /** Why the body could not be read, e.g. the DevTools protocol error. */
  reason: string
  /**
   * Top-level document the response belongs to (see `DocumentLedger`).
   * Undefined when it could not be attributed, which keeps it in payment scope.
   */
  document?: DocumentId
  /** Workflow step running when the response arrived (0 = initial navigation). */
  step: number
}

/**
 * An unread script response as every report and notification shows it: URLs
 * reduced to origin and path, the reason redacted, and the document resolved
 * to the URL it was loaded at.
 */
export type UnreadScriptRecord = {
  url: string
  resourceType: string
  status: number
  step: number
  /** Redacted URL of the top-level document the response belongs to; null when unattributed. */
  documentUrl: string | null
  reason: string
}

export type ScriptDetectionSummary = {
  externalScripts: ScriptInfo[]
  inlineScripts: ScriptInfo[]
  /**
   * Script responses whose body could not be read. Payment scoping splits
   * them like any other observation; in payment scope they fail the run the
   * way a failed target does. Omitted means none were recorded.
   */
  unreadScripts?: UnreadScriptResponse[]
}
