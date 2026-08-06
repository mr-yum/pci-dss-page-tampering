/**
 * Auditor report collection and output.
 *
 * Kept separate from `IAlertService` on purpose. Alerting is called twice per
 * target with a partial view, fires *after* the inventory diff has run, and
 * deliberately drops authorised results — while the report needs one call with
 * the whole picture, taken against the baseline as it was compared, including
 * every compliant row. Wrapping the alert path would also put a reporting bug
 * in front of a hard compliance path.
 *
 * @see ../services/report/collector.ts
 */

import type { ComparisonResultType } from '../types/comparison.js'
import type { Inventory } from '../types/inventory/model.js'
import type { AuditorReport, ReportPass, ReportRunMetadata } from '../types/report.js'
import type { Target } from '../types/target.js'

/** Run-level facts the collector cannot know for itself. */
export type ReportRunContext = Omit<ReportRunMetadata, 'pass' | 'status' | 'failures'>

export type ReportInventoryRefInput = {
  branch: string
  commitSha: string | null
  commitIsoDate: string | null
  repositoryUrl: string
}

export interface IReportCollector {
  /**
   * Record every comparison result observed for one target run.
   *
   * Called once per target, before any inventory mutation, so the report
   * reflects the baseline the comparison actually ran against.
   */
  recordTargetRun(input: { inventory: Inventory; target: Target; comparisonResults: readonly ComparisonResultType[] }): void

  /** Record a target that threw, so the census shows the gap rather than hiding it. */
  recordTargetFailure(input: { inventory: Inventory; target: Target; error: unknown }): void

  /** Note which inventory revision a pass compared against. */
  recordInventoryRef(pass: ReportPass, ref: ReportInventoryRefInput): void

  /** Build the document for one pass, or null when the pass recorded nothing. */
  build(pass: ReportPass, run: ReportRunContext): AuditorReport | null
}

export type ReportArtefactPaths = { jsonPath: string; htmlPath: string }

export interface IReportWriter {
  write(report: AuditorReport, reportDir: string): Promise<ReportArtefactPaths>
  /** Write the landing page linking every document produced by this invocation. */
  writeIndex(reportDir: string, written: readonly { pass: ReportPass; paths: ReportArtefactPaths }[]): Promise<string>
}
