import type { ComparisonResultType } from '../types/comparison'
import type { HeaderDetectionSummary } from '../types/header'
import type { Inventory } from '../types/inventory/model'
import type { ScriptDetectionSummary } from '../types/script'
import type { Target } from '../types/target'

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
