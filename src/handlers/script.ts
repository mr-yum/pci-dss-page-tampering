import type { Frame, HTTPRequest, HTTPResponse } from 'puppeteer'

import { requestIdOf } from '../services/document-ledger.js'
import type { DocumentId } from '../types/document.js'
import { agreedFrameUrl } from '../types/initiator-chain.js'
import type { InitiatorEvidence, ScriptInfo, UnansweredScriptRequest, UnreadScriptResponse } from '../types/script.js'
import { createSha256Hash } from '../utils/hash.js'
import { redactUrl } from '../utils/url.js'

/**
 * The top call frame of a script-issued request, with the monitor's own
 * attribution shim taken off the top.
 *
 * The shim (`src/utils/page-attribution.ts`) wraps `appendChild` and the other
 * insertion methods, so for every script the page inserts through the DOM
 * the top frame Chrome reports is the shim's wrapper — not the script that
 * called it. Until this was seen in a real-Chrome test (2026-10-06) that made
 * `deriveInitiatorUrl` fall through to the document URL for nearly every
 * dynamically inserted script, so a synthetic `initiatorHostMatcher` was
 * matching the page's host rather than the loader's.
 *
 * The shim is given a per-run random `sourceURL` (`shimSourceUrl`) so its
 * frame can be recognised. Exactly one leading shim frame is removed: the
 * wrapper adds one frame per call. A second frame claiming the same URL is
 * not trusted as the caller — a page that learnt the name and reused it for
 * its own code would otherwise hide its own frame — and reads as anonymous.
 * Undefined `shimSourceUrl` (tests, or callers without a shim) leaves the
 * stack as Chrome reported it.
 */
function topCallFrameUrl(request: HTTPRequest, shimSourceUrl: string | undefined): string | undefined {
  const frames = request.initiator?.()?.stack?.callFrames
  if (frames === undefined || frames.length === 0) return undefined
  const [first, second] = frames
  if (shimSourceUrl === undefined || first?.url !== shimSourceUrl) return first?.url ?? ''
  // The shim's own frame, with nothing under it: the shim was called by code
  // with no stack of its own to report.
  if (second === undefined) return ''
  return second.url === shimSourceUrl ? '' : (second.url ?? '')
}

/**
 * Derive the initiator URL for a script request from the CDP initiator info,
 * mirroring the RUM agent's attribution semantics so `initiatorHostMatcher`
 * entries behave identically across the synthetic and RUM passes:
 * - script-issued requests: the top call frame (below the attribution shim's
 *   own wrapper, see `topCallFrameUrl`) is the script that caused the load —
 *   the RUM insertion patch's `document.currentScript` equivalent;
 * - parser-inserted tags: the initiator/document URL (the RUM agent's
 *   `location.href` fallback for parser-inserted scripts);
 * - anonymous stacks (eval'd code, dynamically inserted inline scripts): the
 *   requesting frame's document URL, the same honest fallback the agent uses
 *   when `currentScript` is null.
 * Returns undefined only when attribution genuinely failed — matchers then
 * fail secure on the missing evidence.
 */
export function deriveInitiatorUrl(request: HTTPRequest, shimSourceUrl?: string): string | undefined {
  try {
    const initiator = request.initiator?.()
    const frameUrl = topCallFrameUrl(request, shimSourceUrl)
    if (frameUrl) return frameUrl
    if (initiator?.url) return initiator.url
    const documentUrl = request.frame()?.url()
    return documentUrl && documentUrl !== '' ? documentUrl : undefined
  } catch {
    return undefined
  }
}

/**
 * The CDP initiator as it was, before `deriveInitiatorUrl` folded it into one
 * URL — which the chain resolver needs, because the folded URL cannot say
 * whether it named the inserting script or was a fallback. An anonymous top
 * frame (empty URL) is the tell for code with no script URL of its own: a
 * dynamically inserted inline script, or `eval`. Undefined when the
 * initiator cannot be read.
 */
export function deriveInitiatorEvidence(request: HTTPRequest, shimSourceUrl?: string): InitiatorEvidence | undefined {
  try {
    const initiator = request.initiator?.()
    if (initiator === undefined) return undefined
    const topFrameUrl = topCallFrameUrl(request, shimSourceUrl)
    if (topFrameUrl !== undefined) return { type: 'stack', topFrameUrl }
    if (initiator.type === 'parser' && initiator.url) return { type: 'parser', url: initiator.url }
    return { type: 'other', url: deriveInitiatorUrl(request, shimSourceUrl) ?? null }
  } catch {
    return undefined
  }
}

/** Where unreadable script responses are recorded, and which workflow step is running. */
export type UnreadScriptAccounting = {
  unread: UnreadScriptResponse[]
  /** Workflow step running when the response arrived (0 = initial navigation). */
  step: number
  /**
   * Whether the run has finished waiting for its reads and is being accounted
   * for (see `PendingScriptReads.settle`). From then on a read that completes
   * is recorded as unread rather than compared: the summary is built from
   * these arrays, and a body that lands now was not read in time to be in it.
   */
  sealed?: () => boolean
}

/** Reason recorded for a body that was read only after the run had been accounted for. */
export const SCRIPT_READ_LATE_REASON = 'the response body finished reading only after the workflow had been accounted for'

/** Whether a response is one the handler reads and compares: an OK script. */
export function isMonitoredScriptResponse(response: HTTPResponse): boolean {
  return response.request().resourceType() === 'script' && response.ok()
}

/** The unread-script record for a response, without the reason. */
export function describeScriptResponse(response: HTTPResponse, document: DocumentId | undefined, step: number): Omit<UnreadScriptResponse, 'reason'> {
  return { url: response.url(), resourceType: response.request().resourceType(), status: response.status(), step, ...(document !== undefined ? { document } : {}) }
}

/**
 * Record an unread response once per script, document and status. The same
 * gap can be seen twice with different reasons — still being read at the
 * deadline, then failing with "Session closed" as the context closes — and
 * that is one unmonitored script, not two. A record with status 0 — a body
 * that finished loading with no response surfaced, so no status known —
 * matches whatever status the response carries if it surfaces later. (A
 * request still unanswered at the deadline is not an unread script at all;
 * see `PendingScriptReads`.)
 */
export function recordUnreadScript(unread: UnreadScriptResponse[], record: UnreadScriptResponse): void {
  const sameStatus = (existing: UnreadScriptResponse): boolean => existing.status === record.status || existing.status === 0 || record.status === 0
  if (unread.some((existing) => existing.url === record.url && existing.document === record.document && sameStatus(existing))) return
  unread.push(record)
}

/**
 * @param document Top-level document the response belongs to (see `DocumentLedger`),
 *   or undefined when it could not be attributed — which keeps the script in payment scope.
 * @param accounting Where a response whose body cannot be read is recorded.
 *   Never silently dropped: an unread script is an unmonitored one, and the run
 *   has to say so (see `UnreadScriptResponse`).
 */
export async function scriptResponseHandler(
  response: HTTPResponse,
  detectedScripts: ScriptInfo[],
  document?: DocumentId,
  accounting?: UnreadScriptAccounting,
  shimSourceUrl?: string,
  issuedFrameUrlOf?: (request: HTTPRequest) => string | undefined,
): Promise<void> {
  if (!isMonitoredScriptResponse(response)) return

  // Read the step now, before the await: the record names the step the
  // response arrived in, which is the step that caused it.
  const step = accounting?.step ?? 0
  // And the frame that issued the request, from the browser's frame tree,
  // before the frame can navigate on: see `Matchable.frameUrl`. When the
  // caller recorded the frame's URL as the request was sent, the two readings
  // must agree on its origin: a frame that navigated (or was navigated by
  // its parent) between request and response has no single frame to bind
  // to. Chrome was observed to abort such a request anyway (2026-10-06);
  // this keeps the binding from depending on that.
  const frameUrl = issuedFrameUrlOf === undefined ? frameUrlOf(response) : agreedFrameUrl(issuedFrameUrlOf(response.request()), frameUrlOf(response))
  let scriptContent: string
  try {
    scriptContent = await response.text()
  } catch (error) {
    const record: UnreadScriptResponse = { ...describeScriptResponse(response, document, step), reason: error instanceof Error ? error.message : String(error) }
    // Origin and path only, like every other URL this tool logs: a script URL
    // can carry a signed token in its query string.
    console.error(`Could not read the body of script ${redactUrl(record.url)} (HTTP ${record.status}, step ${step}, document ${document ?? 'unattributed'}); it was not compared and is recorded as unread: ${record.reason}`)
    if (accounting !== undefined) recordUnreadScript(accounting.unread, record)
    return
  }

  if (accounting?.sealed?.() === true) {
    // Too late to be compared: the run is being summarised from these arrays.
    // Fail secure and say so rather than let the script vanish or land in a
    // summary that has already been read.
    const record: UnreadScriptResponse = { ...describeScriptResponse(response, document, step), reason: SCRIPT_READ_LATE_REASON }
    console.error(`Script ${redactUrl(record.url)} (HTTP ${record.status}, step ${step}, document ${document ?? 'unattributed'}) finished reading after the workflow was accounted for; it was not compared and is recorded as unread.`)
    recordUnreadScript(accounting.unread, record)
    return
  }

  const scriptUrl = response.url()
  const scriptHash = createSha256Hash(scriptContent)
  const initiator = deriveInitiatorUrl(response.request(), shimSourceUrl)
  const initiatorEvidence = deriveInitiatorEvidence(response.request(), shimSourceUrl)

  // Reload recovery can observe more than one body at the same URL. Keep
  // every distinct version so a failed first render cannot mask changed
  // bytes served by the successful attempt. The document is part of the
  // key too: the same SDK loaded on an earlier page and again on the
  // payment page must keep the payment page's copy, or scoping would drop
  // it along with the earlier page. Payment scoping collapses the copies
  // again within each scope.
  const kept = detectedScripts.find((scriptInfo) => scriptInfo.source.type === 'external' && scriptInfo.source.url === scriptUrl && scriptInfo.hash.value === scriptHash.value && scriptInfo.document === document)
  if (kept !== undefined && kept.source.type === 'external' && kept.source.frameUrl !== undefined) {
    // A second copy from a frame on another origin: the kept copy no longer
    // has a single frame to bind a document hop to.
    const agreed = agreedFrameUrl(kept.source.frameUrl, frameUrl)
    if (agreed === undefined) delete kept.source.frameUrl
  }
  if (kept === undefined && scriptContent) {
    detectedScripts.push({
      source: {
        type: 'external',
        url: scriptUrl,
        content: scriptContent,
        ...(initiator !== undefined ? { initiator } : {}),
        ...(initiatorEvidence !== undefined ? { initiatorEvidence } : {}),
        ...(frameUrl !== undefined ? { frameUrl } : {}),
      },
      hash: scriptHash,
      ...(document !== undefined ? { document } : {}),
    })
  }
}

/** The URL of the frame that issued a response's request, as it reads now; undefined without a frame (a worker) or a URL. */
function frameUrlOf(response: HTTPResponse): string | undefined {
  return requestFrameUrl(response.request())
}

/** The current URL of the frame a request belongs to; undefined without a frame (a worker) or a URL. Read it when the request is sent to pass as `issuedFrameUrlOf`. */
export function requestFrameUrl(request: HTTPRequest): string | undefined {
  try {
    const url = request.frame()?.url()
    return url === undefined || url === '' ? undefined : url
  } catch {
    return undefined
  }
}

/** A script body still being read when the workflow finished: recorded as unread, since the script may have run. */
export type UnfinishedRead = Omit<UnreadScriptResponse, 'reason'>

/**
 * Reason recorded for a request whose frame was detached — navigated away,
 * removed by the page, or closed with the browser context — before any
 * response arrived and without Puppeteer reporting it finished or failed.
 */
export const SCRIPT_REQUEST_FRAME_DETACHED_REASON = 'its frame was detached (navigated away, removed, or closed with the browser context) before a response arrived'

/**
 * Reason recorded for a script whose body finished loading although no
 * response was ever surfaced for it, so it was never read. The script may
 * have run: this is unread, never unanswered.
 */
export const SCRIPT_BODY_WITHOUT_RESPONSE_REASON = 'the body finished loading but no response was surfaced for it, so it was never read'

/** What `settle` calls the reads and requests still outstanding at its deadline. */
export type SettleReasons = { reading: string; unanswered: string }

type InFlightRequest = { request: HTTPRequest; step: number; documentOf: (request: HTTPRequest) => DocumentId | undefined }

/**
 * The script requests and body reads still in flight, so a run can wait for
 * them before it closes the browser context and account for any that never
 * finish.
 *
 * Puppeteer does not await event listeners, so the response handler runs
 * detached from the workflow. Without this, the workflow could finish — and
 * close the context, ending the DevTools session the read depends on — while
 * a body was still being read, and that script would vanish from the run.
 * Requests are tracked as well as reads: a script whose response has not yet
 * arrived when the last step finishes has no read to wait for, and its
 * response would otherwise land while the context was closing, after the
 * run had been summarised.
 *
 * Everything tracked ends in exactly one place:
 * - **unread** (returned by `settle` / `requestFinished` for the caller to
 *   record; fails the run) — a read still pending at a deadline, or a script
 *   whose body is known to have finished loading although no response was
 *   surfaced (Puppeteer's `requestfinished` with no response, or Chrome's own
 *   `Network.loadingFinished` seen on the monitor's sessions, `bodyFinished`).
 *   Either way the script may have run and was never compared;
 * - **unanswered** (`unansweredRequests`; evidence only) — a request with no
 *   response and no sign its body ever finished. In the observed Chrome
 *   behaviour (probe, 2026-10-02) Puppeteer surfaces a script's response only
 *   once its body is complete, and a classic script cannot run before its
 *   body is complete, so such a script never ran. The body-finished backstops
 *   above are what keep that inference safe if the observation ever stops
 *   holding. A request stays listed until a read of its response has actually
 *   settled — the sealed response handler then records it as unread — or its
 *   body is found to have finished; a late non-script answer (a 404, say)
 *   keeps it listed, with that answer added to the reason;
 * - **neither**, only when the request was answered and read in time (and
 *   compared), or failed before any deadline (nothing was delivered to run).
 */
export class PendingScriptReads {
  private readonly pending = new Map<Promise<void>, { record: UnfinishedRead; request: HTTPRequest }>()
  private readonly inFlight = new Map<HTTPRequest, InFlightRequest>()
  /** Requests whose frame went away with no answer, finish or failure: not waited for, but still unanswered. */
  private readonly detached = new Map<HTTPRequest, InFlightRequest>()
  /** Requests reported unanswered by a `settle`, until a read of their response settles or their body is found to have finished. */
  private readonly unanswered = new Map<HTTPRequest, UnansweredScriptRequest>()
  /** DevTools request ids whose body Chrome reported finished on one of the monitor's own sessions. */
  private readonly finishedBodies = new Set<string>()
  /**
   * Unanswered requests that a non-script response (a 404, a 502) answered
   * after the deadline, with its status. A response *was* surfaced for them,
   * so a finished body under their request id is that error page's, not a
   * script that may have run: they stay unanswered.
   */
  private readonly answeredLate = new Map<HTTPRequest, number>()
  private wake: (() => void) | undefined

  /** @param options.shimSourceUrl The attribution shim's `sourceURL`, so its frame is not read as a request's initiator (see `topCallFrameUrl`). */
  constructor(private readonly options: { shimSourceUrl?: string } = {}) {}

  /**
   * Note a script request the page has issued, so `settle` waits for its
   * response too. `documentOf` is consulted only if the request is still
   * unanswered at the deadline, when the document ledger has had every chance
   * to attribute it.
   */
  trackRequest(request: HTTPRequest, step: number, documentOf: (request: HTTPRequest) => DocumentId | undefined): void {
    if (request.resourceType() !== 'script') return
    this.inFlight.set(request, { request, step, documentOf })
  }

  /**
   * The request failed: nothing was delivered to run, so it is no longer
   * awaited. One already reported unanswered stays on that list — failing
   * after the deadline (Chrome aborting it as the context closes, say) does
   * not make it answered.
   */
  requestSettled(request: HTTPRequest): void {
    this.detached.delete(request)
    if (this.inFlight.delete(request)) this.wake?.()
  }

  /**
   * Puppeteer reported the request finished. Normally its response surfaced
   * first and `track` took over; but Puppeteer emits `requestfinished` even
   * when Chrome never delivered a response event (crbug.com/883475), and then
   * the body was delivered — the script may have run — while nothing read it.
   * Returns that script for the caller to record as unread, before or after
   * any deadline, and takes it off the unanswered list.
   */
  requestFinished(request: HTTPRequest, fallbackStep: number, fallbackDocumentOf: (request: HTTPRequest) => DocumentId | undefined): UnreadScriptResponse | undefined {
    const awaited = this.inFlight.get(request) ?? this.detached.get(request)
    this.requestSettled(request)
    if (request.resourceType() !== 'script' || responseOf(request) !== null) return undefined
    const listed = this.unanswered.get(request)
    this.unanswered.delete(request)
    const step = awaited?.step ?? listed?.step ?? fallbackStep
    const document = awaited !== undefined ? awaited.documentOf(request) : listed !== undefined ? listed.document : fallbackDocumentOf(request)
    return { url: request.url(), resourceType: request.resourceType(), status: 0, reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step, ...(document !== undefined ? { document } : {}) }
  }

  /**
   * Chrome reported a body finished loading (`Network.loadingFinished`, seen
   * on one of the monitor's own DevTools sessions, independent of how
   * Puppeteer queues its events). A request whose response never surfaces is
   * then classified at the next `settle` as unread, never unanswered.
   */
  bodyFinished(requestId: string): void {
    this.finishedBodies.add(requestId)
  }

  /**
   * A frame went away: stop spending the deadline on its outstanding
   * requests. When Chrome aborts them and Puppeteer reports `requestfailed`,
   * `requestSettled` has already taken them off the wait (and they are not
   * listed: nothing was delivered). But for a torn-down frame Puppeteer does
   * not always report anything at all — for an out-of-process frame the page
   * removed, a probe saw only `framedetached` — and such a request would hold
   * the run for the full deadline. Those — the ones with neither a finish nor
   * a failure — are listed as unanswered with the detached-frame reason; if
   * their response arrives after all it is read like any other, or recorded
   * as unread once the run is sealed.
   */
  frameDetached(frame: Frame): void {
    let moved = false
    for (const [request, entry] of this.inFlight) {
      if (frameOf(request) !== frame) continue
      this.inFlight.delete(request)
      this.detached.set(request, entry)
      moved = true
    }
    if (moved) this.wake?.()
  }

  track(read: Promise<void>, response: HTTPResponse, document: DocumentId | undefined, step: number): void {
    const request = response.request()
    this.requestSettled(request)
    if (!isMonitoredScriptResponse(response)) {
      const listed = this.unanswered.get(request)
      if (listed === undefined) return
      const status = response.status()
      // A redirect hop is answered by the redirect: the request it redirects
      // to is a request of its own, tracked and judged on its own. It shares
      // this hop's DevTools request id, so keeping the hop listed would let
      // the target's finished body turn the hop into a second, misdescribed
      // record of the same gap.
      if (status >= 300 && status < 400) {
        this.unanswered.delete(request)
        return
      }
      // Not a script that runs (a 404, a 502): nothing to read, and nothing
      // ran. It stays listed — it was never answered with a script — with the
      // late answer noted, and is never turned into an unread script.
      this.answeredLate.set(request, status)
      this.unanswered.set(request, { ...listed, reason: `${listed.reason}; answered only afterwards, with HTTP ${status}` })
      return
    }
    this.pending.set(read, { record: describeScriptResponse(response, document, step), request })
    // Registered on the read itself, before `settle` can register anything on
    // it, so a settled read is always gone from `pending` by the time `settle`
    // resumes. Only now does an unanswered request leave that list: until the
    // read settles — and the response handler has compared it or recorded it
    // as unread — it is accounted for as a pending read, which `settle`
    // returns as unread. The rejection handler also keeps a defect in the
    // handler from surfacing as an unhandled rejection; the handler itself
    // never rejects.
    const forget = (): void => {
      this.pending.delete(read)
      this.unanswered.delete(request)
      this.wake?.()
    }
    read.then(forget, forget)
  }

  /**
   * Wait up to `timeoutMs` for every tracked request and read to settle, then
   * return what must be recorded as unread: every read still pending
   * (`reasons.reading`) and every outstanding request whose body is known to
   * have finished. Requests still outstanding without that sign move to
   * `unansweredRequests()` with `reasons.unanswered` (or the detached-frame
   * reason). Loops rather than waiting once: a response can arrive — and
   * start a read — while earlier reads are being awaited, and that read gets
   * the same chance to finish rather than being reported as stuck.
   */
  async settle(timeoutMs: number, reasons: SettleReasons): Promise<UnreadScriptResponse[]> {
    let timer: NodeJS.Timeout | undefined
    let expired = false
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        expired = true
        resolve()
      }, timeoutMs)
    })
    while ((this.pending.size > 0 || this.inFlight.size > 0) && !expired) {
      const woken = new Promise<void>((resolve) => {
        this.wake = resolve
      })
      await Promise.race([woken, deadline])
    }
    this.wake = undefined
    clearTimeout(timer)

    const unread: UnreadScriptResponse[] = [...this.pending.values()].map(({ record }) => ({ ...record, reason: reasons.reading }))
    const bodyFinished = (request: HTTPRequest): boolean => {
      const id = requestIdOf(request)
      return id !== undefined && this.finishedBodies.has(id)
    }
    const withoutResponse = (request: HTTPRequest, step: number, document: DocumentId | undefined): UnreadScriptResponse => ({
      url: request.url(),
      resourceType: request.resourceType(),
      status: 0,
      reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON,
      step,
      ...(document !== undefined ? { document } : {}),
    })
    for (const [request, listed] of this.unanswered) {
      if (!bodyFinished(request) || this.hasPendingRead(request) || this.answeredLate.has(request)) continue
      this.unanswered.delete(request)
      unread.push(withoutResponse(request, listed.step, listed.document))
    }
    for (const [entries, reason] of [
      [this.inFlight, reasons.unanswered],
      [this.detached, SCRIPT_REQUEST_FRAME_DETACHED_REASON],
    ] as const) {
      for (const [request, { step, documentOf }] of entries) {
        const document = documentOf(request)
        if (bodyFinished(request)) unread.push(withoutResponse(request, step, document))
        else {
          // The request's initiator is known from the moment it was issued:
          // recorded so the evidence names who asked for a script that never came.
          const initiatorEvidence = deriveInitiatorEvidence(request, this.options.shimSourceUrl)
          this.unanswered.set(request, { url: request.url(), resourceType: request.resourceType(), reason, step, ...(document !== undefined ? { document } : {}), ...(initiatorEvidence !== undefined ? { initiatorEvidence } : {}) })
        }
      }
      entries.clear()
    }
    return unread
  }

  /**
   * Script requests a `settle` reported unanswered that are still unanswered:
   * no read of a response has settled for them, and none is pending (a
   * pending one is accounted for as unread by `settle`).
   */
  unansweredRequests(): UnansweredScriptRequest[] {
    return [...this.unanswered].filter(([request]) => !this.hasPendingRead(request)).map(([, listed]) => listed)
  }

  private hasPendingRead(request: HTTPRequest): boolean {
    for (const { request: reading } of this.pending.values()) if (reading === request) return true
    return false
  }
}

/** The frame that issued a request, or undefined when Puppeteer cannot say. */
function frameOf(request: HTTPRequest): Frame | undefined {
  try {
    return request.frame() ?? undefined
  } catch {
    return undefined
  }
}

/** The response Puppeteer surfaced for a request, or null when it surfaced none. */
function responseOf(request: HTTPRequest): HTTPResponse | null {
  try {
    return request.response()
  } catch {
    return null
  }
}
