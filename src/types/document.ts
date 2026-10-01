/**
 * Identity of one top-level browser document: the Chrome DevTools `loaderId`
 * of the navigation that created it. A full page load creates a new document;
 * a client-side (SPA) route change keeps the same one — which is exactly the
 * boundary of a page's SPA context.
 */
export type DocumentId = string

/** One top-level document the workflow passed through, in order. */
export type DocumentTrailEntry = {
  id: DocumentId
  /** URL the document was committed at. Unredacted here; the report redacts it. */
  url: string
  /**
   * Every URL the document moved to by same-document navigation (`pushState`,
   * `replaceState`, fragment changes) while this entry was current. A single
   * document can render several pages of an SPA, and payment scoping needs to
   * know every page it rendered, not only the one it was loaded at.
   */
  routes: string[]
  /** Workflow step running when the document was committed (0 = initial navigation). */
  firstStep: number
  /** Last workflow step that ran while this was the current document. */
  lastStep: number
}

/**
 * Which part of a run is the payment page.
 *
 * Only earlier pages the payment page replaced leave payment scope — see
 * `outsidePaymentDocuments` for the exact rule, which is the single
 * definition. In short: a document is outside only if it was current before
 * the first payment document, never rendered a payment page path, was never
 * current at or after the payment page, and — if the monitor's own recovery
 * replaced it — was replaced by a document that is outside as well. Everything else — the payment page,
 * every page after it, failed renders of it, documents missing from the
 * chain, and observations that could not be attributed — is in scope:
 * compared, alerted on and inventoried. Outside observations are recorded in
 * the auditor report only. When no workflow step is marked `paymentPage`, or
 * no payment document could be resolved, the whole run stays in scope,
 * exactly as before this existed.
 */
export type PaymentScope = {
  /** True when the workflow marks at least one `paymentPage` step. */
  declared: boolean
  /** Documents in which a `paymentPage` step's target was found. */
  paymentDocuments: DocumentId[]
  documents: DocumentTrailEntry[]
  /**
   * Documents the monitor's own reload recovery replaced, on any step. Each is
   * a failed render of the page recovery reloaded, so it takes the scope of
   * the document that replaced it (see `outsidePaymentDocuments`, rule 3): a
   * failed render of a payment page stays in scope whatever its path, while a
   * failed render of an earlier page leaves with that page.
   */
  recoveryReplaced?: DocumentId[]
}
