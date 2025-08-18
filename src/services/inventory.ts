import type { ScriptDetectionSummary } from '../types/script'
import type { InventoryPayload } from '../types/inventory'

import { uatWorkflow as uatWorkflow10 } from '../workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from '../workflows/2.0'

interface IScriptInventoryService {
  pull(): Promise<InventoryPayload[]>
  push(scriptDetectionSummary: ScriptDetectionSummary): Promise<void>
}

export class InMemoryScriptInventoryService implements IScriptInventoryService {
  private _inventory: InventoryPayload[] = [
    {
      target: {
        inventory: { url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' },
        detection: { url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' }, // TODO: replace with production target
        workflow: uatWorkflow10,
      },
      scripts: [],
    },
    {
      target: {
        inventory: { url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: uatWorkflow20,
      },
      scripts: [],
    },
  ]

  async pull(): Promise<InventoryPayload[]> {
    return this._inventory
  }
  async push(_scriptDetectionSummary: ScriptDetectionSummary): Promise<void> {
    throw new Error('Not implemented')
  }
}
