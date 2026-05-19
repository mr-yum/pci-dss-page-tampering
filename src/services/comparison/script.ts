import type { IScriptComparisonService } from '../../interfaces/comparison'
import type { ComparisonResultType } from '../../types/comparison'
import { AuthorizedScriptFound, KnownScriptWithUnauthorisedContentFound, UnknownScriptFound } from '../../types/comparison'
import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model'
import type { DetectedScript } from '../../types/matcher/matcher.interface'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script'
import type { Target } from '../../types/target'
import { getScriptSource } from '../../utils/script'
import { extractHost } from '../../utils/url'

export class ScriptComparisonService implements IScriptComparisonService {
  /**
   * Returns typed comparison results with complete context for alert handlers.
   *
   * Result types:
   * - UnknownScriptFound: Script not in inventory or has null/empty content
   * - KnownScriptWithUnauthorisedContentFound: Script identified but authorization failed
   * - AuthorizedScriptFound: Script both identified and authorized (compliant)
   */
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ComparisonResultType[]> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.externalScripts
    const detectedInlineScripts = scriptDetectionSummary.inlineScripts

    const externalScriptsResults = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts, target)
    const inlineScriptsResults = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts, target)

    return Promise.resolve([...externalScriptsResults, ...inlineScriptsResults])
  }

  /**
   * Compares detected scripts against inventory, returning typed results for each script.
   */
  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType[] {
    const results: ComparisonResultType[] = []

    detectedScripts.forEach((script) => {
      const comparisonResult = this.compareSingleScriptWithInventory(script, inventoryScripts, target)
      results.push(comparisonResult)
    })

    return results
  }

  /**
   * Converts ScriptInfo to DetectedScript format for matcher operations.
   *
   * For external scripts: name and content are the URL (matching the
   * pre-refactor behaviour of ContentMatcher against `getScriptSource`).
   * For inline scripts: name is the ID, content is the actual source.
   *
   * `url` is populated for both — external scripts use `source.url`
   * directly, inline scripts use the initiator URL captured by the
   * page-attribution shim (`InlineScriptSource.url`). `HostMatcher` /
   * `UrlMatcher` consume this single field; both fail-secure when it's
   * missing.
   */
  private scriptInfoToDetectedScript(scriptInfo: ScriptInfo): DetectedScript {
    const name = getScriptSource(scriptInfo)
    const content = scriptInfo.source.type === 'inline' ? scriptInfo.source.content : name
    const url = scriptInfo.source.type === 'external' ? scriptInfo.source.url : scriptInfo.source.url

    return {
      name,
      content,
      hash: scriptInfo.hash,
      ...(url !== undefined ? { url } : {}),
    }
  }

  /**
   * Compares a single detected script against inventory using matcher pipeline.
   * Implements first-match-wins identification and authorization logic.
   *
   * T054: Updated to return ComparisonResultType instead of { isNewScript, isNewHash }
   * T055-T057: Instantiates typed result classes based on comparison outcome
   *
   * Phase 4 Refactoring (T035-T040):
   * - Uses identifyWith matcher for script identification (first-match-wins)
   * - Uses authoriseWith matcher for content authorization
   * - Handles null/empty content as new script (fail-secure per clarification Q3)
   * - Logs matcher execution with type, pattern, result, and timing
   */
  private compareSingleScriptWithInventory(script: ScriptInfo, inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType {
    const scriptSourceValue = getScriptSource(script)
    const detectedScript = this.scriptInfoToDetectedScript(script)
    const timestamp = new Date()

    // Mirror the header format — lead log lines with `Script '<host>':'<identifier>'`
    // so operators can scan provenance at a glance. Host derived from the
    // attribution URL (external → script URL; inline → initiator URL captured
    // by the page-attribution shim).
    const scriptLabel = `Script '${extractHost(detectedScript.url)}':'${scriptSourceValue}'`

    // T055: Null/empty content handling - fail-secure (per clarification Q3)
    if (!detectedScript.content || detectedScript.content.trim() === '') {
      target.logger.log(`${scriptLabel} has null/empty content, treating as new script.`)
      return new UnknownScriptFound(target, timestamp, detectedScript)
    }

    // First-match-wins identification using matcher pipeline
    const matchedEntry = this.findMatchingInventoryEntry(detectedScript, inventoryScripts)

    // T055: Script not identified in inventory
    if (!matchedEntry) {
      target.logger.log(`${scriptLabel} not identified in inventory (no identifyWith matcher matched).`)
      return new UnknownScriptFound(target, timestamp, detectedScript)
    }

    // Log successful identification with matcher details
    const identifyDescription = matchedEntry.identifyWith.getDescription()
    target.logger.log(`${scriptLabel} identified using ${identifyDescription}.`)

    // Authorization using authoriseWith matcher
    const authorizationResult = matchedEntry.authoriseWith.matcher.authorize(detectedScript)

    // Log authorization result with matcher details
    const authorizeDescription = matchedEntry.authoriseWith.matcher.getDescription()
    const authStatus = authorizationResult.authorized ? 'AUTHORIZED' : `UNAUTHORIZED (${authorizationResult.reason})`

    // Build full metadata path: top-level authorisationInfo + nested metadataPath
    const fullPath = [matchedEntry.authoriseWith.authorisationInfo, ...(authorizationResult.metadataPath ?? [])]
    const metadataPathDesc = fullPath.length > 0 ? ` Auth: ${fullPath.map((m) => m.description).join(' > ')}` : ''

    target.logger.log(`${scriptLabel} authorization via ${authorizeDescription}: ${authStatus}.${metadataPathDesc}`)

    // T056: Known script but unauthorized content
    // T029: Pass metadataPath from AuthorizationResult for composite matcher support
    if (!authorizationResult.authorized) {
      return new KnownScriptWithUnauthorisedContentFound(
        target,
        timestamp,
        detectedScript,
        matchedEntry,
        matchedEntry.authoriseWith.matcher,
        authorizationResult.reason ?? 'Unknown authorization failure',
        authorizationResult.metadataPath ?? [], // NEW: Pass metadata path from authorization result
      )
    }

    // T057: Script is both identified and authorized
    // T029: Pass metadataPath from AuthorizationResult for composite matcher support
    return new AuthorizedScriptFound(target, timestamp, detectedScript, matchedEntry, authorizationResult.metadataPath ?? [])
  }

  /**
   * Finds first inventory entry where identifyWith matcher returns true.
   * Implements first-match-wins logic per clarification Q1.
   *
   * @param script - Detected script to match
   * @param inventoryScripts - Array of inventory entries (iteration order determines priority)
   * @returns First matching entry or undefined if no match
   */
  private findMatchingInventoryEntry(script: DetectedScript, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo | undefined {
    for (const inventoryEntry of inventoryScripts) {
      // Skip non-authorized entries (legacy compatibility)
      if (!inventoryEntry.authoriseWith.authorisationInfo.authorised) {
        continue
      }

      const identified = inventoryEntry.identifyWith.identify(script)
      if (identified) {
        return inventoryEntry // First match wins
      }
    }
    return undefined
  }
}
