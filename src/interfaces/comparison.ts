import type { Inventory } from '../types/inventory/model'
import type { ScriptDetectionSummary } from '../types/script'
import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'
import type { HeaderDetectionSummary } from '../types/header'
import type { ScriptMatcher } from '../types/matcher'

export interface IScriptComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptComparisonSummary>
}

export interface IHeaderComparisonService {
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: HeaderDetectionSummary): Promise<HeaderComparisonSummary>
}
