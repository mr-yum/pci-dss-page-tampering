/**
 * Write auditor report artefacts to disk.
 *
 * Layout is fixed and pass-scoped, with no timestamp in any filename:
 *
 * ```
 * <report-dir>/index.html
 * <report-dir>/inventory/report.{json,html}
 * <report-dir>/detection/report.{json,html}
 * ```
 *
 * A timestamped filename would defeat `diff` between runs, which is the single
 * most useful thing an operator does with this artefact ("what changed since
 * yesterday?"). Uniqueness belongs where it matters — inside the document
 * (`run.startedAt`) and in the CI artifact name.
 *
 * Nothing under the user-supplied directory is ever deleted.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'

import type { IReportWriter, ReportArtefactPaths } from '../../interfaces/report.js'
import type { AuditorReport, ReportPass } from '../../types/report.js'
import { escapeHtml } from './html/escape.js'
import { renderReportHtml } from './html/template.js'
import { serialiseReport } from './json.js'

/** Past this, the page stops being pleasant to open in a browser. */
const MAX_HTML_BYTES = 2 * 1024 * 1024

/** Shorter excerpt used when the full-size page would be unwieldy. */
const REDUCED_EXCERPT_LIMIT = 128

/**
 * Shorten content excerpts, leaving hashes and matchers untouched.
 *
 * Excerpts exist for human recognition; the hash is the integrity anchor and
 * the matchers are the evidence. If something has to give on a very large
 * target, it is the excerpt — and the reduction is recorded in `notes` so the
 * document never quietly under-reports what it contains.
 */
function withReducedExcerpts(report: AuditorReport): AuditorReport {
  const shorten = (row: AuditorReport['targets'][number]['scripts'][number]): typeof row => {
    const excerpt = row.observed.contentExcerpt

    if (excerpt === null || excerpt.length <= REDUCED_EXCERPT_LIMIT) return row

    return { ...row, observed: { ...row.observed, contentExcerpt: excerpt.slice(0, REDUCED_EXCERPT_LIMIT), contentTruncated: true } }
  }

  return {
    ...report,
    targets: report.targets.map((target) => ({ ...target, scripts: target.scripts.map(shorten), headers: target.headers.map(shorten) })),
    notes: [...report.notes, `Content excerpts were shortened to ${REDUCED_EXCERPT_LIMIT} characters to keep this report a manageable size. Hashes and matchers are unaffected.`],
  }
}

export class FileReportWriter implements IReportWriter {
  async write(report: AuditorReport, reportDir: string): Promise<ReportArtefactPaths> {
    const passDir = resolve(reportDir, report.run.pass)
    const jsonPath = join(passDir, 'report.json')
    const htmlPath = join(passDir, 'report.html')

    let rendered = renderReportHtml(report)
    let effective = report

    // Both artefacts are rewritten from the reduced model, so the JSON and the
    // HTML never disagree about what was captured.
    if (Buffer.byteLength(rendered, 'utf8') > MAX_HTML_BYTES) {
      effective = withReducedExcerpts(report)
      rendered = renderReportHtml(effective)
    }

    await mkdir(passDir, { recursive: true })
    await writeFile(jsonPath, serialiseReport(effective), 'utf8')
    await writeFile(htmlPath, rendered, 'utf8')

    return { jsonPath, htmlPath }
  }

  async writeIndex(reportDir: string, written: readonly { pass: ReportPass; paths: ReportArtefactPaths }[]): Promise<string> {
    const indexPath = resolve(reportDir, 'index.html')

    const links = written
      .map(({ pass }) => {
        // `pass` is a closed union, but assert it rather than trusting the type
        // at a point that builds a URL — a widened type later must not silently
        // become a path injection.
        if (pass !== 'inventory' && pass !== 'detection') throw new Error(`Unknown report pass '${String(pass)}'`)

        // Relative to index.html, so the whole directory stays portable once it
        // is downloaded and unzipped from a CI artefact.
        return `      <li><a href="${pass}/report.html">${escapeHtml(pass)} report</a> (<a href="${pass}/report.json">JSON</a>)</li>`
      })
      .join('\n')

    const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'" />
    <title>Auditor reports</title>
    <style>
      body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 2rem auto; max-width: 44rem; padding: 0 1rem; }
      @media (prefers-color-scheme: dark) { body { background: #14171a; color: #e8ebee; } a { color: #8db4ea; } }
    </style>
  </head>
  <body>
    <h1>Auditor reports</h1>
    <p>PCI DSS 6.4.3 script inventory and 11.6.1 detection evidence. Reports from one run share a correlation id.</p>
    <ul>
${links}
    </ul>
  </body>
</html>
`

    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(indexPath, page, 'utf8')

    return indexPath
  }
}
