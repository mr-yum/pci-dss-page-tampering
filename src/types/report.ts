/**
 * Auditor report model.
 *
 * A full census of every script and header observed during a run, each mapped
 * to the inventory matcher that authorised it and the justification recorded
 * against it. Alerts describe exceptions; this describes everything, which is
 * what a PCI assessor actually asks for:
 *
 * - **6.4.3** — an inventory of every script on the payment page, with written
 *   justification, authorisation, and a stated basis for integrity assurance.
 *   Answered by the full census (including `status: 'unknown'` rows), the
 *   `authorisation` block, and `observed.hash` plus the authorising matcher.
 * - **11.6.1** — evidence that a detection mechanism ran and alerted on change.
 *   Answered by `run` (mode, inventory ref, window, status) together with the
 *   non-authorised rows.
 *
 * The JSON document is the canonical artefact; the HTML page is rendered from
 * it. Both are written per pass — see `src/services/report/`.
 */

import type { EntryProvenance, SourceProvenance } from '../utils/provenance.js'
import type { ExecutionMode } from './config.js'
import type { ResponseResourceType } from './header.js'
import type { TargetType } from './target.js'

/**
 * Semantic version of the document shape.
 *
 * Minor for additive optional fields, and for a new reason an existing
 * status can be reported for when the status already meant what it still
 * means — `run.status: "partial"` has always meant "this census is short, do
 * not read it as clean", so a new way for a census to be short (an unread
 * payment-page script, 1.5.0) is minor even though `run.failures` can now be
 * empty alongside it. Likewise a list entry moved to where its documented
 * meaning puts it is minor: 1.5.0 listed every script request still without a
 * response at the deadline under `unreadScripts` (with `status: 0`); 1.6.0
 * splits them by evidence. A request whose body was never seen to finish
 * moves to `unansweredRequests` — it never ran, and never makes the run
 * partial. A request whose body is known to have finished although no
 * response was surfaced stays under `unreadScripts` with `status: 0` — it may
 * have run unexamined, and in payment scope it makes the run partial. So in
 * 1.6.0 `status: 0` under `unreadScripts` means "body finished, no response
 * surfaced", never "no response". Major for a removal, a retype, or
 * a change in what an existing value means. Consumers should gate on the
 * major, tolerate unknown fields, and never infer one field's shape from
 * another's value.
 *
 * Patch when a value's derivation is corrected without its meaning or shape
 * changing — a `rowId` whose inputs were fixed, for instance — so a consumer
 * that keyed on it across runs knows why it moved.
 *
 * 1.7.0 adds initiator chains (`observed.initiatorChain`,
 * `unansweredRequests[].initiatorChain`) and inherited authorisation
 * (`authorisation.inherited`, `inventoryEntry.provenance.grantedBy`): an
 * `authorised` script row may now be authorised by a load grant on an
 * ancestor rather than by an entry identifying it. `status: 'authorised'`
 * still means exactly what it meant — the inventory authorises this script —
 * so this is minor; a consumer that needs to know HOW reads `inherited`.
 */
export const REPORT_SCHEMA_VERSION = '1.7.0'

/**
 * Where an observation sits relative to the payment page, when the target's
 * workflow marks one (`paymentPage`) and it was identified. `outside_payment`
 * rows were observed in an earlier page the payment page replaced — one that
 * never rendered a payment path, was never current at or after the payment
 * page, and — if the monitor's own reload recovery replaced it — was replaced
 * by a document that is itself outside (see `outsidePaymentDocuments`):
 * recorded here as evidence, never alerted on. Everything else is
 * `payment` — the payment page and its SPA
 * context, every page after it, failed renders of it, and anything that could
 * not be attributed — and is what the run alerts on and inventories. Absent
 * when the workflow marks no payment page or it could not be identified.
 */
export type ReportScope = 'payment' | 'outside_payment'

/** One top-level document the workflow passed through. */
export type ReportDocument = {
  /** Redacted: origin and path only. */
  url: string
  /** Workflow step running when the document was loaded (0 = initial navigation). */
  firstStep: number
  lastStep: number
  /** True for a document in which a `paymentPage` step's target was found. */
  paymentPage: boolean
  /**
   * Whether this document's observations were alerted on. Only an earlier
   * page the payment page replaced is `outside_payment` (see `ReportScope`);
   * the payment page, everything after it and any failed render of it are
   * `payment`. All `payment` when the payment page could not be identified.
   */
  scope: ReportScope
}

/** Which half of the system produced this document. */
export type ReportPass = 'inventory' | 'detection'

export type ReportRowStatus = 'authorised' | 'unauthorised_content' | 'unknown' | 'missing_required'

/**
 * `script` (added in 1.3.0) is the kind of a `missing_required` script row:
 * the resource was never observed, so external vs inline cannot be stated.
 */
export type ReportResourceKind = 'external_script' | 'inline_script' | 'script' | 'header'

export type ReportMatcherType = 'name' | 'header-name' | 'content' | 'hash' | 'host' | 'url' | 'workflow' | 'targetType' | 'csp-directive' | 'initiator-host' | 'or' | 'and'

/** Authorisation metadata, with dates rendered as ISO-8601 UTC strings. */
export type ReportAuthorisationInfo = {
  description: string
  authorised: boolean
  date: string
}

export type ReportMatcherPattern =
  { kind: 'regex'; value: string } | { kind: 'hashes'; hashes: { value: string; timestamp: string }[] } | { kind: 'csp-directive'; directive: string; allow: string[] } | { kind: 'composite'; children: ReportMatcherRef[] }

/** A matcher as an auditor sees it: what kind, what it matches, and why it is allowed. */
export type ReportMatcherRef = {
  type: ReportMatcherType
  /** `matcher.getDescription()` — the same string the run logs printed. */
  description: string
  pattern: ReportMatcherPattern
  /** This matcher's own metadata, when it carries any. */
  authorisationInfo: ReportAuthorisationInfo | null
}

/**
 * One hop of an initiator chain as the report shows it: a script URL or
 * document URL redacted like every other URL (origin and path only; `blob:`
 * keeps its minting host), or an inline identity (`inline_script/<name>#<token>`)
 * sanitised for display. See `src/types/initiator-chain.ts` for the kinds.
 */
export type ReportInitiatorHop = { url: string; kind: 'script' | 'document' | 'unknown' }

/**
 * What was actually observed on the page.
 *
 * The hash is the integrity anchor and the thing the inventory authorises; the
 * excerpt exists only so a human recognises the resource. Full script bodies
 * are never included — see `contentTruncated`.
 */
export type ReportObservedContent = {
  /** SHA-256 hex of the content. Null for headers and missing-required rows. */
  hash: string | null
  /** Length of the untruncated content, so truncation is itself auditable. */
  contentLength: number | null
  /** Sanitised, truncated excerpt. Never the basis for an integrity decision. */
  contentExcerpt: string | null
  contentTruncated: boolean
  /**
   * Scripts only (added in 1.7.0): who loaded this script, immediate inserter
   * first, out to the page. Absent when the run had no initiator evidence for
   * it. A walk that forked records its other paths in
   * `alternateInitiatorChains`.
   */
  initiatorChain?: ReportInitiatorHop[]
  alternateInitiatorChains?: ReportInitiatorHop[][]
}

export type ReportAuthorisation = {
  /** The root `authoriseWith` matcher of the entry that identified this resource. */
  matcher: ReportMatcherRef | null
  decision: 'authorised' | 'denied' | 'not_applicable'
  failureReason: string | null
  /** Root-to-leaf authorisation chain from the comparison result. Never reordered. */
  metadataPath: ReportAuthorisationInfo[]
  /** The justification that actually decided this row — the last of `metadataPath`. */
  effective: ReportAuthorisationInfo | null
  /**
   * Present (since 1.7.0) only on a script authorised by inheritance: no
   * entry identified it, but an ancestor in its initiator chain was
   * authorised in the same run by an entry with `authorisesLoads`.
   * `inventoryEntry` is then the granting entry (its provenance carries
   * `grantedBy`), `identification` and `matcher` are null, and `effective` is
   * the granting entry's justification.
   */
  inherited?: {
    /** The granting script: redacted URL or inline identity. */
    from: string
    /** The chain from this script out to and including the granting script. */
    chain: ReportInitiatorHop[]
    mode: 'direct' | 'transitive'
  }
}

export type ReportInventoryEntryRef = {
  /** Index into `scripts[]` / `headers[]`, pairing with the provenance pointer. */
  index: number | null
  /** The entry re-serialised to its committed JSON shape. */
  raw: unknown
  /** File, JSON pointer and line for the entry and the node that authorised it. */
  provenance: EntryProvenance | null
}

export type ReportResourceRow = {
  /**
   * Stable across runs for a given tool version; used as the HTML anchor and
   * the dedupe key. Derived from the row's kind, name, hash, value, redacted
   * URL and workflow, so a correction to any of those derivations (1.6.1:
   * blob-URL redaction) changes the ids of the rows it touches; each such
   * change is a patch bump and a CHANGELOG entry, never silent.
   */
  rowId: string
  kind: ReportResourceKind
  status: ReportRowStatus
  /** The raw `ComparisonResultType['type']` discriminator, for machine consumers. */
  resultType: string
  /** Script URL, inline-script id, or lowercased header name. */
  name: string
  /** Header value; null for scripts. Separate from `name` so header rows are queryable. */
  value: string | null
  /** Redacted provenance of the resource itself (query and fragment removed). */
  origin: { url: string | null; host: string | null }
  workflowId: string
  /** How many times this identical row was observed (headers fan out per response). */
  occurrences: number
  observed: ReportObservedContent
  identification: ReportMatcherRef | null
  authorisation: ReportAuthorisation
  inventoryEntry: ReportInventoryEntryRef | null
  /**
   * `missing_required` rows only. Header rows carry response resource types
   * (`document`, `script`, …); script rows carry the passes the control is
   * required on (`inventory`, `detection`).
   */
  requiredOn: ResponseResourceType[] | TargetType[] | null
  responseResourceType: ResponseResourceType | null
  /** See `ReportScope`. Absent when the target's workflow marks no payment page. */
  scope?: ReportScope
}

/**
 * A script response the browser received but whose body the run could not
 * read (added in 1.5.0). Never a census row: there is no content, so no hash,
 * no identification and no authorisation decision — only the fact that the
 * script arrived and went unexamined. In payment scope (or with no `scope`)
 * it makes the run `partial`, exactly as a failed target does; outside the
 * payment page it is evidence only.
 */
export type ReportUnreadScript = {
  /** Redacted: origin and path only. */
  url: string
  resourceType: string
  /** HTTP status of the response whose body could not be read; 0 when the body finished loading but no response was ever surfaced, so no status is known. */
  status: number
  /** Workflow step running when the response arrived (0 = initial navigation). */
  step: number
  /** Redacted URL of the top-level document it belonged to; null when it could not be attributed. */
  documentUrl: string | null
  /** Why the body could not be read. */
  reason: string
  /** See `ReportScope`. Absent when the target's workflow marks no payment page. */
  scope?: ReportScope
}

/**
 * A script request the page issued that never got a response (added in
 * 1.6.0), and whose body was never seen to finish loading. Evidence, never a
 * finding, in either scope: in the observed Chrome behaviour (probe,
 * 2026-10-02) a script's response surfaces only once its body is complete and
 * a script cannot run before then, so such a request never executed on the
 * page. A request whose body did finish without a response surfacing is
 * listed under `unreadScripts` (status 0) instead. It never affects
 * `run.status`. Listed because the request itself deserves a
 * look — a URL the page built wrongly, or a host that stopped answering.
 */
export type ReportUnansweredRequest = {
  /** Redacted: origin and path only. A malformed URL is shown in the shape the browser requested it. */
  url: string
  resourceType: string
  /** Workflow step running when the request was issued (0 = initial navigation). */
  step: number
  /** Redacted URL of the top-level document it belonged to; null when it could not be attributed. */
  documentUrl: string | null
  /** Why it is recorded: still unanswered at the deadline, or its frame went away first. */
  reason: string
  /** Who asked for it (added in 1.7.0), from the request's own initiator; absent without evidence. */
  initiatorChain?: ReportInitiatorHop[]
  /** See `ReportScope`. Absent when the target's workflow marks no payment page. */
  scope?: ReportScope
}

/**
 * An inventory entry that nothing observed matched during this run.
 *
 * Real 6.4.3 hygiene signal: an authorised script that no longer appears is
 * either a stale entry to remove or a control that silently stopped loading.
 */
export type ReportUnmatchedEntry = {
  kind: 'script' | 'header'
  index: number
  identification: ReportMatcherRef
  authorisation: ReportMatcherRef | null
  effective: ReportAuthorisationInfo | null
  source: SourceProvenance | null
  raw: unknown
}

export type ReportStatusCounts = {
  authorised: number
  unauthorised_content: number
  unknown: number
  missing_required: number
  total: number
}

export type ReportTargetSection = {
  /** `<inventoryFile>#<workflowId>` — also the sort key. */
  targetKey: string
  inventoryFile: string
  workflowId: string
  targetName: string
  targetType: ReportPass
  /** Redacted: origin and path only. */
  url: string
  workflowFile: string
  status: 'completed' | 'failed'
  error: string | null
  /** Every row in the census, in or outside the payment page. */
  counts: ReportStatusCounts
  scripts: ReportResourceRow[]
  headers: ReportResourceRow[]
  unmatchedInventoryEntries: ReportUnmatchedEntry[]
  /** Script responses whose body could not be read (added in 1.5.0). Empty when every script was read. */
  unreadScripts: ReportUnreadScript[]
  /** Script requests that never got a response (added in 1.6.0). Evidence only; empty when none. */
  unansweredRequests: ReportUnansweredRequest[]
  /**
   * Present whenever the workflow marks a payment page: the documents the run
   * passed through, in order, and the counts for the rows the run alerts on.
   * `resolved: false` means the payment page could not be identified in this
   * run, so nothing was scoped out — every row was alerted on, rows carry no
   * `scope`, and `counts` here equals the full census. It is recorded so a
   * marker that has stopped resolving is visible rather than silent.
   */
  paymentScope?: { resolved: boolean; documents: ReportDocument[]; counts: ReportStatusCounts }
}

/**
 * An inventory file shipped alongside the report.
 *
 * The bytes are the exact ones the run parsed — the same text the provenance
 * line numbers were computed against — so `targets/1.0.json:489` in this report
 * resolves correctly against the copy in this artefact, whatever the branch has
 * done since. The digest lets a reader confirm the copy was not altered after
 * the fact.
 */
export type ReportInventorySource = {
  /** Path relative to the inventory repo root, e.g. `targets/1.0.json`. */
  file: string
  /** SHA-256 of the exact bytes as read. */
  sha256: string
  /** Where the copy sits, relative to this report document. */
  copiedTo: string
  /** Size in bytes, so a truncated copy is obvious. */
  bytes: number
}

export type ReportInventoryRef = {
  branch: string
  commitSha: string | null
  commitIsoDate: string | null
  /** Redacted: no credentials, query or fragment. */
  repositoryUrl: string
}

export type ReportRunMetadata = {
  /** The pass this document covers. Under `--mode all` there are two documents. */
  pass: ReportPass
  /** What the operator asked for: `all`, `inventory` or `detection`. */
  configuredMode: ExecutionMode
  /** Non-null means this is a FILTERED census, not a complete one. */
  targetFilter: string | null
  /** Identical across both documents of one process invocation. */
  correlationId: string
  inventoryRef: ReportInventoryRef
  startedAt: string
  completedAt: string
  durationMs: number
  /**
   * `partial` when any target failed, or (since 1.5.0) when any script in
   * payment scope could not be read — so a short census is never mistaken
   * for a clean one. An unanswered script request (`unansweredRequests`,
   * 1.6.0) never makes it partial: that script never ran.
   */
  status: 'complete' | 'partial'
  failures: { targetKey: string; message: string }[]
  /** Inventory files copied next to this report. Empty when none was retained. */
  inventorySources: ReportInventorySource[]
  ci: { provider: 'github-actions'; runId: string; runAttempt: string; workflow: string; repository: string; sha: string } | null
}

export type AuditorReport = {
  schemaVersion: string
  generator: { name: string; version: string }
  run: ReportRunMetadata
  /**
   * `scriptsUnread` (added in 1.5.0) counts unread scripts in payment scope
   * only — the ones that make the run partial. `requestsUnanswered` (added in
   * 1.6.0) counts unanswered script requests in every scope; it never makes
   * the run partial.
   */
  summary: ReportStatusCounts & { targets: number; targetsFailed: number; scriptsUnread: number; requestsUnanswered: number }
  targets: ReportTargetSection[]
  /** Machine-stated caveats: truncation, redaction, partial run, size cap. */
  notes: string[]
}
