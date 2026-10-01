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
import type { PaymentScope } from '../types/document.js'
import type { Inventory } from '../types/inventory/model.js'
import type { AuditorReport, ReportPass, ReportRunMetadata, ReportScope } from '../types/report.js'
import type { Target } from '../types/target.js'

/** Run-level facts the collector cannot know for itself. */
export type ReportRunContext = Omit<ReportRunMetadata, 'pass' | 'status' | 'failures' | 'inventorySources'>

export type ReportInventoryRefInput = {
  branch: string
  commitSha: string | null
  commitIsoDate: string | null
  repositoryUrl: string
}

/** One target run's results, as handed to the report. */
export type TargetRunRecord = {
  inventory: Inventory
  target: Target
  comparisonResults: readonly ComparisonResultType[]
  /**
   * Set when the workflow marks a payment page: which side of it these results
   * are. A scoped run is recorded in two calls, one per scope. Omitted when the
   * whole run is in scope, which leaves the rows exactly as before.
   */
  scope?: ReportScope
  /** The run's document chain; recorded once per target when scoped. */
  paymentScope?: PaymentScope
}

export interface IReportCollector {
  /**
   * Record every comparison result observed for one target run.
   *
   * Called once per target, before any inventory mutation, so the report
   * reflects the baseline the comparison actually ran against.
   */
  recordTargetRun(input: TargetRunRecord): void

  /** Record a target that threw, so the census shows the gap rather than hiding it. */
  recordTargetFailure(input: { inventory: Inventory; target: Target; error: unknown }): void

  /** Note which inventory revision a pass compared against. */
  recordInventoryRef(pass: ReportPass, ref: ReportInventoryRefInput): void

  /** Build the document for one pass, or null when the pass recorded nothing. */
  build(pass: ReportPass, run: ReportRunContext): AuditorReport | null

  /**
   * The inventory files this pass read, with their exact bytes.
   *
   * Kept off the report document deliberately — embedding whole inventories in
   * the JSON would multiply its size for data better shipped as files.
   */
  getInventoryFiles(pass: ReportPass): InventoryFileCopy[]
}

export type ReportArtefactPaths = { jsonPath: string; htmlPath: string }

/** An inventory file to ship beside the report, with the exact bytes read. */
export type InventoryFileCopy = { file: string; text: string }

export interface IReportWriter {
  /**
   * `inventoryFiles` is required, and must describe exactly the files the
   * report's `run.inventorySources` cites: the document and its copies are two
   * halves of one artefact, and an optional argument here would let a caller
   * ship a report linking evidence that was never written.
   */
  write(report: AuditorReport, reportDir: string, inventoryFiles: readonly InventoryFileCopy[]): Promise<ReportArtefactPaths>
  /** Write the landing page linking every document produced by this invocation. */
  writeIndex(reportDir: string, written: readonly { pass: ReportPass; paths: ReportArtefactPaths }[]): Promise<string>
}
