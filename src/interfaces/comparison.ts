import type { Inventory } from '../types/inventory/model'
import type { ScriptDetectionSummary } from '../types/script'
import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'
import type { HeaderDetectionSummary } from '../types/header'
import type { ComparisonResultType } from '../types/comparison'

/**
 * T046: Updated interface to return typed comparison results instead of summary
 */
export interface IScriptComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ComparisonResultType[]>
}

export interface IHeaderComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: HeaderDetectionSummary): Promise<HeaderComparisonSummary>
}
