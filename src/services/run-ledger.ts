import type { IAlertService } from '../interfaces/alert.js'
import type { ExecutionMode } from '../types/config.js'
import { type AlertDeliveryFailure, type AuditorReportLocation, type ExecutionPass, type ExecutionSummary, type FailedTarget, unreadInPaymentScope, type UnreadScriptEntry } from '../types/execution-summary.js'
import type { InventoryAlert } from '../types/inventory/model.js'
import type { UnreadScriptRecord } from '../types/script.js'
import { redactForDisplay } from './report/mapper.js'

export type RunLedgerFinishInput = {
  alertService: IAlertService
  alertDestinations: InventoryAlert | null
  mode: ExecutionMode
  repositoryUrl: string
  inventoryBranch: string | null
  detectionBranch: string | null
  executionStartTime: number
  auditorReport: AuditorReportLocation | null
}

/**
 * Thrown by {@link RunLedger.finish} once the run summary has gone out, so the
 * process exits non-zero for a run that left any target unmonitored, any
 * payment-page script unread, or any finding unannounced.
 */
export class RunFailuresError extends Error {
  constructor(
    readonly failed: readonly FailedTarget[],
    readonly undelivered: readonly AlertDeliveryFailure[],
    /** Unread scripts in payment scope only: the ones that fail the run. */
    readonly unread: readonly UnreadScriptEntry[] = [],
  ) {
    const parts: string[] = []
    if (failed.length > 0) parts.push(`${failed.length} target run(s) failed: ${failed.map((target) => `${target.name} (${target.pass})`).join(', ')}`)
    if (unread.length > 0) parts.push(`${unread.length} payment page script(s) could not be read: ${unread.map((script) => `${script.url} on ${script.target} (${script.pass})`).join(', ')}`)
    if (undelivered.length > 0) parts.push(`${undelivered.length} alert(s) could not be delivered: ${undelivered.map((failure) => `${failure.alert}${failure.target === null ? '' : ` for ${failure.target}`}`).join(', ')}`)
    super(`${parts.join('; ')}. The remaining targets were processed; see the run summary and the auditor report.`)
    this.name = 'RunFailuresError'
  }
}

/**
 * The run's own account of itself: which targets completed, which did not and
 * why, and how much was observed.
 *
 * One target's workflow failing is recorded here and the run moves on, so the
 * other variations, the inventory push and the detection pass still happen.
 * At the end, {@link finish} sends the summary *before* failing the process:
 * the summary is the only place a reader learns which payment page went
 * unmonitored (per-finding alerts speak only for pages that were observed),
 * so it must go out even when the exit code is about to be non-zero.
 */
export class RunLedger {
  private readonly processed: string[] = []
  private readonly failed: FailedTarget[] = []
  private readonly undelivered: AlertDeliveryFailure[] = []
  private readonly unread: UnreadScriptEntry[] = []
  private resourceCount = 0

  constructor(private readonly log: (message: string) => void) {}

  get targetsProcessed(): readonly string[] {
    return this.processed
  }

  get targetsFailed(): readonly FailedTarget[] {
    return this.failed
  }

  get alertsUndelivered(): readonly AlertDeliveryFailure[] {
    return this.undelivered
  }

  get scriptsUnread(): readonly UnreadScriptEntry[] {
    return this.unread
  }

  get totalResourceCount(): number {
    return this.resourceCount
  }

  recordSuccess(name: string, resourceCount: number): void {
    if (!this.processed.includes(name)) this.processed.push(name)
    this.resourceCount += resourceCount
  }

  /**
   * Record a target the pass could not complete.
   *
   * The reason travels with the name, redacted the same way the auditor report
   * redacts it: Git and network errors routinely echo the authenticated remote,
   * and this string is headed for Slack.
   */
  recordFailure(name: string, pass: ExecutionPass, error: unknown): FailedTarget {
    const reason = redactForDisplay(error instanceof Error ? error.message : String(error)).text
    const failure: FailedTarget = { name, pass, reason }
    this.failed.push(failure)
    this.log(`Target '${name}' failed during the ${pass} pass; continuing with the remaining targets. Reason: ${reason}`)
    return failure
  }

  /**
   * Record the scripts a target run received but could not read.
   *
   * Those in payment scope fail the run exactly as a failed target does: the
   * target completed, but part of its payment page went unexamined. Those on
   * an earlier page the payment page replaced are named in the summary as
   * evidence and do not affect the exit code. The records arrive redacted
   * (see `toUnreadScriptRecords`).
   */
  recordUnreadScripts(target: string, pass: ExecutionPass, scripts: { payment: readonly UnreadScriptRecord[]; outside: readonly UnreadScriptRecord[] }): void {
    for (const [records, outsidePaymentPage] of [
      [scripts.payment, false],
      [scripts.outside, true],
    ] as const) {
      for (const record of records) {
        this.unread.push({ ...record, target, pass, outsidePaymentPage })
        this.log(
          `Script ${record.url} on target '${target}' (${pass} pass, step ${record.step}) could not be read and was not compared${outsidePaymentPage ? ' — outside the payment page, recorded for evidence only' : '; the run will be marked partial'}. Reason: ${record.reason}`,
        )
      }
    }
  }

  /**
   * Record alerts that were produced but never arrived.
   *
   * Idempotent per failure object, so the alert service's running list can be
   * handed over as many times as convenient without double counting.
   */
  recordUndeliveredAlerts(failures: readonly AlertDeliveryFailure[]): void {
    for (const failure of failures) {
      if (this.undelivered.includes(failure)) continue
      this.undelivered.push(failure)
      this.log(`Alert could not be delivered (${failure.alert}${failure.target === null ? '' : ` for ${failure.target}`}): ${failure.reason}`)
    }
  }

  buildSummary(input: Omit<RunLedgerFinishInput, 'alertService' | 'alertDestinations'>): ExecutionSummary {
    return {
      mode: input.mode,
      targetsProcessed: [...this.processed],
      targetsFailed: [...this.failed],
      alertsUndelivered: [...this.undelivered],
      scriptsUnread: [...this.unread],
      repositoryUrl: input.repositoryUrl,
      inventoryBranch: input.inventoryBranch,
      detectionBranch: input.detectionBranch,
      resourceCount: this.resourceCount,
      completedAt: new Date(),
      executionDuration: Date.now() - input.executionStartTime,
      auditorReport: input.auditorReport,
    }
  }

  /**
   * Send the run summary, then throw {@link RunFailuresError} if any target
   * did not complete, any script in payment scope could not be read, or any
   * alert was not delivered.
   *
   * The alert service's own delivery failures are folded in first, so the
   * summary that goes out already names them. The summary send itself is
   * accounted for the same way: if it fails, or the service records it as
   * undelivered, the run exits non-zero, because silence is the one outcome
   * an operator cannot distinguish from a quiet run. A run that attempted
   * nothing sends nothing.
   */
  async finish(input: RunLedgerFinishInput): Promise<void> {
    this.recordUndeliveredAlerts(input.alertService.getDeliveryFailures())

    if (this.processed.length === 0 && this.failed.length === 0) {
      this.log('No targets attempted, skipping the run summary.')
    } else if (input.alertDestinations === null) {
      this.log('No alert destinations available, skipping the run summary.')
    } else {
      try {
        await input.alertService.alertOnRunCompletion(this.buildSummary(input), input.alertDestinations)
      } catch (error) {
        console.error('[Main]: Failed to send the run summary notification:', error)
        this.recordUndeliveredAlerts([{ alert: 'run summary', target: null, reason: error instanceof Error ? error.message : String(error) }])
      }
      // The service catches its own send errors; pick up anything it recorded
      // while sending the summary.
      this.recordUndeliveredAlerts(input.alertService.getDeliveryFailures())
    }

    const unreadInScope = unreadInPaymentScope(this.unread)
    if (this.failed.length > 0 || this.undelivered.length > 0 || unreadInScope.length > 0) throw new RunFailuresError(this.failed, this.undelivered, unreadInScope)
  }
}
