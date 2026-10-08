import type { DocumentId } from './document.js'
import type { SHA256Hash } from './hash.js'
import type { InitiatorHop } from './initiator-chain.js'

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
  /**
   * Raw evidence behind `initiator`, kept so the chain resolver can tell a
   * real inserter URL from a fallback (see `deriveInitiatorEvidence`).
   * Undefined when the CDP initiator could not be read.
   */
  initiatorEvidence?: InitiatorEvidence
  /**
   * URL of the frame that issued the request, read from the browser's frame
   * tree when the response arrived — see `Matchable.frameUrl`. Undefined
   * when the request had no frame, or when copies of this script were
   * captured from frames on different origins (no single frame to bind to).
   */
  frameUrl?: string
}

/**
 * What the CDP request initiator actually said, before `initiator` folded it
 * into one URL.
 *
 * - `stack` — script-issued: `topFrameUrl` is the top call frame's URL, which
 *   is empty for code with no script URL of its own (a dynamically inserted
 *   inline script, `eval`). Inline scripts parsed from the document report the
 *   document URL.
 * - `parser` — the parser requested it (a `<script src>` in markup): the
 *   inserter is the document, `url` names it.
 * - `other` — any other initiator type, or none; `url` is whatever fallback
 *   `initiator` used, never evidence of a script inserter.
 */
export type InitiatorEvidence = { type: 'stack'; topFrameUrl: string } | { type: 'parser'; url: string } | { type: 'other'; url: string | null }

/** Who inserted an inline script element, as the attribution shim recorded it (see `ScriptElementRecord`). */
export type InlineScriptInstance = {
  /** Per-element token from the attribution shim. */
  token: string
  kind: 'script' | 'inline' | 'none' | 'parser'
  /** For `kind: 'inline'`: the token of the inline script that inserted this one. */
  inserterToken: string | null
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
  /**
   * The script elements this observation stands for, as the attribution shim
   * identified them — usually one; more when identical inline scripts in the
   * same document were collapsed into one observation. The first is this
   * script's identity in an initiator chain (`inline_script/<name>#<token>`);
   * any of them may be named as an inserter. Undefined when the shim did not
   * run, which leaves the script without chain evidence.
   */
  instances?: InlineScriptInstance[]
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
  /**
   * Who loaded this script, out to the page — resolved after the run from
   * everything it observed (`resolveInitiatorChains`). Undefined when there
   * was no initiator evidence at all.
   */
  initiatorChain?: InitiatorHop[]
  /** Forked paths above the immediate inserter; see `Matchable.alternateInitiatorChains`. */
  alternateInitiatorChains?: InitiatorHop[][]
}

/**
 * A script response the browser received but whose body the monitor could not
 * read, so the script was neither hashed nor compared. Recorded rather than
 * dropped: a script nobody read is an unmonitored script, and a run that
 * silently loses one would look exactly like a clean run.
 *
 * Unredacted here; every surface that displays it redacts it (see
 * `toUnreadScriptRecords`).
 */
export type UnreadScriptResponse = {
  url: string
  /** Puppeteer resource type of the request — `script` for everything recorded today. */
  resourceType: string
  /** HTTP status of the response whose body could not be read; 0 when the body finished loading but no response was ever surfaced, so no status is known. */
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

/**
 * A script request the page issued that still had no response when the run
 * was accounted for, and no sign its body ever finished loading. Evidence,
 * not a finding: in the observed Chrome behaviour (probe, 2026-10-02)
 * Puppeteer surfaces a script's response only once its body is complete, and
 * a classic script cannot run before its body completes, so such a request
 * never executed on the page. That inference is kept safe by two backstops
 * that turn a request into an unread script instead — Puppeteer's
 * `requestfinished` with no response, and Chrome's own
 * `Network.loadingFinished` (see `PendingScriptReads`). It is recorded because
 * the request itself is worth a human's eye: a URL the page built wrongly, or
 * a host that stopped answering, shows up nowhere else.
 *
 * Unredacted here; every surface that displays it redacts it (see
 * `toUnansweredRequestRecords`).
 */
export type UnansweredScriptRequest = {
  url: string
  /** Puppeteer resource type of the request — `script` for everything recorded today. */
  resourceType: string
  /** Why the request is recorded, e.g. still unanswered at the deadline, or its frame went away. */
  reason: string
  /** Top-level document the request belongs to; undefined when it could not be attributed. */
  document?: DocumentId
  /** Workflow step running when the request was issued (0 = initial navigation). */
  step: number
  /**
   * Workflow step running when the request's frame was detached — removed or
   * navigated away by the page, or closed with the browser context (then the
   * last step). Set only when the frame went away with the request still
   * outstanding and the step was known; absent otherwise. Comparing it with
   * `step` is what tells a vendor frame replacing itself on its own schedule
   * from a detach that coincided with one of the workflow's own actions.
   * A request already listed when the deadline expired carries none, though
   * its frame is later closed with the context too: its reason already says
   * it outlived the workflow, and stamping the last step on it would read as
   * a detach during that step's action — the very confusion this field exists
   * to remove.
   */
  detachedAtStep?: number
  /** URL of the frame that was detached, as it was when it went away; set alongside `detachedAtStep` when the frame had one. */
  detachedFrameUrl?: string
  /** The request's CDP initiator, read when it was issued — the request's first hop. */
  initiatorEvidence?: InitiatorEvidence
  /** Resolved after the run like a script's (see `ScriptInfo.initiatorChain`): who asked for it. */
  initiatorChain?: InitiatorHop[]
}

/** An unanswered script request as every report and notification shows it; see `UnreadScriptRecord`. */
export type UnansweredRequestRecord = Omit<UnreadScriptRecord, 'status'> & {
  /** See `UnansweredScriptRequest.detachedAtStep`. */
  detachedAtStep?: number
  /** Redacted (origin and path) URL of the detached frame; see `UnansweredScriptRequest.detachedFrameUrl`. */
  detachedFrameUrl?: string
  /** Redacted hops of the request's initiator chain; absent when there was no evidence. */
  initiatorChain?: InitiatorHop[]
}

/**
 * When an unanswered request was issued and, if its frame went away first,
 * when and which frame — the phrase every notification names it with:
 * `step 9` alone, or `issued at step 9, frame detached at step 9 (https://challenge.example/widget)`.
 * `formatUrl` lets a surface quote or escape the (already redacted) frame URL.
 */
export function unansweredRequestTiming(request: Pick<UnansweredRequestRecord, 'step' | 'detachedAtStep' | 'detachedFrameUrl'>, formatUrl: (url: string) => string = (url) => url): string {
  if (request.detachedAtStep === undefined) return `step ${request.step}`
  const frame = request.detachedFrameUrl === undefined ? '' : ` (${formatUrl(request.detachedFrameUrl)})`
  return `issued at step ${request.step}, frame detached at step ${request.detachedAtStep}${frame}`
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
  /**
   * Script requests that never got a response. Split by payment scope like
   * every other observation, but never fail the run (see
   * `UnansweredScriptRequest`). Omitted means none were recorded.
   */
  unansweredRequests?: UnansweredScriptRequest[]
}
