/**
 * Turn a comparison result into a report row.
 *
 * Everything that makes detected content safe to put in an artefact happens
 * here rather than in the HTML renderer, so the JSON and the HTML agree and the
 * JSON is also safe to `cat` in a terminal.
 *
 * @see ../../types/report.ts
 * @see ./html/escape.ts for the separate output-encoding layer
 */

import type { ComparisonResultType } from '../../types/comparison.js'
import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo } from '../../types/inventory/model.js'
import type { ReportAuthorisation, ReportAuthorisationInfo, ReportObservedContent, ReportResourceKind, ReportResourceRow, ReportRowStatus } from '../../types/report.js'
import { createSha256Hash } from '../../utils/hash.js'
import { inventoryHeaderInfoToRawInventoryHeaderInfo } from '../../utils/inventory.js'
import type { ProvenanceResolver } from '../../utils/provenance.js'
import { inventoryScriptInfoToRawInventoryScriptInfo } from '../../utils/script.js'
import { extractHost, redactUrl, redactUrlCredentials } from '../../utils/url.js'
import { toReportAuthorisationInfo, toReportMatcherRef, toReportMatcherRefOrNull } from './matcher-ref.js'

/**
 * Characters kept from a detected resource for human recognition.
 *
 * Comfortably spans the 64-character anchored window that inline-script
 * inventory matchers use, so the excerpt always shows what the matcher matched,
 * while keeping a 39-script target's artefact around 20 KB.
 */
export const CONTENT_EXCERPT_LIMIT = 512

/**
 * Replace control and format characters with a visible token.
 *
 * Bidirectional overrides (U+202A–202E, U+2066–2069) let an attacker make a
 * malicious excerpt *render* as something benign in the assessor's browser —
 * the Trojan Source problem. Making them visible is the only honest rendering.
 * Tabs and newlines survive as escapes so multi-line content stays readable.
 */
export function sanitiseForDisplay(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, (character) => {
    if (character === '\n') return '\\n'
    if (character === '\r') return '\\r'
    if (character === '\t') return '\\t'

    return `⟨U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`
  })
}

/**
 * Longest input handed to the URL-redaction regexes.
 *
 * Those patterns backtrack quadratically on a long run of letters with no
 * `://` — a 100 KB inline script of `aaaa…` would otherwise stall the run, and
 * script bodies are attacker-influenced. Bounding the input keeps the work
 * proportional to what is actually published. Generous enough for any real URL
 * or header value, including a multi-kilobyte CSP.
 */
const MAX_REDACTION_INPUT = 8 * 1024

/**
 * Remove credentials and query strings, then make control characters visible.
 *
 * Applied to a bounded prefix: see {@link MAX_REDACTION_INPUT}. Anything beyond
 * that is dropped rather than published unredacted — the alternative is
 * publishing a secret or hanging the run, and neither is acceptable.
 */
export function redactForDisplay(value: string, limit = MAX_REDACTION_INPUT): { text: string; truncated: boolean } {
  const clipped = value.length > limit ? value.slice(0, limit) : value
  const safe = sanitiseForDisplay(redactUrlCredentials(clipped))

  return { text: safe.length > limit ? safe.slice(0, limit) : safe, truncated: value.length > limit || safe.length > limit }
}

/**
 * Prepare detected content for inclusion in the artefact.
 *
 * Truncated first, then redacted: only the excerpt is ever published, and
 * redacting a whole 266 KB bundle to throw all but 512 characters away is both
 * wasted work and a denial-of-service risk on hostile content.
 */
export function toObservedContent(content: string | null | undefined, hash: string | null): ReportObservedContent {
  if (content === null || content === undefined) {
    return { hash, contentLength: null, contentExcerpt: null, contentTruncated: false }
  }

  const { text } = redactForDisplay(content, CONTENT_EXCERPT_LIMIT)

  return {
    hash,
    contentLength: content.length,
    contentExcerpt: text,
    contentTruncated: content.length > CONTENT_EXCERPT_LIMIT,
  }
}

const STATUS_BY_RESULT_TYPE: Record<string, ReportRowStatus> = {
  authorized_script: 'authorised',
  authorized_header: 'authorised',
  known_script_unauthorised_content: 'unauthorised_content',
  known_header_unauthorised_content: 'unauthorised_content',
  unknown_script_found: 'unknown',
  unknown_header_found: 'unknown',
  missing_required_header: 'missing_required',
}

/**
 * A stable identity for a row, so the same resource keeps the same anchor
 * between runs and repeated observations collapse into one row.
 *
 * The separator cannot occur in a URL, header value or hash, so distinct part
 * lists cannot collide by concatenation. It is written as an escape on purpose:
 * a raw NUL in the source makes git classify the whole file as binary and drop
 * it from every diff.
 */
export function buildRowId(parts: readonly (string | null)[]): string {
  return createSha256Hash(parts.map((part) => part ?? '').join('\u0000')).value.slice(0, 16)
}

function toAuthorisation(result: ComparisonResultType): ReportAuthorisation {
  const metadataPath: ReportAuthorisationInfo[] = 'metadataPath' in result ? (result.metadataPath ?? []).map((info) => toReportAuthorisationInfo(info)).filter((info): info is ReportAuthorisationInfo => info !== null) : []

  // `metadataPath` is empty for the canonical single-matcher entry shape:
  // `processAuthorizeWith` strips `authorisationInfo` off the config before
  // building the matcher, so the matcher carries none and the entry holds it
  // instead. Without this fallback the Justification column — the thing an
  // assessor actually reads — is blank for the commonest entry shape.
  const entryInfo = 'inventoryEntry' in result ? toReportAuthorisationInfo(result.inventoryEntry.authoriseWith.authorisationInfo) : null
  const effective = metadataPath.length > 0 ? metadataPath[metadataPath.length - 1]! : entryInfo

  if (result.type === 'authorized_script' || result.type === 'authorized_header') {
    return { matcher: toReportMatcherRefOrNull(result.inventoryEntry.authoriseWith.matcher), decision: 'authorised', failureReason: null, metadataPath, effective }
  }

  if (result.type === 'known_script_unauthorised_content' || result.type === 'known_header_unauthorised_content') {
    return { matcher: toReportMatcherRef(result.authorizationMatcher as never), decision: 'denied', failureReason: result.failureReason, metadataPath, effective }
  }

  if (result.type === 'missing_required_header') {
    return { matcher: toReportMatcherRefOrNull(result.inventoryEntry.authoriseWith.matcher), decision: 'not_applicable', failureReason: 'required header was absent from the response', metadataPath, effective }
  }

  // Unknown resources were never identified, so nothing authorised or denied them.
  return { matcher: null, decision: 'not_applicable', failureReason: null, metadataPath, effective }
}

function toInventoryEntryRef(result: ComparisonResultType, inventory: Inventory, resolveProvenance: ProvenanceResolver | null): ReportResourceRow['inventoryEntry'] {
  if (!('inventoryEntry' in result)) return null

  const entry = result.inventoryEntry
  const isScript = result.type === 'authorized_script' || result.type === 'known_script_unauthorised_content'
  const index = isScript ? inventory.scripts.indexOf(entry as InventoryScriptInfo) : inventory.headers.indexOf(entry as InventoryHeaderInfo)

  return {
    index: index === -1 ? null : index,
    // Re-serialised with the same converters the push path uses, so the report
    // shows exactly what is committed rather than a second rendering of it.
    raw: isScript ? inventoryScriptInfoToRawInventoryScriptInfo(entry as InventoryScriptInfo) : inventoryHeaderInfoToRawInventoryHeaderInfo(entry as InventoryHeaderInfo),
    provenance: resolveProvenance?.(result) ?? null,
  }
}

/** Describe the resource itself: what it is, where it came from, what it contained. */
function describeResource(result: ComparisonResultType): { kind: ReportResourceKind; name: string; value: string | null; url: string | null; content: string | null; hash: string | null } {
  switch (result.type) {
    case 'authorized_script':
    case 'known_script_unauthorised_content':
    case 'unknown_script_found': {
      const script = result.script
      // An inline script's name is the generated id, not a URL.
      const isExternal = script.name.startsWith('http://') || script.name.startsWith('https://')

      return {
        kind: isExternal ? 'external_script' : 'inline_script',
        name: script.name,
        value: null,
        url: script.url ?? (isExternal ? script.name : null),
        content: script.content ?? null,
        hash: script.hash?.value ?? null,
      }
    }
    case 'authorized_header':
    case 'known_header_unauthorised_content':
    case 'unknown_header_found':
      return { kind: 'header', name: result.header.name, value: result.header.value, url: result.header.url ?? null, content: result.header.value, hash: null }
    case 'missing_required_header':
      return { kind: 'header', name: result.headerName, value: null, url: result.url, content: null, hash: null }
  }
}

/** Convert one comparison result into a row. */
export function toReportRow(result: ComparisonResultType, inventory: Inventory, workflowId: string, resolveProvenance: ProvenanceResolver | null): ReportResourceRow {
  const resource = describeResource(result)
  const status = STATUS_BY_RESULT_TYPE[result.type] ?? 'unknown'
  const identification = 'inventoryEntry' in result ? toReportMatcherRefOrNull(result.inventoryEntry.identifyWith) : null

  return {
    rowId: buildRowId([resource.kind, resource.name, resource.hash, resource.value, redactUrl(resource.url), workflowId]),
    kind: resource.kind,
    status,
    resultType: result.type,
    // Redacted like every other URL the report emits. A script `src` can carry
    // a signed URL or an API key in its query string, and a header value can
    // embed one too (a CSP `report-uri` commonly does) — neither may reach a
    // 90-day CI artefact, and the report's own notes promise they do not.
    name: redactForDisplay(resource.name).text,
    value: resource.value === null ? null : redactForDisplay(resource.value).text,
    origin: { url: resource.url === null ? null : redactUrl(resource.url), host: resource.url === null ? null : extractHost(resource.url) },
    workflowId,
    occurrences: 1,
    observed: toObservedContent(resource.content, resource.hash),
    identification,
    authorisation: toAuthorisation(result),
    inventoryEntry: toInventoryEntryRef(result, inventory, resolveProvenance),
    requiredOn: result.type === 'missing_required_header' ? (result.inventoryEntry.requiredOn ?? null) : null,
    responseResourceType: result.type === 'missing_required_header' ? result.resourceType : null,
  }
}
