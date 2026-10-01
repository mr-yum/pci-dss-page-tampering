import type { IHeaderComparisonService, IScriptComparisonService } from '../interfaces/comparison.js'
import type { TargetRunRecord } from '../interfaces/report.js'
import type { ComparisonResultType } from '../types/comparison.js'
import type { DetectionSummary } from '../types/detection.js'
import type { PaymentScope } from '../types/document.js'
import type { Inventory } from '../types/inventory/model.js'
import type { Target } from '../types/target.js'
import { compareOutsidePayment } from './outside-payment.js'
import { partitionByPaymentScope } from './payment-scope.js'

export type ScopedComparison = {
  /** What the run alerts on and feeds to the inventory diff. The whole run when not scoped. */
  payment: { scripts: ComparisonResultType[]; headers: ComparisonResultType[] }
  /** Report-only results for pages loaded before the payment page. Null when the run is not scoped. */
  outside: ComparisonResultType[] | null
}

/**
 * Compare one target run against its inventory, scoped to the payment page.
 *
 * The single place that decides what can raise an alert: only `payment`
 * results may reach alerting or the inventory diff. The outside part is
 * compared for the auditor report alone. For a workflow without a
 * `paymentPage` marker this is exactly the comparison it always had — capture
 * now keeps one copy of a script per document, and the partition collapses
 * them so each script is still compared, and alerted on, once.
 */
export async function compareWithPaymentScope(detection: DetectionSummary, inventory: Inventory, services: { scripts: IScriptComparisonService; headers: IHeaderComparisonService }): Promise<ScopedComparison> {
  const { payment, outsidePayment } = partitionByPaymentScope(detection)
  const scripts = await services.scripts.compare(payment.target, inventory, payment.scriptSummary)
  const headers = await services.headers.compare(payment.target, inventory, payment.headerSummary)
  const outside = outsidePayment === null ? null : await compareOutsidePayment(outsidePayment, inventory, services)
  return { payment: { scripts, headers }, outside }
}

/**
 * What a target run records in the auditor report.
 *
 * - The page chain (`paymentScope`) is recorded whenever a payment page is
 *   declared, so a marker that failed to resolve shows in the report as
 *   `resolved: false` instead of looking like an unmarked workflow.
 * - Rows are labelled `payment` / `outside_payment` only when the run was
 *   actually scoped; an unresolved or unmarked run records one unlabelled set.
 */
export function reportRecordsFor(input: { inventory: Inventory; target: Target; scoped: ScopedComparison; paymentScope: PaymentScope | undefined }): TargetRunRecord[] {
  const { inventory, target, scoped, paymentScope } = input
  const records: TargetRunRecord[] = [
    {
      inventory,
      target,
      comparisonResults: [...scoped.payment.scripts, ...scoped.payment.headers],
      ...(paymentScope?.declared === true ? { paymentScope } : {}),
      ...(scoped.outside === null ? {} : { scope: 'payment' as const }),
    },
  ]
  if (scoped.outside !== null) records.push({ inventory, target, comparisonResults: scoped.outside, scope: 'outside_payment' })
  return records
}
