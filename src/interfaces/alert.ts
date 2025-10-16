import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../types/comparison'
import type { InventoryAlert } from '../types/inventory/model'
import type { Target } from '../types/target'

export interface IAlertService {
  alertForScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void>
  alertForHeaders(headerComparisonSummary: HeaderComparisonSummary, target: Target, alertDestinations: InventoryAlert): Promise<void>
}
