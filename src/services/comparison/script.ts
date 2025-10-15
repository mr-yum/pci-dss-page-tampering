import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model'
import type { IScriptComparisonService } from '../../interfaces/comparison'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../../types/comparison'
import type { Target } from '../../types/target'
import type { DetectedScript } from '../../types/matcher/matcher.interface'

import { getScriptSource } from '../../utils/script'

export class ScriptComparisonService implements IScriptComparisonService {
  /*
  Returns scripts that match the following conditions:
    - Not found in inventory
    - Found in inventory and authorised but hash doesn't exist and doesn't have any content matches
   */
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ScriptComparisonSummary> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.externalScripts
    const detectedInlineScripts = scriptDetectionSummary.inlineScripts

    const externalScriptsComparisonResult = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts, target)
    const inlineScriptsComparisonResult = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts, target)

    return Promise.resolve({
      target: target,
      externalScripts: externalScriptsComparisonResult,
      inlineScripts: inlineScriptsComparisonResult,
    })
  }

  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target): ScriptComparisonResult {
    const newScripts: ScriptInfo[] = []
    const newHashes: ScriptInfo[] = []

    detectedScripts.forEach((script) => {
      const comparisonResult = this.compareSingleScriptWithInventory(script, inventoryScripts, target)

      if (comparisonResult.isNewScript) {
        newScripts.push(script)
      }

      if (comparisonResult.isNewHash) {
        newHashes.push(script)
      }
    })

    return {
      newScripts: newScripts,
      newHashes: newHashes,
    }
  }

  /**
   * Converts ScriptInfo to DetectedScript format for matcher operations.
   *
   * Note: For external scripts, we use the URL as both name AND content.
   * This maintains backward compatibility with the old behavior where contentMatcher
   * was tested against getScriptSource(script) which returns the URL for external scripts.
   *
   * For inline scripts, name is the ID and content is the actual script content.
   */
  private scriptInfoToDetectedScript(scriptInfo: ScriptInfo): DetectedScript {
    const name = getScriptSource(scriptInfo)
    const content = scriptInfo.source.type === 'inline' ? scriptInfo.source.content : name

    return {
      name,
      content,
      hash: scriptInfo.hash
    }
  }

  /**
   * Compares a single detected script against inventory using matcher pipeline.
   * Implements first-match-wins identification and authorization logic.
   *
   * Phase 4 Refactoring (T035-T040):
   * - Uses identifyWith matcher for script identification (first-match-wins)
   * - Uses authoriseWith matcher for content authorization
   * - Handles null/empty content as new script (fail-secure per clarification Q3)
   * - Logs matcher execution with type, pattern, result, and timing
   */
  private compareSingleScriptWithInventory(script: ScriptInfo, inventoryScripts: InventoryScriptInfo[], target: Target): { isNewScript: boolean; isNewHash: boolean } {
    const scriptSourceValue = getScriptSource(script)
    const detectedScript = this.scriptInfoToDetectedScript(script)

    // T038: Null/empty content handling - fail-secure (per clarification Q3)
    if (!detectedScript.content || detectedScript.content.trim() === '') {
      console.log(`[Comparison → Script]: Script '${scriptSourceValue}' has null/empty content, treating as new script for target '${target.url}'.`)
      return { isNewScript: true, isNewHash: false }
    }

    // T035, T036: First-match-wins identification using matcher pipeline
    const startIdentificationTime = Date.now()
    const matchedEntry = this.findMatchingInventoryEntry(detectedScript, inventoryScripts)
    const identificationTime = Date.now() - startIdentificationTime

    if (!matchedEntry) {
      console.log(`[Comparison → Script]: Script '${scriptSourceValue}' not identified in inventory (no identifyWith matcher matched) for target '${target.url}'. Identification took ${identificationTime}ms.`)
      return { isNewScript: true, isNewHash: false }
    }

    // T040: Log successful identification with matcher details
    const identifyMatcher = matchedEntry.identifyWith
    console.log(`[Comparison → Script]: Script '${scriptSourceValue}' identified using ${identifyMatcher.getType()}Matcher with pattern '${JSON.stringify(identifyMatcher.getPattern())}' in ${identificationTime}ms.`)

    // T037: Authorization using authoriseWith matcher
    const startAuthorizationTime = Date.now()
    const authorizationResult = matchedEntry.authoriseWith.authorize(detectedScript)
    const authorizationTime = Date.now() - startAuthorizationTime

    // T040: Log authorization result with matcher details
    const authorizeMatcher = matchedEntry.authoriseWith
    console.log(`[Comparison → Script]: Script '${scriptSourceValue}' authorization via ${authorizeMatcher.getType()}Matcher with pattern '${JSON.stringify(authorizeMatcher.getPattern())}': ${authorizationResult.authorized ? 'AUTHORIZED' : 'UNAUTHORIZED (' + authorizationResult.reason + ')'} in ${authorizationTime}ms.`)

    if (!authorizationResult.authorized) {
      // Known script but unauthorized content
      console.log(`[Comparison → Script]: Script '${scriptSourceValue}' found in inventory but authorization failed: ${authorizationResult.reason} for target '${target.url}'.`)
      return { isNewScript: false, isNewHash: true }
    }

    // Script is both identified and authorized
    return { isNewScript: false, isNewHash: false }
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
      if (!inventoryEntry.authorisationInfo.authorised) {
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
