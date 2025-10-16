import type { ComparisonResultType,HeaderComparisonSummary  } from '../types/comparison'
import type { HeaderDetectionSummary } from '../types/header'
import type { Inventory } from '../types/inventory/model'
import type { ScriptDetectionSummary } from '../types/script'
import type { Target } from '../types/target'

/**
 * T046: Updated interface to return typed comparison results instead of summary
 */
export interface IScriptComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ComparisonResultType[]>
}

export interface IHeaderComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: HeaderDetectionSummary): Promise<HeaderComparisonSummary>
}
