import type { Inventory } from '../types/inventory/model'
import type { ScriptDetectionSummary } from '../types/script'
import type { ScriptComparisonSummary } from '../types/comparison'

export interface IScriptComparisonService {
  compare(inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ScriptComparisonSummary>
}
