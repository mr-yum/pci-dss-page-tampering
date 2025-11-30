import type { IAlertService } from '../../interfaces/alert'
import { AlertType } from '../../types/alert'
import type { ComparisonResultType } from '../../types/comparison'
import type { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found'
import type { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found'
import type { UnknownHeaderFound } from '../../types/comparison/unknown-header-found'
import type { UnknownScriptFound } from '../../types/comparison/unknown-script-found'
import type { InventoryAlert } from '../../types/inventory/model'
import type { Target } from '../../types/target'

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
  async alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, _alertDestinations: InventoryAlert): Promise<void> {
    // Group results by type for batch processing
    const unknownScripts = comparisonResults.filter((r): r is UnknownScriptFound => r.type === 'unknown_script_found')
    const unauthorizedScripts = comparisonResults.filter((r): r is KnownScriptWithUnauthorisedContentFound => r.type === 'known_script_unauthorised_content')
    const unknownHeaders = comparisonResults.filter((r): r is UnknownHeaderFound => r.type === 'unknown_header_found')
    const unauthorizedHeaders = comparisonResults.filter((r): r is KnownHeaderWithUnauthorisedContentFound => r.type === 'known_header_unauthorised_content')

    // Log unknown scripts
    if (unknownScripts.length > 0) {
      this.logUnknownScripts(unknownScripts, target)
    }

    // Log unauthorized scripts (detection mode only in typical usage)
    if (unauthorizedScripts.length > 0) {
      this.logUnauthorizedScripts(unauthorizedScripts, target)
    }

    // Log unknown headers
    if (unknownHeaders.length > 0) {
      this.logUnknownHeaders(unknownHeaders, target)
    }

    // Log unauthorized headers (detection mode only in typical usage)
    if (unauthorizedHeaders.length > 0) {
      this.logUnauthorizedHeaders(unauthorizedHeaders, target)
    }

    // AuthorizedScriptFound and AuthorizedHeaderFound are no-ops (no alert needed)
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
    })
    console.log()
  }

  private logUnauthorizedScripts(scripts: KnownScriptWithUnauthorisedContentFound[], target: Target): void {
    this.log(AlertType.Script, `Script authorization failed for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${scripts.length}`)
    console.log('  Scripts:')

    scripts.forEach((result, index) => {
      const identifier = result.script.name
      const hash = result.script.hash.value
      const matcherType = result.authorizationMatcher.getType()
      const reason = result.failureReason
      console.log(`    ${index + 1}. ${this.truncate(identifier)}`)
      console.log(`       Hash: ${this.truncate(hash)}`)
      console.log(`       Failed Matcher: ${matcherType}`)
      console.log(`       Reason: ${reason}`)
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
    })
    console.log()
  }

  private logUnauthorizedHeaders(headers: KnownHeaderWithUnauthorisedContentFound[], target: Target): void {
    this.log(AlertType.Header, `Header authorization failed for target: ${target.url}`)
    console.log(`  Target Type: ${target.type}`)
    console.log(`  Count: ${headers.length}`)
    console.log('  Headers:')

    headers.forEach((result, index) => {
      const matcherType = result.authorizationMatcher.getType()
      const reason = result.failureReason
      console.log(`    ${index + 1}. ${result.header.name}`)
      console.log(`       Value: ${this.truncate(result.header.value)}`)
      console.log(`       Failed Matcher: ${matcherType}`)
      console.log(`       Reason: ${reason}`)
    })
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
}
