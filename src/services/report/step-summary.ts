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

import type { AuditorReport, ReportResourceRow } from '../../types/report.js'

/**
 * GitHub truncates the *entire* summary past 1 MiB, so a large report would
 * silently push out other steps' content. Budget well under that.
 */
const MAX_SUMMARY_BYTES = 64 * 1024

/** Beyond this, the artefact is the right place to look. */
const MAX_FINDING_ROWS = 50

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

function findingRows(report: AuditorReport): { row: ReportResourceRow; targetKey: string }[] {
  return report.targets.flatMap((target) => [...target.scripts, ...target.headers].filter((row) => row.status !== 'authorised').map((row) => ({ row, targetKey: target.targetKey })))
}

export function buildStepSummary(report: AuditorReport): string {
  const { run, summary } = report
  const findings = findingRows(report)
  const shown = findings.slice(0, MAX_FINDING_ROWS)

  const lines = [
    `## Auditor report — ${run.pass}`,
    '',
    `Inventory \`${run.inventoryRef.branch}\`${run.inventoryRef.commitSha === null ? '' : ` at \`${run.inventoryRef.commitSha.slice(0, 12)}\``} · run status **${run.status}** · ${summary.targets} target(s)`,
    '',
    '| Authorised | Unauthorised | Unknown | Missing required | Total |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${summary.authorised} | ${summary.unauthorised_content} | ${summary.unknown} | ${summary.missing_required} | ${summary.total} |`,
    '',
  ]

  if (run.targetFilter !== null) lines.push(`> **Partial census** — filtered to target \`${run.targetFilter}\`.`, '')
  if (run.status === 'partial') lines.push(`> **Partial run** — ${run.failures.length} target(s) failed.`, '')

  if (findings.length === 0) {
    lines.push('No findings: every observed script and header was authorised by the inventory.', '')
  } else {
    lines.push(`### Findings (${findings.length})`, '', '| Target | Status | Resource | Detail |', '| --- | --- | --- | --- |')

    for (const { row, targetKey } of shown) {
      lines.push(`| ${cell(targetKey)} | ${row.status} | ${cell(row.name)} | ${cell(row.authorisation.failureReason ?? row.origin.host ?? '')} |`)
    }

    if (findings.length > shown.length) lines.push('', `…and ${findings.length - shown.length} more — see the \`auditor-report\` artefact for the full census.`)

    lines.push('')
  }

  lines.push(`Full census: ${summary.total} resources across ${summary.targets} target(s) — download the \`auditor-report\` artefact.`, '')

  const markdown = lines.join('\n')

  return Buffer.byteLength(markdown, 'utf8') > MAX_SUMMARY_BYTES ? `${markdown.slice(0, MAX_SUMMARY_BYTES)}\n\n_(summary truncated — see the artefact)_\n` : markdown
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
