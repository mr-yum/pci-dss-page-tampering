import type { IAlertService } from '../interfaces/alert.js'
import type { ExecutionMode } from '../types/config.js'
import type { AuditorReportLocation, ExecutionPass, ExecutionSummary, FailedTarget } from '../types/execution-summary.js'
import type { InventoryAlert } from '../types/inventory/model.js'
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
 * process exits non-zero for a run that left any target unmonitored.
 */
export class TargetRunFailuresError extends Error {
  constructor(readonly failed: readonly FailedTarget[]) {
    super(`${failed.length} target run(s) failed: ${failed.map((target) => `${target.name} (${target.pass})`).join(', ')}. The remaining targets were processed; see the run summary and the auditor report.`)
    this.name = 'TargetRunFailuresError'
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
  private resourceCount = 0

  constructor(private readonly log: (message: string) => void) {}

  get targetsProcessed(): readonly string[] {
    return this.processed
  }

  get targetsFailed(): readonly FailedTarget[] {
    return this.failed
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

  buildSummary(input: Omit<RunLedgerFinishInput, 'alertService' | 'alertDestinations'>): ExecutionSummary {
    return {
      mode: input.mode,
      targetsProcessed: [...this.processed],
      targetsFailed: [...this.failed],
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
   * Send the run summary, then throw {@link TargetRunFailuresError} if any
   * target did not complete.
   *
   * Notification failures are logged and never mask the run's own outcome
   * (FR-009); a run that attempted nothing sends nothing.
   */
  async finish(input: RunLedgerFinishInput): Promise<void> {
    if (this.processed.length === 0 && this.failed.length === 0) {
      this.log('No targets attempted, skipping the run summary.')
    } else if (input.alertDestinations === null) {
      this.log('No alert destinations available, skipping the run summary.')
    } else {
      try {
        await input.alertService.alertOnRunCompletion(this.buildSummary(input), input.alertDestinations)
      } catch (error) {
        console.error('[Main]: Failed to send the run summary notification:', error)
      }
    }

    if (this.failed.length > 0) throw new TargetRunFailuresError(this.failed)
  }
}
