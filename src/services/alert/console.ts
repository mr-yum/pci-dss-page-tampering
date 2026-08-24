import type { IAlertService, PullRequestFailureContext } from '../../interfaces/alert.js'
import type { RumAlertCategory, RumAlertContext } from '../../types/alert.js'
import { AlertType } from '../../types/alert.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import type { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found.js'
import type { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found.js'
import type { MissingRequiredHeader } from '../../types/comparison/missing-required-header.js'
import type { MissingRequiredScript } from '../../types/comparison/missing-required-script.js'
import type { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import type { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import { ExecutionMode } from '../../types/config.js'
import type { ExecutionSummary } from '../../types/execution-summary.js'
import type { InventoryAlert } from '../../types/inventory/model.js'
import type { Target } from '../../types/target.js'
import { extractHost, redactUrl } from '../../utils/url.js'
import { resolveRumAlertDestination, rumAlertContextLines, rumAlertTitle } from './rum.js'

/**
 * T042: Console-based alert service for local development and testing.
 * Logs alerts to stdout instead of sending to Slack.
 *
 * Usage:
 * - When --slack-token is omitted, this service logs alerts to console
 * - Useful for local development, testing, and CI/CD debugging
 *
 * @implements IAlertService
 */
export class ConsoleAlertService implements IAlertService {
  private readonly maxContentLength = 100

  /**
   * Process typed comparison results and log alerts to console.
   * Implements the same grouping logic as SlackAlertService for consistency.
   */
  async alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, _alertDestinations: InventoryAlert, inventoryUpdatedResults?: ReadonlySet<ComparisonResultType>): Promise<void> {
    // Group results by type for batch processing
    const unknownScripts = comparisonResults.filter((r): r is UnknownScriptFound => r.type === 'unknown_script_found')
    const unauthorizedScripts = comparisonResults.filter((r): r is KnownScriptWithUnauthorisedContentFound => r.type === 'known_script_unauthorised_content')
    const unknownHeaders = comparisonResults.filter((r): r is UnknownHeaderFound => r.type === 'unknown_header_found')
    const unauthorizedHeaders = comparisonResults.filter((r): r is KnownHeaderWithUnauthorisedContentFound => r.type === 'known_header_unauthorised_content')
    const missingHeaders = comparisonResults.filter((r): r is MissingRequiredHeader => r.type === 'missing_required_header')
    const missingScripts = comparisonResults.filter((r): r is MissingRequiredScript => r.type === 'missing_required_script')

    // Log unknown scripts
    if (unknownScripts.length > 0) {
      this.logUnknownScripts(unknownScripts, target)
    }

    // Log unauthorized scripts — split by whether the inventory diff actually
    // applied the change so the user-visible label matches reality.
    if (unauthorizedScripts.length > 0) {
      this.logUnauthorizedScripts(unauthorizedScripts, target, inventoryUpdatedResults)
    }

    // Log unknown headers
    if (unknownHeaders.length > 0) {
      this.logUnknownHeaders(unknownHeaders, target)
    }

    // Log unauthorized headers — same applied/skipped split as scripts.
    if (unauthorizedHeaders.length > 0) {
      this.logUnauthorizedHeaders(unauthorizedHeaders, target, inventoryUpdatedResults)
    }

    if (missingHeaders.length > 0) {
      this.logMissingHeaders(missingHeaders, target)
    }

    // Required scripts absent from the page (e.g. a pinned monitoring agent removed).
    if (missingScripts.length > 0) {
      this.logMissingScripts(missingScripts, target)
    }

    // AuthorizedScriptFound and AuthorizedHeaderFound are no-ops (no alert needed)
  }

  /**
   * Log one real-user monitoring alert (feature 011) to the console.
   * The destination is still resolved so a misconfigured category fails as
   * loudly here as it would with Slack delivery enabled.
   */
  async alertForRumObservation(category: RumAlertCategory, context: RumAlertContext, alertDestinations: InventoryAlert): Promise<void> {
    const destination = resolveRumAlertDestination(alertDestinations, category)

    this.log(AlertType.Rum, rumAlertTitle(category))
    console.log(`  Destination: ${destination.destination}`)
    for (const line of rumAlertContextLines(category, context)) {
      console.log(`  ${line.label}: ${line.value}`)
    }
    console.log()
  }

  private logUnknownScripts(scripts: UnknownScriptFound[], target: Target): void {
    this.log(AlertType.Script, `Unknown scripts detected for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${scripts.length}`)
    console.log('  Scripts:')

    scripts.forEach((result, index) => {
      const identifier = result.script.name
      const hash = result.script.hash.value
      console.log(`    ${index + 1}. ${this.truncate(identifier)}`)
      console.log(`       Hash: ${this.truncate(hash)}`)
      console.log(`       From host: ${extractHost(result.script.url)} (url: ${result.script.url || '(unknown)'})`)
    })
    console.log()
  }

  private logUnauthorizedScripts(scripts: KnownScriptWithUnauthorisedContentFound[], target: Target, inventoryUpdatedResults?: ReadonlySet<ComparisonResultType>): void {
    this.log(AlertType.Script, `Script authorization failed for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${scripts.length}`)
    console.log('  Scripts:')

    scripts.forEach((result, index) => {
      const identifier = result.script.name
      const hash = result.script.hash.value
      const matcherType = result.authorizationMatcher.getType()
      const reason = result.failureReason
      const outcome = target.type === 'inventory' && inventoryUpdatedResults ? (inventoryUpdatedResults.has(result) ? 'inventory auto-updated' : 'manual review required (inventory unchanged)') : null
      console.log(`    ${index + 1}. ${this.truncate(identifier)}`)
      console.log(`       Hash: ${this.truncate(hash)}`)
      console.log(`       From host: ${extractHost(result.script.url)} (url: ${result.script.url || '(unknown)'})`)
      console.log(`       Failed Matcher: ${matcherType}`)
      console.log(`       Reason: ${reason}`)
      if (outcome !== null) {
        console.log(`       Outcome: ${outcome}`)
      }
    })
    console.log()
  }

  private logUnknownHeaders(headers: UnknownHeaderFound[], target: Target): void {
    this.log(AlertType.Header, `Unknown headers detected for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${headers.length}`)
    console.log('  Headers:')

    headers.forEach((result, index) => {
      console.log(`    ${index + 1}. ${result.header.name}`)
      console.log(`       Value: ${this.truncate(result.header.value)}`)
      console.log(`       From host: ${extractHost(result.header.url)} (url: ${redactUrl(result.header.url)})`)
    })
    console.log()
  }

  private logUnauthorizedHeaders(headers: KnownHeaderWithUnauthorisedContentFound[], target: Target, inventoryUpdatedResults?: ReadonlySet<ComparisonResultType>): void {
    this.log(AlertType.Header, `Header authorization failed for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${headers.length}`)
    console.log('  Headers:')

    headers.forEach((result, index) => {
      const matcherType = result.authorizationMatcher.getType()
      const reason = result.failureReason
      const outcome = target.type === 'inventory' && inventoryUpdatedResults ? (inventoryUpdatedResults.has(result) ? 'inventory auto-updated' : 'manual review required (inventory unchanged)') : null
      console.log(`    ${index + 1}. ${result.header.name}`)
      console.log(`       Value: ${this.truncate(result.header.value)}`)
      console.log(`       From host: ${extractHost(result.header.url)} (url: ${redactUrl(result.header.url)})`)
      console.log(`       Failed Matcher: ${matcherType}`)
      console.log(`       Reason: ${reason}`)
      if (outcome !== null) {
        console.log(`       Outcome: ${outcome}`)
      }
    })
    console.log()
  }

  private logMissingHeaders(headers: MissingRequiredHeader[], target: Target): void {
    this.log(AlertType.Header, `Required headers missing for target: ${target.url}`)
    for (const [index, result] of headers.entries()) {
      console.log(`    ${index + 1}. ${result.headerName}`)
      console.log(`       Response: ${redactUrl(result.url)}`)
      console.log(`       Resource Type: ${result.resourceType}`)
    }
    console.log()
  }

  private logMissingScripts(scripts: MissingRequiredScript[], target: Target): void {
    this.log(AlertType.Script, `Required scripts missing for target: ${target.url}`)
    for (const [index, result] of scripts.entries()) {
      console.log(`    ${index + 1}. ${result.scriptDescription}`)
      console.log(`       Required On: ${(result.inventoryEntry.requiredOn ?? []).join(', ')}`)
      console.log(`       Justification: ${result.inventoryEntry.authoriseWith.authorisationInfo.description}`)
    }
    console.log()
  }

  private log(alertType: AlertType, message: string): void {
    console.log(`[Console Alert -> ${alertType}]: ${message}`)
  }

  private truncate(text: string): string {
    if (text.length <= this.maxContentLength) {
      return text
    }
    return text.slice(0, this.maxContentLength - 3) + '...'
  }

  /**
   * Alert for successful workflow execution.
   * Logs structured text to console with execution details.
   * Parallel implementation to SlackAlertService for local testing.
   */
  async alertOnSuccess(summary: ExecutionSummary, _alertDestinations: InventoryAlert): Promise<void> {
    console.log(`[Console Alert -> Success]: Workflow execution completed successfully`)
    console.log(`  Mode: ${summary.mode}`)

    // Format target list (truncate if > 5)
    const targetDisplay = this.formatTargetList(summary.targetsProcessed)
    console.log(`  Targets Processed: ${targetDisplay}`)

    console.log(`  Repository: ${summary.repositoryUrl}`)

    // Format branch display based on mode
    const branchDisplay = this.formatBranchDisplay(summary)
    console.log(`  Branch${summary.mode === ExecutionMode.All ? 'es' : ''}: ${branchDisplay}`)

    // Format resource count with edge case warning
    const resourceDisplay = this.formatResourceCount(summary.resourceCount)
    console.log(`  Resources Monitored: ${resourceDisplay}`)

    console.log(`  Completed At: ${summary.completedAt.toISOString()}`)

    // Optional: execution duration (P3 enhancement)
    if (summary.executionDuration !== undefined && summary.executionDuration !== null) {
      console.log(`  Execution Duration: ${this.formatDuration(summary.executionDuration)}`)
    }

    if (summary.auditorReport) {
      const { runUrl, htmlPaths } = summary.auditorReport
      console.log(`  Auditor Report: ${runUrl ?? htmlPaths.join(', ')}`)
    }
    console.log()
  }

  /**
   * Format target list for display.
   * Shows first 3 targets + "and N more" if > 5 targets.
   */
  private formatTargetList(targets: string[]): string {
    if (targets.length <= 5) {
      return targets.join(', ')
    }
    const firstThree = targets.slice(0, 3)
    const remaining = targets.length - 3
    return `${firstThree.join(', ')}, and ${remaining} more`
  }

  /**
   * Format branch display based on execution mode.
   */
  private formatBranchDisplay(summary: ExecutionSummary): string {
    switch (summary.mode) {
      case ExecutionMode.Inventory:
      case ExecutionMode.Validate:
        return summary.inventoryBranch ?? 'unknown'
      case ExecutionMode.Detection:
        return summary.detectionBranch ?? 'unknown'
      // rum-compare reads both branches (detection targets from the detection
      // branch, inventory targets from the inventory branch), so both are shown.
      case ExecutionMode.All:
      case ExecutionMode.RumCompare:
        return `${summary.inventoryBranch ?? 'unknown'} (inventory), ${summary.detectionBranch ?? 'unknown'} (detection)`
    }
  }

  /**
   * Format resource count with edge case warning for zero resources.
   */
  private formatResourceCount(count: number): string {
    if (count === 0) {
      return '0 scripts and headers (This may warrant investigation)'
    }
    return `${count} scripts and headers`
  }

  setReviewUrl(_url: string | null): void {
    // Console alerts don't include a review URL/button — no-op.
  }

  async alertOnPullRequestFailure(context: PullRequestFailureContext, _alertDestinations: InventoryAlert): Promise<void> {
    const errorMessage = context.error instanceof Error ? context.error.message : String(context.error)
    console.error(`[Console Alert -> PR Failure]: Inventory push succeeded but PR creation failed`)
    console.error(`  Repository: ${context.repoUrl}`)
    console.error(`  Head Branch: ${context.headBranch}`)
    console.error(`  Base Branch: ${context.baseBranch}`)
    console.error(`  Error: ${errorMessage}`)
    console.error(`  Action: Open the PR manually in GitHub so CI validation can run.`)
  }

  /**
   * Format duration in human-readable format.
   */
  private formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`
    }
    const seconds = Math.floor(milliseconds / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
}
