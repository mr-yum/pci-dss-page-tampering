import type { ComparisonResultType } from '../types/comparison.js'
import type { HeaderDetectionSummary } from '../types/header.js'
import type { Inventory } from '../types/inventory/model.js'
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
