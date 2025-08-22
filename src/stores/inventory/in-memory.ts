import type { IInventoryStore } from '../../interfaces/inventory'

import type { Inventory, InventoryPullResult, InventoryScriptInfo } from '../../types/inventory/model'
import type { RawInventory } from '../../types/inventory/raw'

export class InMemoryInventoryStore implements IInventoryStore {
  // @ts-ignore
  private _inventory: RawInventory[] = [
    {
      fileName: '',
      target: {
        inventory: { type: 'inventory', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' },
        detection: { type: 'detection', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au' }, // TODO: replace with production target
        workflow: '1.0_uat-workflow',
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
      fileName: '',
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance' }, // TODO: replace with production target
        workflow: '2.0_uat-workflow',
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://www\\.googletagmanager\\.com/gtag/js\\?id=G-[A-Z0-9]+$')),
        this.createDefaultInventoryScript(RegExp('^https://hcaptcha\\.com/1/api\\.js\\?.*$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/signals/config/\\d+\\?.*$')),
      ],
    },
  ]

  pull(): Promise<InventoryPullResult> {
    return Promise.resolve({
      payloads: [],
    })
  }

  push(_inventory: Inventory[]): Promise<void> {
    // this._inventory = inventory
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
