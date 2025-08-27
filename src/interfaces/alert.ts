import type { HeaderComparisonSummary, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'

export interface IAlertService {
  alertForScripts(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void>
  alertForHeaders(headerComparisonSummary: HeaderComparisonSummary, target: Target): Promise<void>
}
