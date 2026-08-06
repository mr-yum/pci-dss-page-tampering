/**
 * Render an auditor report as a single self-contained HTML page.
 *
 * Pure and dependency-free: no build step, no CDN, no fonts, no images. The
 * page has to open from a downloaded CI artefact on a machine with no network,
 * and a strict CSP means it cannot reach out even if something tried.
 *
 * @see ./escape.ts for the escaping boundary — read that first
 * @see ../../../types/report.ts
 */

import type { AuditorReport, ReportAuthorisationInfo, ReportMatcherRef, ReportResourceRow, ReportStatusCounts, ReportTargetSection, ReportUnmatchedEntry } from '../../../types/report.js'
import { createSha256Hash } from '../../../utils/hash.js'
import type { ProvenanceNode, SourceProvenance } from '../../../utils/provenance.js'
import { escapeHtml, html, join, raw, type RawHtml, safeHttpsHref } from './escape.js'
import { REPORT_SCRIPT } from './script.js'
import { REPORT_STYLES } from './styles.js'

const STATUS_LABELS: Record<string, string> = {
  authorised: 'Authorised',
  unauthorised_content: 'Unauthorised',
  unknown: 'Unknown',
  missing_required: 'Missing',
}

const KIND_LABELS: Record<string, string> = {
  external_script: 'External script',
  inline_script: 'Inline script',
  header: 'Header',
}

function base64Sha256(value: string): string {
  return Buffer.from(createSha256Hash(value).value, 'hex').toString('base64')
}

/** A DOM id that is safe to put in an attribute and in a fragment link. */
function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase()
}

function badge(status: string): RawHtml {
  return html`<span class="badge badge-${status}">${STATUS_LABELS[status] ?? status}</span>`
}

function formatSource(source: SourceProvenance | null | undefined): RawHtml {
  if (source === null || source === undefined) return html`<span class="muted">—</span>`

  return html`<span class="mono">${source.file}:${source.line}</span>`
}

function formatAuthorisationInfo(info: ReportAuthorisationInfo | null): RawHtml {
  if (info === null) return html`<span class="muted">—</span>`

  return html`${info.description} <span class="muted mono">(${info.authorised ? 'authorised' : 'NOT authorised'}, ${info.date})</span>`
}

function formatPattern(matcher: ReportMatcherRef): RawHtml {
  switch (matcher.pattern.kind) {
    case 'regex':
      return html`<code>${matcher.pattern.value}</code>`
    case 'hashes':
      return join(matcher.pattern.hashes.map((entry) => html`<div class="mono">${entry.value} <span class="muted">(${entry.timestamp})</span></div>`))
    case 'csp-directive':
      return html`<div><span class="mono">${matcher.pattern.directive}</span> — any ordering of these ${matcher.pattern.allow.length} source(s), and no others:</div>
        <ul>
          ${join(matcher.pattern.allow.map((source) => html`<li class="mono">${source}</li>`))}
        </ul>`
    case 'composite':
      return html`<ul>
        ${join(matcher.pattern.children.map((child) => html`<li>${child.description} ${formatPattern(child)}</li>`))}
      </ul>`
  }
}

function formatMatcher(matcher: ReportMatcherRef | null): RawHtml {
  if (matcher === null) return html`<span class="muted">—</span>`

  return html`<div>${matcher.description}</div>
    <details>
      <summary>Pattern</summary>
      ${formatPattern(matcher)}
    </details>`
}

/** Render the authorising path, including every conjunct of an AND. */
function formatProvenanceNode(node: ProvenanceNode): RawHtml {
  const children = node.children ?? []

  return html`<li>
    <span class="mono">${node.file}:${node.line}</span> — ${node.description} ${node.authorisationInfo === undefined ? '' : html` <span class="muted">${node.authorisationInfo.description}</span>`}
    ${
      children.length === 0
        ? ''
        : html`<ul>
            ${join(children.map(formatProvenanceNode))}
          </ul>`
    }
  </li>`
}

function formatRow(row: ReportResourceRow, targetKey: string): RawHtml {
  const provenance = row.inventoryEntry?.provenance ?? null
  const authorisingSource = provenance?.authorisedBy ?? null
  const justification = row.authorisation.effective
  // Detected values are rendered as text only, never as a link: a `javascript:`
  // script URL is exactly the artefact of an attack this report documents.
  const search = [row.name, row.value ?? '', row.origin.host ?? '', row.status, row.kind, row.observed.hash ?? '', justification?.description ?? ''].join(' ').toLowerCase()

  return html`<tr data-row data-target="${targetKey}" data-status="${row.status}" data-kind="${row.kind}" data-search="${search}" id="row-${row.rowId}">
    <td>
      ${badge(row.status)}
      <div class="muted kind">${KIND_LABELS[row.kind] ?? row.kind}</div>
    </td>
    <td class="name">
      <div class="mono resource-name">${row.name}</div>
      ${row.value === null ? '' : html`<div class="mono resource-value">${row.value}</div>`}
      <div class="muted row-meta">${row.origin.host ?? '—'} · ${row.workflowId}${row.occurrences > 1 ? html` · observed ${row.occurrences}×` : ''}</div>
      ${
        // A header's excerpt is its value, already shown above — repeating it
        // as a disclosure adds a row of noise per header and nothing else.
        row.observed.contentExcerpt === null || row.kind === 'header'
          ? ''
          : html`<details>
              <summary>Content excerpt${row.observed.contentTruncated ? html` (first ${row.observed.contentExcerpt.length} of ${row.observed.contentLength} chars)` : ''}</summary>
              <pre>${row.observed.contentExcerpt}</pre>
            </details>`
      }
    </td>
    <td class="what">
      ${
        justification === null
          ? html`<span class="muted">No justification recorded</span>`
          : html`<div class="justification">${justification.description}</div>
              <div class="muted row-meta">${justification.authorised ? 'authorised' : 'NOT authorised'} · ${justification.date}</div>`
      }
      ${
        row.authorisation.metadataPath.length > 1
          ? html`<details>
              <summary>Full authorisation chain</summary>
              <ol>
                ${join(row.authorisation.metadataPath.map((info) => html`<li>${formatAuthorisationInfo(info)}</li>`))}
              </ol>
            </details>`
          : ''
      }
    </td>
    <td class="integrity">
      <div class="mono">${row.observed.hash === null ? html`<span class="muted">no hash</span>` : html`${row.observed.hash.slice(0, 12)}…`}</div>
      <div class="muted row-meta">${row.authorisation.matcher === null ? 'not identified' : html`matched by ${row.authorisation.matcher.type}`}</div>
      ${row.authorisation.failureReason === null ? '' : html`<div class="failure">${row.authorisation.failureReason}</div>`}
      <details>
        <summary>Matchers</summary>
        <dl class="kv">
          <dt>Identified by</dt>
          <dd>${formatMatcher(row.identification)}</dd>
          <dt>Authorised by</dt>
          <dd>${formatMatcher(row.authorisation.matcher)}</dd>
        </dl>
      </details>
    </td>
    <td class="src">
      ${formatSource(provenance?.entry)}
      ${
        authorisingSource === null
          ? provenance?.unresolvedReason === undefined
            ? ''
            : html`<div class="muted">${provenance.unresolvedReason}</div>`
          : html`<details>
              <summary>Authorised by</summary>
              <ul>
                ${formatProvenanceNode(authorisingSource)}
              </ul>
            </details>`
      }
    </td>
  </tr>`
}

const ROW_HEADERS = ['Status', 'Resource', 'What it is', 'Integrity', 'Inventory source']

function formatTable(caption: string, rows: readonly ReportResourceRow[], targetKey: string): RawHtml {
  if (rows.length === 0) return html`<p class="muted">No ${caption.toLowerCase()} observed.</p>`

  return html`<div class="table-wrap">
    <table>
      <caption>
        ${caption} (${rows.length})
      </caption>
      <thead>
        <tr>
          ${join(ROW_HEADERS.map((heading) => html`<th scope="col">${heading}</th>`))}
        </tr>
      </thead>
      <tbody>
        ${join(rows.map((row) => formatRow(row, targetKey)))}
      </tbody>
    </table>
  </div>`
}

function formatUnmatched(entries: readonly ReportUnmatchedEntry[]): RawHtml {
  if (entries.length === 0) return raw('')

  return html`<h3>Inventory entries not observed in this run (${entries.length})</h3>
    <p class="muted">Authorised entries that nothing on the page matched — either stale inventory, or a resource that stopped loading.</p>
    <div class="table-wrap">
      <table>
        <caption>
          Unmatched inventory entries
        </caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Identified by</th>
            <th scope="col">Justification</th>
            <th scope="col">Inventory source</th>
          </tr>
        </thead>
        <tbody>
          ${join(
            entries.map(
              (entry) =>
                html`<tr>
                  <td>${entry.kind}</td>
                  <td>${formatMatcher(entry.identification)}</td>
                  <td>${formatAuthorisationInfo(entry.effective)}</td>
                  <td class="src">${formatSource(entry.source)}</td>
                </tr>`,
            ),
          )}
        </tbody>
      </table>
    </div>`
}

function formatCounts(counts: ReportStatusCounts): RawHtml {
  return html`<div class="chips">
    <span class="chip">Total <strong>${counts.total}</strong></span>
    <span class="chip">Authorised <strong>${counts.authorised}</strong></span>
    <span class="chip">Unauthorised <strong>${counts.unauthorised_content}</strong></span>
    <span class="chip">Unknown <strong>${counts.unknown}</strong></span>
    <span class="chip">Missing required <strong>${counts.missing_required}</strong></span>
  </div>`
}

function formatTarget(target: ReportTargetSection): RawHtml {
  const id = `target-${slug(target.targetKey)}`

  return html`<section data-target="${target.targetKey}" id="${id}">
    <h2>${target.targetName} <span class="badge badge-${target.status}">${target.status}</span></h2>
    <p class="sub"><span class="mono">${target.url}</span> · inventory <span class="mono">${target.inventoryFile}</span> · workflow <span class="mono">${target.workflowId}</span> (<span class="mono">${target.workflowFile}</span>)</p>
    ${target.error === null ? '' : html`<p class="banner banner-warn">This target failed: ${target.error}</p>`} ${formatCounts(target.counts)} ${formatTable('Scripts', target.scripts, target.targetKey)}
    ${formatTable('Headers', target.headers, target.targetKey)} ${formatUnmatched(target.unmatchedInventoryEntries)}
  </section>`
}

function formatRunMetadata(report: AuditorReport): RawHtml {
  const { run } = report
  const repositoryHref = safeHttpsHref(run.inventoryRef.repositoryUrl)

  const field = (key: string, value: RawHtml | string): RawHtml => html`<div><span class="k">${key}</span><span class="v">${value}</span></div>`

  return html`<div class="meta">
    ${field('Pass', run.pass)} ${field('Mode requested', run.configuredMode)}
    ${field('Inventory repository', repositoryHref === null ? html`<span class="mono">${run.inventoryRef.repositoryUrl}</span>` : html`<a href="${repositoryHref}" rel="noreferrer noopener">${run.inventoryRef.repositoryUrl}</a>`)}
    ${field('Inventory branch', html`<span class="mono">${run.inventoryRef.branch}</span>`)}
    ${field('Inventory commit', run.inventoryRef.commitSha === null ? 'not recorded' : html`<span class="mono">${run.inventoryRef.commitSha}</span>${run.inventoryRef.commitIsoDate === null ? '' : html` <span class="muted">(${run.inventoryRef.commitIsoDate})</span>`}`)}
    ${field('Started', run.startedAt)} ${field('Completed', run.completedAt)} ${field('Duration', `${Math.round(run.durationMs / 1000)}s`)} ${field('Run status', run.status)}
    ${field('Target filter', run.targetFilter ?? 'none (all targets)')} ${field('Correlation id', html`<span class="mono">${run.correlationId}</span>`)}
    ${run.ci === null ? raw('') : field('CI run', html`<span class="mono">${run.ci.repository} #${run.ci.runId} (attempt ${run.ci.runAttempt})</span>`)}
  </div>`
}

/** Render the complete, self-contained report page. */
export function renderReportHtml(report: AuditorReport): string {
  const title = `Auditor report — ${report.run.pass} — ${report.run.completedAt}`
  const scriptHash = base64Sha256(REPORT_SCRIPT)

  const banners = join([
    ...(report.run.targetFilter !== null ? [html`<p class="banner banner-warn">PARTIAL CENSUS — this run was filtered to target “${report.run.targetFilter}” and does not cover every monitored target.</p>`] : []),
    ...(report.run.status === 'partial' ? [html`<p class="banner banner-warn">PARTIAL RUN — ${report.run.failures.length} target(s) failed; their resources are missing from this census.</p>`] : []),
  ])

  const body = html`<main>
    <h1>${title}</h1>
    <p class="sub">PCI DSS 6.4.3 script inventory and 11.6.1 detection evidence. Schema version ${report.schemaVersion}.</p>
    ${banners} ${formatRunMetadata(report)} ${formatCounts(report.summary)}

    <nav class="nav" aria-label="Targets">
      <strong>Targets</strong>
      <ul>
        ${join(report.targets.map((target) => html`<li><a href="#target-${slug(target.targetKey)}">${target.targetName}</a> — ${target.counts.total} resources</li>`))}
      </ul>
    </nav>

    <div class="toolbar" role="search">
      <div class="toolbar-row">
        <label for="report-target">Target</label>
        <select id="report-target">
          <option value="">All targets (${report.targets.length})</option>
          ${join(report.targets.map((target) => html`<option value="${target.targetKey}">${target.targetName} — ${target.counts.total}</option>`))}
        </select>
        <label for="report-search">Search</label>
        <input type="search" id="report-search" placeholder="URL, header, hash, justification…" />
        <label><input type="checkbox" id="report-findings-only" />Findings only</label>
        <button type="button" id="report-expand-all">Expand all</button>
        <button type="button" id="report-collapse-all">Collapse all</button>
        <span class="count" id="report-count" aria-live="polite"></span>
      </div>
      <div class="toolbar-row">
        <span class="group-label">Type</span>
        ${join(Object.keys(KIND_LABELS).map((kind) => html`<label><input type="checkbox" data-kind="${kind}" checked />${KIND_LABELS[kind]}</label>`))}
        <span class="group-label">Status</span>
        ${join(Object.keys(STATUS_LABELS).map((status) => html`<label><input type="checkbox" data-status="${status}" checked />${STATUS_LABELS[status]}</label>`))}
      </div>
    </div>

    ${join(report.targets.map(formatTarget))}

    <section class="notes">
      <h2>Notes</h2>
      <ul>
        ${join(report.notes.map((note) => html`<li>${note}</li>`))}
      </ul>
      <p>The canonical machine-readable form of this report is the sibling <span class="mono">report.json</span>.</p>
    </section>
  </main>`

  // `<meta>` CSP is a second layer, not the primary control — the primary
  // control is that no untrusted data reaches a script or a URL attribute.
  // Hashing our own constant script means the page needs no 'unsafe-inline'.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; form-action 'none'; base-uri 'none'" />
    <title>${escapeHtml(title)}</title>
    <style>
${REPORT_STYLES}
    </style>
  </head>
  <body>
${body.value}
    <script>${REPORT_SCRIPT}</script>
  </body>
</html>
`
}
