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

/**
 * Semantic version of the document shape.
 *
 * Minor for additive optional fields; major for a removal, a retype, or a
 * change in what an existing value means. Consumers should gate on the major
 * and tolerate unknown fields.
 */
export const REPORT_SCHEMA_VERSION = '1.1.0'

/** Which half of the system produced this document. */
export type ReportPass = 'inventory' | 'detection'

export type ReportRowStatus = 'authorised' | 'unauthorised_content' | 'unknown' | 'missing_required'

export type ReportResourceKind = 'external_script' | 'inline_script' | 'header'

export type ReportMatcherType = 'name' | 'header-name' | 'content' | 'hash' | 'host' | 'url' | 'workflow' | 'csp-directive' | 'or' | 'and'

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
  /** Stable across runs; used as the HTML anchor and the dedupe key. */
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
  /** `missing_required` rows only. */
  requiredOn: ResponseResourceType[] | null
  responseResourceType: ResponseResourceType | null
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
  counts: ReportStatusCounts
  scripts: ReportResourceRow[]
  headers: ReportResourceRow[]
  unmatchedInventoryEntries: ReportUnmatchedEntry[]
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
  /** `partial` when any target failed, so a short census is never mistaken for a clean one. */
  status: 'complete' | 'partial'
  failures: { targetKey: string; message: string }[]
  ci: { provider: 'github-actions'; runId: string; runAttempt: string; workflow: string; repository: string; sha: string } | null
}

export type AuditorReport = {
  schemaVersion: string
  generator: { name: string; version: string }
  run: ReportRunMetadata
  summary: ReportStatusCounts & { targets: number; targetsFailed: number }
  targets: ReportTargetSection[]
  /** Machine-stated caveats: truncation, redaction, partial run, size cap. */
  notes: string[]
}
