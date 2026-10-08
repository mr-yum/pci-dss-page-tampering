/**
 * Append a digest of the report to the GitHub Actions job summary.
 *
 * An artefact nobody opens is not evidence anyone acts on. This puts the
 * findings on the run page itself, so an on-call sees them without downloading
 * a zip.
 *
 * Every failure here is swallowed: a summary is a convenience, and must never
 * be the reason a detection run goes red.
 */

import { appendFile } from 'fs/promises'

import type { AuditorReport, ReportResourceRow, ReportUnansweredRequest, ReportUnreadScript } from '../../types/report.js'

/**
 * GitHub truncates the *entire* summary past 1 MiB, so a large report would
 * silently push out other steps' content. Budget well under that.
 */
const MAX_SUMMARY_BYTES = 64 * 1024

/** Beyond this, the artefact is the right place to look. */
const MAX_FINDING_ROWS = 50

/** `, frame detached at step N` (with the frame's URL) after the step a request was issued in; empty when its frame was not seen going away. */
function detachment(request: ReportUnansweredRequest): string {
  if (request.detachedAtStep === undefined) return ''
  return `, frame detached at step ${request.detachedAtStep}${request.detachedFrameUrl === undefined ? '' : ` ${cell(request.detachedFrameUrl)}`}`
}

/** Make a value safe for a markdown table cell. */
function cell(value: string): string {
  const singleLine = value.replace(/\r?\n/gu, ' ').trim()

  if (!singleLine.includes('`')) return `\`${singleLine.replace(/\|/gu, '\\|')}\``

  // Fence with a backtick run longer than any run inside the value, per
  // CommonMark, so embedded backticks cannot break out of the code span.
  const longestRun = Math.max(...[...singleLine.matchAll(/`+/gu)].map((match) => match[0].length))
  const fence = '`'.repeat(longestRun + 1)

  return `${fence} ${singleLine.replace(/\|/gu, '\\|')} ${fence}`
}

// Rows outside the payment page are evidence, not findings: the run never
// alerts on them, so the digest must not present them as if it had.
function findingRows(report: AuditorReport): { row: ReportResourceRow; targetKey: string }[] {
  return report.targets.flatMap((target) => [...target.scripts, ...target.headers].filter((row) => row.status !== 'authorised' && row.scope !== 'outside_payment').map((row) => ({ row, targetKey: target.targetKey })))
}

// Unread scripts in payment scope (or in an unscoped run) are a gap in the
// monitoring, listed like findings; outside ones are evidence and only counted.
function unreadScripts(report: AuditorReport, inPaymentScope: boolean): { script: ReportUnreadScript; targetKey: string }[] {
  return report.targets.flatMap((target) => target.unreadScripts.filter((script) => (script.scope !== 'outside_payment') === inPaymentScope).map((script) => ({ script, targetKey: target.targetKey })))
}

function outsidePaymentRowCount(report: AuditorReport): number {
  return report.targets.reduce((total, target) => total + [...target.scripts, ...target.headers].filter((row) => row.scope === 'outside_payment').length, 0)
}

export function buildStepSummary(report: AuditorReport): string {
  const { run, summary } = report
  const findings = findingRows(report)
  const shown = findings.slice(0, MAX_FINDING_ROWS)

  const lines = [
    `## Auditor report — ${run.pass}`,
    '',
    // Branch names and shas come from CLI arguments and git output — cell()
    // fences them so backticks or pipes cannot restructure the markdown.
    `Inventory ${cell(run.inventoryRef.branch)}${run.inventoryRef.commitSha === null ? '' : ` at ${cell(run.inventoryRef.commitSha.slice(0, 12))}`} · run status **${run.status}** · ${summary.targets} target(s)`,
    '',
    '| Authorised | Unauthorised | Unknown | Missing required | Total |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${summary.authorised} | ${summary.unauthorised_content} | ${summary.unknown} | ${summary.missing_required} | ${summary.total} |`,
    '',
  ]

  if (run.targetFilter !== null) lines.push(`> **Partial census** — filtered to target ${cell(run.targetFilter)}.`, '')
  const unread = unreadScripts(report, true)
  if (run.status === 'partial') {
    const reasons = [run.failures.length > 0 ? `${run.failures.length} target(s) failed` : null, unread.length > 0 ? `${unread.length} payment page script(s) could not be read` : null].filter((reason): reason is string => reason !== null)
    lines.push(`> **Partial run** — ${reasons.join('; ')}.`, '')
  }

  if (unread.length > 0) {
    lines.push(
      `### Scripts not read (${unread.length})`,
      '',
      'These scripts reached the payment page, but their body could not be read, so they were neither hashed nor compared.',
      '',
      '| Target | Script | Step | Page | Reason |',
      '| --- | --- | ---: | --- | --- |',
    )
    for (const { script, targetKey } of unread.slice(0, MAX_FINDING_ROWS)) {
      lines.push(`| ${cell(targetKey)} | ${cell(script.url)} | ${script.step} | ${cell(script.documentUrl ?? 'unattributed')} | ${cell(script.reason)} |`)
    }
    if (unread.length > MAX_FINDING_ROWS) lines.push('', `…and ${unread.length - MAX_FINDING_ROWS} more — see the \`auditor-report\` artefact.`)
    lines.push('')
  }

  if (findings.length === 0 && unread.length > 0) {
    // Unread scripts were observed but never judged: "everything was
    // authorised" would contradict the partial status above.
    lines.push('No findings among the scripts and headers that could be read — but the scripts listed above were not checked at all.', '')
  } else if (findings.length === 0) {
    lines.push(
      outsidePaymentRowCount(report) > 0
        ? 'No findings: every script and header on the payment page — and on every page after it — was authorised by the inventory.'
        : 'No findings: every observed script and header was authorised by the inventory.',
      '',
    )
  } else {
    lines.push(`### Findings (${findings.length})`, '', '| Target | Status | Resource | Detail |', '| --- | --- | --- | --- |')

    for (const { row, targetKey } of shown) {
      lines.push(`| ${cell(targetKey)} | ${row.status} | ${cell(row.name)} | ${cell(row.authorisation.failureReason ?? row.origin.host ?? '')} |`)
    }

    if (findings.length > shown.length) lines.push('', `…and ${findings.length - shown.length} more — see the \`auditor-report\` artefact for the full census.`)

    lines.push('')
  }

  const outside = outsidePaymentRowCount(report)
  if (outside > 0) {
    lines.push(`${outside} resource(s) were observed on pages loaded before the payment page. They are listed in the census as \`outside_payment\` and are not findings.`, '')
  }

  const unreadOutside = unreadScripts(report, false).length
  if (unreadOutside > 0) {
    lines.push(`${unreadOutside} script(s) on pages loaded before the payment page could not be read. They are listed under \`unreadScripts\` as \`outside_payment\` and do not make the run partial.`, '')
  }

  // Evidence, not findings — a script whose request was never answered never
  // ran — but a malformed URL or a dead host shows up nowhere else, so each
  // one is named.
  const unanswered = report.targets.flatMap((target) => target.unansweredRequests.map((request) => ({ request, targetKey: target.targetKey })))
  if (unanswered.length > 0) {
    lines.push(
      `### Script requests unanswered (${unanswered.length})`,
      '',
      'These script requests never received a response, so the scripts never ran on the page. Recorded for evidence; they do not make the run partial.',
      '',
      '| Target | Request | Step | Page | Scope | Reason |',
      '| --- | --- | ---: | --- | --- | --- |',
    )
    for (const { request, targetKey } of unanswered.slice(0, MAX_FINDING_ROWS)) {
      lines.push(
        `| ${cell(targetKey)} | ${cell(request.url)} | ${request.step}${detachment(request)} | ${cell(request.documentUrl ?? 'unattributed')} | ${request.scope === 'outside_payment' ? 'outside payment page' : 'payment page'} | ${cell(request.reason)} |`,
      )
    }
    if (unanswered.length > MAX_FINDING_ROWS) lines.push('', `…and ${unanswered.length - MAX_FINDING_ROWS} more — see the \`auditor-report\` artefact.`)
    lines.push('')
  }

  lines.push(`Full census: ${summary.total} resources across ${summary.targets} target(s) — download the \`auditor-report\` artefact.`, '')

  const markdown = lines.join('\n')

  if (Buffer.byteLength(markdown, 'utf8') <= MAX_SUMMARY_BYTES) return markdown

  // Truncate in BYTES, matching how the cap is measured: slicing by UTF-16
  // code units would overshoot on multibyte content. A codepoint split at the
  // boundary decodes to replacement characters; strip them.
  const clipped = Buffer.from(markdown, 'utf8')
    .subarray(0, MAX_SUMMARY_BYTES)
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')

  return `${clipped}\n\n_(summary truncated — see the artefact)_\n`
}

/**
 * Append the digest when running under GitHub Actions.
 *
 * Appends rather than writes: other steps share the same file.
 */
export async function writeStepSummary(report: AuditorReport, log: (message: string) => void): Promise<void> {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']

  if (summaryPath === undefined || summaryPath === '') return

  try {
    await appendFile(summaryPath, `${buildStepSummary(report)}\n`, 'utf8')
  } catch (error) {
    log(`Could not write the GitHub step summary: ${error instanceof Error ? error.message : String(error)}`)
  }
}
