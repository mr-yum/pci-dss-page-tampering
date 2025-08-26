import type { IAlertService } from '../interfaces/alert'
import type { ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'

export class SlackAlertService implements IAlertService {
  // @ts-ignore
  alert(scriptComparisonSummary: ScriptComparisonSummary, target: Target): Promise<void> {
    switch (target.type) {
      case 'detection':
        break
      case 'inventory':
        break
    }
    return Promise.resolve()
  }
}
