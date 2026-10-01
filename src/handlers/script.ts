import type { HTTPRequest, HTTPResponse } from 'puppeteer'

import type { DocumentId } from '../types/document.js'
import type { ScriptInfo, UnreadScriptResponse } from '../types/script.js'
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
}

/** Whether a response is one the handler reads and compares: an OK script. */
export function isMonitoredScriptResponse(response: HTTPResponse): boolean {
  return response.request().resourceType() === 'script' && response.ok()
}

/** The unread-script record for a response, without the reason. */
export function describeScriptResponse(response: HTTPResponse, document: DocumentId | undefined, step: number): Omit<UnreadScriptResponse, 'reason'> {
  return { url: response.url(), resourceType: response.request().resourceType(), status: response.status(), step, ...(document !== undefined ? { document } : {}) }
}

/** Record an unread response once: the same failure seen twice is one gap, not two. */
export function recordUnreadScript(unread: UnreadScriptResponse[], record: UnreadScriptResponse): void {
  if (unread.some((existing) => existing.url === record.url && existing.document === record.document && existing.status === record.status && existing.reason === record.reason)) return
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

/**
 * The script-body reads still in flight, so a run can wait for them before it
 * closes the browser context and account for any that never finish.
 *
 * Puppeteer does not await event listeners, so the response handler runs
 * detached from the workflow. Without this, the workflow could finish — and
 * close the context, ending the DevTools session the read depends on — while
 * a body was still being read, and that script would vanish from the run.
 */
export class PendingScriptReads {
  private readonly pending = new Map<Promise<void>, Omit<UnreadScriptResponse, 'reason'>>()

  track(read: Promise<void>, response: HTTPResponse, document: DocumentId | undefined, step: number): void {
    if (!isMonitoredScriptResponse(response)) return
    this.pending.set(read, describeScriptResponse(response, document, step))
    // Registered on the read itself, before `settle` can register anything on
    // it, so a settled read is always gone from `pending` by the time `settle`
    // resumes. The rejection handler also keeps a defect in the handler from
    // surfacing as an unhandled rejection; the handler itself never rejects.
    const forget = (): void => void this.pending.delete(read)
    read.then(forget, forget)
  }

  /**
   * Wait up to `timeoutMs` for every tracked read to settle, and return the
   * responses still unread at the deadline for the caller to record. A read
   * that finishes later lands after the caller has taken its snapshot, so it
   * can neither be counted twice nor change a summary already returned.
   */
  async settle(timeoutMs: number): Promise<Omit<UnreadScriptResponse, 'reason'>[]> {
    if (this.pending.size > 0) {
      let timer: NodeJS.Timeout | undefined
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
      await Promise.race([Promise.allSettled([...this.pending.keys()]), deadline])
      clearTimeout(timer)
    }
    return [...this.pending.values()]
  }
}
