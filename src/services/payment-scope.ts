import type { DetectionSummary } from '../types/detection.js'
import type { DocumentId, PaymentScope } from '../types/document.js'
import { type DetectedResponse, type HeaderDetectionSummary, type HeaderName, headerObservationKey, type HeaderUrl } from '../types/header.js'
import type { ScriptInfo } from '../types/script.js'

export type ScopedDetection = {
  /** Compared, alerted on and inventoried. The whole run when no payment page is resolved. */
  payment: DetectionSummary
  /** Recorded in the auditor report only. Null when the whole run is in scope. */
  outsidePayment: DetectionSummary | null
}

/**
 * Split a run into the payment page's SPA context and everything else.
 *
 * Only documents loaded *before* the payment page leave scope — see
 * `outsidePaymentDocuments`. Everything else stays in: the payment document,
 * every document loaded after it (a reload of the payment page, a 3-D Secure
 * redirect, a confirmation page), any earlier render of the payment page's own
 * path, and anything that could not be attributed. So a gap in attribution,
 * or a navigation nobody anticipated, can only produce an extra alert, never
 * hide one. When the workflow marks no `paymentPage` step, or no payment
 * document was resolved, nothing leaves scope and the run behaves exactly as
 * it did before scoping existed.
 *
 * Scoping is by document, not by step: an SPA that soft-navigates into the
 * payment page keeps every earlier route's scripts in the payment document,
 * so they are judged as the payment page's own. A full page load is what
 * separates an earlier page from it.
 */
export function partitionByPaymentScope(summary: DetectionSummary): ScopedDetection {
  const outside = outsidePaymentDocuments(summary.paymentScope)
  if (outside === null) {
    return {
      payment: {
        ...summary,
        scriptSummary: {
          externalScripts: collapseExternal(summary.scriptSummary.externalScripts),
          inlineScripts: collapseInline(summary.scriptSummary.inlineScripts),
          unreadScripts: [...(summary.scriptSummary.unreadScripts ?? [])],
          unansweredRequests: [...(summary.scriptSummary.unansweredRequests ?? [])],
        },
      },
      outsidePayment: null,
    }
  }

  const inScope = (document: DocumentId | null | undefined): boolean => document === undefined || document === null || !outside.has(document)

  const splitScripts = (scripts: ScriptInfo[], collapse: (scripts: ScriptInfo[]) => ScriptInfo[]): [ScriptInfo[], ScriptInfo[]] => [
    collapse(scripts.filter((script) => inScope(script.document))),
    collapse(scripts.filter((script) => !inScope(script.document))),
  ]
  const [paymentExternal, outsideExternal] = splitScripts(summary.scriptSummary.externalScripts, collapseExternal)
  const [paymentInline, outsideInline] = splitScripts(summary.scriptSummary.inlineScripts, collapseInline)
  // Unread scripts follow the same rule as every other observation: only one
  // attributed to a known earlier page leaves scope; an unattributed one stays.
  const unread = summary.scriptSummary.unreadScripts ?? []
  const paymentUnread = unread.filter((script) => inScope(script.document))
  const outsideUnread = unread.filter((script) => !inScope(script.document))
  // Unanswered requests too, though they never fail the run: the scope is
  // what tells a reader whether the request came from the payment page.
  const unanswered = summary.scriptSummary.unansweredRequests ?? []
  const paymentUnanswered = unanswered.filter((request) => inScope(request.document))
  const outsideUnanswered = unanswered.filter((request) => !inScope(request.document))

  const [paymentHeaders, outsideHeaders] = splitHeaders(summary.headerSummary, inScope)
  const responses = summary.headerSummary.responses ?? []
  const splitResponses = (keep: (response: DetectedResponse) => boolean): DetectedResponse[] => responses.filter(keep)

  return {
    payment: {
      ...summary,
      scriptSummary: { externalScripts: paymentExternal, inlineScripts: paymentInline, unreadScripts: paymentUnread, unansweredRequests: paymentUnanswered },
      headerSummary: { ...summary.headerSummary, headers: paymentHeaders, responses: splitResponses((response) => inScope(response.document)) },
    },
    outsidePayment: {
      ...summary,
      scriptSummary: { externalScripts: outsideExternal, inlineScripts: outsideInline, unreadScripts: outsideUnread, unansweredRequests: outsideUnanswered },
      headerSummary: { ...summary.headerSummary, headers: outsideHeaders, responses: splitResponses((response) => !inScope(response.document)) },
    },
  }
}

/**
 * The documents a scoped run treats as outside the payment page, or `null`
 * when the run is not scoped (no marker, no payment document resolved, or the
 * payment document missing from the page chain).
 *
 * A document is outside only when **all** of these hold:
 *
 * 1. **It never rendered a payment page.** No URL it was ever at — its commit
 *    URL or any route it moved to by client-side navigation — shares an
 *    origin and path with any URL a payment document was ever at. This keeps
 *    in scope a failed render of the payment page that reload recovery
 *    replaced, whether that render was loaded at the payment path or routed
 *    there in an SPA — possibly the very render a skimmer broke.
 * 2. **It was never current at or after the payment page.** Every appearance
 *    of it in the page chain precedes the first payment document. This keeps
 *    in scope everything after the payment page — a 3-D Secure redirect, a
 *    confirmation page — and an earlier page the browser restores from the
 *    back/forward cache after it, which keeps its original document id.
 * 3. **If the monitor's own reload recovery replaced it, what replaced it is
 *    outside too.** A document recovery replaced is a failed render of the
 *    page recovery reloaded, so it takes the scope of the document that
 *    replaced it — the next one in the chain. Recovery reloads the start URL
 *    or the current route, which can land on a different path (a per-visit
 *    session path, say), so rule 1 alone cannot recognise such a render;
 *    detection records every document it replaces, on every step. A failed
 *    render replaced by a payment page, or by anything else in scope, stays
 *    in scope; one with no replacement in the chain stays in scope too.
 *
 * Anything else, including a document missing from the chain, is in scope.
 * Together the rules describe "an earlier, different page the payment page
 * replaced" and nothing more; any doubt resolves to in scope.
 */
export function outsidePaymentDocuments(scope: PaymentScope | undefined): ReadonlySet<DocumentId> | null {
  if (scope === undefined || !scope.declared || scope.paymentDocuments.length === 0) return null

  const paymentDocuments = new Set<DocumentId>(scope.paymentDocuments)
  const firstPayment = scope.documents.findIndex((document) => paymentDocuments.has(document.id))
  if (firstPayment === -1) return null

  const pathsOf = (id: DocumentId): string[] => scope.documents.filter((document) => document.id === id).flatMap((document) => [document.url, ...document.routes].map(pathKey))
  const paymentPaths = new Set([...paymentDocuments].flatMap(pathsOf))
  const currentFromPaymentOnwards = new Set(scope.documents.slice(firstPayment).map((document) => document.id))

  const outside = new Set<DocumentId>()
  for (const document of scope.documents.slice(0, firstPayment)) {
    if (currentFromPaymentOnwards.has(document.id)) continue
    if (pathsOf(document.id).some((path) => paymentPaths.has(path))) continue
    outside.add(document.id)
  }

  // Rule 3, to a fixed point: recovery can replace a render that recovery
  // itself produced, so one pass is not enough.
  const replacementOf = (id: DocumentId): DocumentId | undefined => {
    const last = scope.documents.map((document) => document.id).lastIndexOf(id)
    return last === -1 ? undefined : scope.documents[last + 1]?.id
  }
  for (let changed = true; changed;) {
    changed = false
    for (const replaced of scope.recoveryReplaced ?? []) {
      if (!outside.has(replaced)) continue
      const replacement = replacementOf(replaced)
      if (replacement === undefined || !outside.has(replacement)) {
        outside.delete(replaced)
        changed = true
      }
    }
  }
  return outside
}

/** Origin and path, without a trailing slash: the identity of a page as opposed to a visit. */
function pathKey(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '') || '/'}`
  } catch {
    return url
  }
}

/**
 * Capture keeps one copy of a script per document, so the payment page's copy
 * survives even when an earlier page loaded the same bytes. Within one scope,
 * collapse those cross-document copies back to what detection always kept:
 * external scripts once per (url, hash); inline scripts once per hash across
 * scans — while two identical inline scripts found in the *same* document
 * (one scan) are both kept, as they always were, since they may differ in
 * initiator. Keeps the first observation, so a run compares and alerts on
 * each script exactly as it did before documents were tracked.
 */
function collapseExternal(scripts: ScriptInfo[]): ScriptInfo[] {
  const seen = new Set<string>()
  return scripts.filter((script) => {
    const key = `${script.source.type === 'external' ? script.source.url : ''}\u0000${script.hash.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collapseInline(scripts: ScriptInfo[]): ScriptInfo[] {
  const documentsByHash = new Map<string, Set<DocumentId | undefined>>()
  return scripts.filter((script) => {
    const documents = documentsByHash.get(script.hash.value)
    if (documents !== undefined && !documents.has(script.document)) return false
    documentsByHash.set(script.hash.value, (documents ?? new Set()).add(script.document))
    return true
  })
}

type HeaderMap = Map<HeaderName, Map<string, Set<HeaderUrl>>>

/**
 * A (name, value, url) observation can come from several documents — the same
 * CSP directive from the same URL on two full page loads. It belongs to the
 * payment scope if any of them is in scope, and to the outside scope if any of
 * them is not: a value seen both before and on the payment page appears in
 * both, which is the truth.
 */
function splitHeaders(summary: HeaderDetectionSummary, inScope: (document: DocumentId | null | undefined) => boolean): [HeaderMap, HeaderMap] {
  const payment: HeaderMap = new Map()
  const outside: HeaderMap = new Map()
  const add = (map: HeaderMap, name: HeaderName, value: string, url: HeaderUrl): void => {
    const values = map.get(name) ?? new Map<string, Set<HeaderUrl>>()
    const urls = values.get(value) ?? new Set<HeaderUrl>()
    urls.add(url)
    values.set(value, urls)
    map.set(name, values)
  }

  for (const [name, values] of summary.headers) {
    for (const [value, urls] of values) {
      for (const url of urls) {
        const documents = summary.documents?.get(headerObservationKey(name, value, url)) ?? new Set<DocumentId | null>([null])
        if ([...documents].some(inScope)) add(payment, name, value, url)
        if ([...documents].some((document) => !inScope(document))) add(outside, name, value, url)
      }
    }
  }
  return [payment, outside]
}
