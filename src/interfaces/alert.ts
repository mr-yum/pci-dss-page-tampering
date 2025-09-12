import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'
import type { InventoryAlert } from '../types/inventory/model'

export interface IAlertService {
  alertForScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void>
  alertForHeaders(headerComparisonSummary: HeaderComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void>
}
