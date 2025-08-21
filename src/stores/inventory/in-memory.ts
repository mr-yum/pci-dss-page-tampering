import type { IInventoryStore } from '../../interfaces/inventory'
import type { Inventory, InventoryScriptInfo } from '../../types/inventory'

import { uatWorkflow as uatWorkflow10 } from '../../workflows/1.0'
import { uatWorkflow as uatWorkflow20 } from '../../workflows/2.0'

export class InMemoryInventoryStore implements IInventoryStore {
  private _inventory: Inventory[] = [
    {
      target: {
        inventory: { type: 'inventory', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' },
        detection: { type: 'detection', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' }, // TODO: replace with production target
        workflow: uatWorkflow10,
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://app-dev\\.meandu\\.com/config\\.production\\.js\\?v=.+$')),
        this.createDefaultInventoryScript(RegExp('^blob:https://app-dev\\.meandu\\.com/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/[a-z]{2}_[A-Z]{2}/sdk\\.js\\?hash=[a-f0-9]{32}$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise\\.js\\?render=.+$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise/webworker\\.js\\?.*$')),
      ],
    },
    {
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: uatWorkflow20,
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://www\\.googletagmanager\\.com/gtag/js\\?id=G-[A-Z0-9]+$')),
        this.createDefaultInventoryScript(RegExp('^https://hcaptcha\\.com/1/api\\.js\\?.*$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/signals/config/\\d+\\?.*$')),
      ],
    },
  ]

  pull(): Promise<Inventory[]> {
    return Promise.resolve(this._inventory)
  }

  push(inventory: Inventory[]): Promise<void> {
    this._inventory = inventory
    console.log('[Store] Updated inventory store with new payload.')
    return Promise.resolve()
  }

  private createDefaultInventoryScript(regex: RegExp): InventoryScriptInfo {
    return {
      matcher: regex,
      hashes: [],
      authorisationInfo: {
        description: 'Script that doesnt match with default implementation due to query string',
        authorised: true,
        date: new Date(),
      },
    }
  }
}
