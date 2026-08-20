import type { ComparisonResultType } from '../types/comparison.js'
import type { HeaderDetectionSummary } from '../types/header.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import type { DetectedScript, Matchable } from '../types/matcher/matcher.interface.js'
import type { ScriptDetectionSummary } from '../types/script.js'
import type { Target } from '../types/target.js'

/**
 * Script Comparison Service Interface
 *
 * Updated to return typed comparison results instead of summary.
 * @see specs/001-refactor-script-identification
 */
export interface IScriptComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ComparisonResultType[]>

  /**
   * RUM evidence path (feature 011): identification-only lookup — the
   * first-match-wins `identifyWith` pass, with no authorisation attempt.
   * Used for external RUM scripts, whose content and hash are unobtainable
   * client-side (research R8).
   */
  identifyScript(script: Matchable, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo | undefined

  /**
   * RUM evidence path (feature 011): full identify → authorise evaluation
   * for a script whose evidence is a client-computed hash rather than
   * fetched content. Skips the synthetic null-content pre-gate; matchers are
   * evidence-aware, so a hash-based authoriser can authorise on the hash
   * alone while each matcher still fails secure on evidence the observation
   * lacks (content, url, workflow id, …).
   */
  compareScriptEvidence(detectedScript: DetectedScript, inventoryScripts: InventoryScriptInfo[], target: Target): ComparisonResultType
}

/**
 * Header Comparison Service Interface
 *
 * Updated to return typed comparison results (T017 - Phase 3).
 * Returns array of typed results (UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound).
 * @see specs/002-continuing-our-refactor/data-model.md
 */
export interface IHeaderComparisonService {
  compare(target: Target, inventory: Inventory, headerDetectionSummary: HeaderDetectionSummary): Promise<ComparisonResultType[]>
}
