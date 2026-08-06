/**
 * Auditor report: a full census of every script and header observed in a run,
 * mapped to the inventory matcher that authorised it.
 *
 * @see ../../types/report.ts for the document model
 * @see ../../interfaces/report.ts for the collector and writer contracts
 */

export { NoopReportCollector, ReportCollector } from './collector.js'
export { renderReportHtml } from './html/template.js'
export { serialiseReport, serialiseReportForComparison } from './json.js'
export { buildRowId, CONTENT_EXCERPT_LIMIT, sanitiseForDisplay, toObservedContent, toReportRow } from './mapper.js'
export { toReportMatcherRef } from './matcher-ref.js'
export { buildStepSummary, writeStepSummary } from './step-summary.js'
export { FileReportWriter } from './writer.js'
