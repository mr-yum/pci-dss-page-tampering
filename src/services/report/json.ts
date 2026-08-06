/**
 * Canonical serialisation of the auditor report.
 *
 * The JSON document is the artefact other tooling reads and that operators
 * `diff` between runs, so it is written with stable key order (insertion order,
 * which `JSON.stringify` preserves), two-space indentation and a trailing
 * newline.
 *
 * @see ../../types/report.ts
 */

import type { AuditorReport } from '../../types/report.js'

export function serialiseReport(report: AuditorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

/**
 * The report with everything inherently volatile removed.
 *
 * Two runs against an unchanged site and an unchanged inventory must produce
 * identical output here. Exposed so that property can be asserted in tests, and
 * so operators can diff two runs without wading through timestamps.
 */
export function serialiseReportForComparison(report: AuditorReport): string {
  const { run, generator, ...stable } = report

  void run
  void generator

  return `${JSON.stringify(stable, null, 2)}\n`
}
