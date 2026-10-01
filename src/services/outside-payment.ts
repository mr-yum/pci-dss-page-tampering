import type { IHeaderComparisonService, IScriptComparisonService } from '../interfaces/comparison.js'
import type { ComparisonResultType } from '../types/comparison.js'
import type { DetectionSummary } from '../types/detection.js'
import type { Inventory } from '../types/inventory/model.js'
import type { Target } from '../types/target.js'

const PREFIX = '[outside payment page]'

/**
 * Compare what a run observed outside the payment page, for the auditor report
 * only. These results are never alerted on and never reach the inventory diff.
 *
 * - **Presence checks are skipped.** Whether a script or header is *required*
 *   is a property of the payment page; judging it against an earlier page
 *   would report the monitoring agent "missing" from a page it was never
 *   meant to be on.
 * - **Every log line is prefixed**, so `run.log` never shows an earlier page's
 *   tag manager as a bare "not identified in inventory" that reads like a
 *   payment-page finding.
 * - **It never throws.** It runs on the path that sends the target's alerts,
 *   and evidence collection must never cost an alert; a failure is logged and
 *   the report simply lacks the outside rows.
 */
export async function compareOutsidePayment(outside: DetectionSummary, inventory: Inventory, services: { scripts: IScriptComparisonService; headers: IHeaderComparisonService }): Promise<ComparisonResultType[]> {
  const target: Target = { ...outside.target, logger: prefixed(outside.target.logger) }
  try {
    const scripts = await services.scripts.compare(target, inventory, outside.scriptSummary)
    const headers = await services.headers.compare(target, inventory, { ...outside.headerSummary, responses: [] })
    return [...scripts, ...headers].filter((result) => result.type !== 'missing_required_script' && result.type !== 'missing_required_header')
  } catch (error) {
    outside.target.logger.error(`${PREFIX} Comparison failed; the auditor report will not list resources observed outside the payment page:`, error)
    return []
  }
}

function prefixed(logger: Target['logger']): Target['logger'] {
  return {
    log: (message, ...args) => logger.log(`${PREFIX} ${message}`, ...args),
    error: (message, ...args) => logger.error(`${PREFIX} ${message}`, ...args),
    warn: (message, ...args) => logger.warn(`${PREFIX} ${message}`, ...args),
    debug: (message, ...args) => logger.debug(`${PREFIX} ${message}`, ...args),
  }
}
