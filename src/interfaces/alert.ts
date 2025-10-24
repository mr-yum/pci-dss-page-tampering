import type { ComparisonResultType } from '../types/comparison'
import type { InventoryAlert } from '../types/inventory/model'
import type { Target } from '../types/target'

export interface IAlertService {
  alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void>
}
