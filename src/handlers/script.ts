import type { Frame, HTTPRequest, HTTPResponse } from 'puppeteer'

import type { DocumentId } from '../types/document.js'
import type { ScriptInfo, UnansweredScriptRequest, UnreadScriptResponse } from '../types/script.js'
import { createSha256Hash } from '../utils/hash.js'
import { redactUrl } from '../utils/url.js'

/**
 * Derive the initiator URL for a script request from the CDP initiator info,
 * mirroring the RUM agent's attribution semantics so `initiatorHostMatcher`
 * entries behave identically across the synthetic and RUM passes:
 * - script-issued requests: the top call frame is the script that caused the
 *   load (the RUM insertion patch's `document.currentScript` equivalent);
 * - parser-inserted tags: the initiator/document URL (the RUM agent's
 *   `location.href` fallback for parser-inserted scripts);
 * - anonymous stacks (eval'd code): the requesting frame's document URL, the
 *   same honest fallback the agent uses when `currentScript` is null.
 * Returns undefined only when attribution genuinely failed — matchers then
 * fail secure on the missing evidence.
 */
function deriveInitiatorUrl(request: HTTPRequest): string | undefined {
  try {
    const initiator = request.initiator?.()
    const frameUrl = initiator?.stack?.callFrames?.[0]?.url
    if (frameUrl) return frameUrl
    if (initiator?.url) return initiator.url
    const documentUrl = request.frame()?.url()
    return documentUrl && documentUrl !== '' ? documentUrl : undefined
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
 * that is one unmonitored script, not two. (A request still unanswered at the
 * deadline is not an unread script at all; see `PendingScriptReads`.)
 */
export function recordUnreadScript(unread: UnreadScriptResponse[], record: UnreadScriptResponse): void {
  if (unread.some((existing) => existing.url === record.url && existing.document === record.document && existing.status === record.status)) return
  unread.push(record)
}

/**
 * @param document Top-level document the response belongs to (see `DocumentLedger`),
 *   or undefined when it could not be attributed — which keeps the script in payment scope.
 * @param accounting Where a response whose body cannot be read is recorded.
 *   Never silently dropped: an unread script is an unmonitored one, and the run
 *   has to say so (see `UnreadScriptResponse`).
 */
export async function scriptResponseHandler(response: HTTPResponse, detectedScripts: ScriptInfo[], document?: DocumentId, accounting?: UnreadScriptAccounting): Promise<void> {
  if (!isMonitoredScriptResponse(response)) return

  // Read the step now, before the await: the record names the step the
  // response arrived in, which is the step that caused it.
  const step = accounting?.step ?? 0
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
  const initiator = deriveInitiatorUrl(response.request())

  // Reload recovery can observe more than one body at the same URL. Keep
  // every distinct version so a failed first render cannot mask changed
  // bytes served by the successful attempt. The document is part of the
  // key too: the same SDK loaded on an earlier page and again on the
  // payment page must keep the payment page's copy, or scoping would drop
  // it along with the earlier page. Payment scoping collapses the copies
  // again within each scope.
  if (!detectedScripts.some((scriptInfo) => scriptInfo.source.type === 'external' && scriptInfo.source.url === scriptUrl && scriptInfo.hash.value === scriptHash.value && scriptInfo.document === document) && scriptContent) {
    detectedScripts.push({
      source: {
        type: 'external',
        url: scriptUrl,
        content: scriptContent,
        ...(initiator !== undefined ? { initiator } : {}),
      },
      hash: scriptHash,
      ...(document !== undefined ? { document } : {}),
    })
  }
}

/** A script body still being read when the workflow finished: recorded as unread, since the script may have run. */
export type UnfinishedRead = Omit<UnreadScriptResponse, 'reason'>

/** Reason recorded for a request whose frame was detached before any response arrived. */
export const SCRIPT_REQUEST_FRAME_DETACHED_REASON = 'its frame was detached before a response arrived'

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
 * The two end differently. A read still pending at the deadline is a script
 * that arrived and went unexamined, so the caller records it as unread. A
 * request still unanswered is evidence only (see `UnansweredScriptRequest`):
 * Puppeteer surfaces a script's response once its body is complete, and the
 * script cannot have run before then. It stays on the unanswered list only
 * while it stays unanswered — a response that lands after all, even after the
 * run is sealed, takes it off, and the sealed response handler records that
 * response as unread instead.
 */
export class PendingScriptReads {
  private readonly pending = new Map<Promise<void>, UnfinishedRead>()
  private readonly inFlight = new Map<HTTPRequest, InFlightRequest>()
  /** Requests whose frame went away before they were answered: not waited for, but still unanswered. */
  private readonly detached = new Map<HTTPRequest, InFlightRequest>()
  /** Requests reported unanswered by a `settle`, until a response says otherwise. */
  private readonly unanswered = new Map<HTTPRequest, UnansweredScriptRequest>()
  private wake: (() => void) | undefined

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
   * The request finished or failed: it is no longer awaited. One already
   * reported unanswered stays on that list — failing after the deadline (as
   * the context closes, say) does not make it answered; only a response does
   * (see `track`).
   */
  requestSettled(request: HTTPRequest): void {
    this.detached.delete(request)
    if (this.inFlight.delete(request)) this.wake?.()
  }

  /**
   * A frame went away: stop spending the deadline on its unanswered requests.
   * Puppeteer does not always report `requestfailed` or `requestfinished` for
   * a request whose frame has been torn down, so such a request may never
   * settle and would otherwise hold the run for the full deadline. It is not
   * forgotten: it is still listed as unanswered, and if its response does
   * arrive after all it is read like any other — or, once the run is sealed,
   * recorded as unread by the response handler.
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
    // Any response, read or not, answers its request — even one reported
    // unanswered at the deadline; the sealed handler records it as unread.
    this.requestSettled(response.request())
    this.unanswered.delete(response.request())
    if (!isMonitoredScriptResponse(response)) return
    this.pending.set(read, describeScriptResponse(response, document, step))
    // Registered on the read itself, before `settle` can register anything on
    // it, so a settled read is always gone from `pending` by the time `settle`
    // resumes. The rejection handler also keeps a defect in the handler from
    // surfacing as an unhandled rejection; the handler itself never rejects.
    const forget = (): void => {
      this.pending.delete(read)
      this.wake?.()
    }
    read.then(forget, forget)
  }

  /**
   * Wait up to `timeoutMs` for every tracked request and read to settle.
   * Returns the reads still pending at the deadline, for the caller to record
   * as unread; requests still unanswered move to `unansweredRequests()` with
   * `unansweredReason` (or the detached-frame reason). Loops rather than
   * waiting once: a response can arrive — and start a read — while earlier
   * reads are being awaited, and that read gets the same chance to finish
   * rather than being reported as stuck.
   */
  async settle(timeoutMs: number, unansweredReason: string): Promise<UnfinishedRead[]> {
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
    for (const [entries, reason] of [
      [this.inFlight, unansweredReason],
      [this.detached, SCRIPT_REQUEST_FRAME_DETACHED_REASON],
    ] as const) {
      for (const [request, { step, documentOf }] of entries) {
        const document = documentOf(request)
        this.unanswered.set(request, { url: request.url(), resourceType: request.resourceType(), reason, step, ...(document !== undefined ? { document } : {}) })
      }
      entries.clear()
    }
    return [...this.pending.values()]
  }

  /** Script requests a `settle` reported unanswered that no response has answered since. */
  unansweredRequests(): UnansweredScriptRequest[] {
    return [...this.unanswered.values()]
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
