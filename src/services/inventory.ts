import type { Inventory } from '../types/inventory'
import type { ScriptComparisonSummary } from '../types/comparison'

import { uatWorkflow as uatWorkflow10 } from '../workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from '../workflows/2.0'

interface IScriptInventoryService {
  pull(): Promise<Inventory[]>
  push(comparisonSummary: ScriptComparisonSummary): Promise<void>
}

export class InMemoryScriptInventoryService implements IScriptInventoryService {
  private _inventory: Inventory[] = [
    {
      target: {
        inventory: { type: 'inventory', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' },
        detection: { type: 'detection', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' }, // TODO: replace with production target
        workflow: uatWorkflow10,
      },
      scripts: [],
    },
    {
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: uatWorkflow20,
      },
      scripts: [],
    },
  ]

  async pull(): Promise<Inventory[]> {
    return this._inventory
  }

  async push(comparisonSummary: ScriptComparisonSummary): Promise<void> {
    if (comparisonSummary.target.type !== 'inventory') {
      console.error('[Inventory] Cannot inventory scripts from detection target! Skipping...')
      return Promise.resolve()
    }
  }
}
