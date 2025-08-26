import type { ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'

export interface IAlertService {
  alert(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void>
}
