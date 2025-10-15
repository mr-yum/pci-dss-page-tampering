import type { IInventoryStore } from '../../interfaces/inventory'

import type { Inventory, InventoryPullResult } from '../../types/inventory/model'
import type { RawInventory, RawInventoryScriptInfo, RawInventoryHeaderInfo } from '../../types/inventory/raw'

export class InMemoryInventoryStore implements IInventoryStore {
  // @ts-ignore - This is unused test data, but kept for reference
  private _inventory: RawInventory[] = [
    {
      target: {
        inventory: { type: 'inventory', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au', workflow: '1.0_uat-workflow' },
        detection: { type: 'detection', url: 'https://app-dev.meandu.com/qr?t=689e88f4d752b3d741db52b2_default&r=au', workflow: '1.0_uat-workflow' },
      },
      alerts: {
        inventory: {
          newScriptIdentified: { destination: 'test-channel' },
          newHeaderIdentified: { destination: 'test-channel' },
        },
        detection: {
          newScriptDetected: { destination: 'test-channel' },
          scriptMismatchDetected: { destination: 'test-channel' },
          newHeaderDetected: { destination: 'test-channel' },
        },
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://app-dev\\.meandu\\.com/config\\.production\\.js\\?v=.+$')),
        this.createDefaultInventoryScript(RegExp('^blob:https://app-dev\\.meandu\\.com/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/[a-z]{2}_[A-Z]{2}/sdk\\.js\\?hash=[a-f0-9]{32}$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise\\.js\\?render=.+$')),
        this.createDefaultInventoryScript(RegExp('^https://www\\.recaptcha\\.net/recaptcha/enterprise/webworker\\.js\\?.*$')),
      ],
      headers: [this.createDefaultInventoryHeader(RegExp('^content-security-policy$'), RegExp('^.*$'))],
    },
    {
      target: {
        inventory: { type: 'inventory', url: 'https://staging.meandu.app/pcidsscompliance', workflow: '2.0_uat-workflow' },
        detection: { type: 'detection', url: 'https://staging.meandu.app/pcidsscompliance', workflow: '2.0_uat-workflow' },
      },
      alerts: {
        inventory: {
          newScriptIdentified: { destination: 'test-channel' },
          newHeaderIdentified: { destination: 'test-channel' },
        },
        detection: {
          newScriptDetected: { destination: 'test-channel' },
          scriptMismatchDetected: { destination: 'test-channel' },
          newHeaderDetected: { destination: 'test-channel' },
        },
      },
      scripts: [
        this.createDefaultInventoryScript(RegExp('^https://www\\.googletagmanager\\.com/gtag/js\\?id=G-[A-Z0-9]+$')),
        this.createDefaultInventoryScript(RegExp('^https://hcaptcha\\.com/1/api\\.js\\?.*$')),
        this.createDefaultInventoryScript(RegExp('^https://connect\\.facebook\\.net/signals/config/\\d+\\?.*$')),
      ],
      headers: [this.createDefaultInventoryHeader(RegExp('^content-security-policy$'), RegExp('^.*$'))],
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

  /**
   * Creates a default inventory script entry for testing.
   *
   * Updated for Phase 3:
   * - identifyWith: Uses nameMatcher with the provided regex pattern
   * - authoriseWith: Uses nameMatcher (same pattern for authorization)
   * - This matches the common pattern of URL-based script matching
   */
  private createDefaultInventoryScript(regex: RegExp): RawInventoryScriptInfo {
    return {
      identifyWith: { nameMatcher: regex.source },
      authoriseWith: { nameMatcher: regex.source },
      authorisationInfo: {
        description: 'Script that doesnt match with default implementation due to query string',
        authorised: true,
        date: new Date(),
      },
    }
  }

  private createDefaultInventoryHeader(nameRegex: RegExp, contentRegex: RegExp): RawInventoryHeaderInfo {
    return {
      nameMatcher: nameRegex.source,
      contentMatcher: contentRegex.source,
      authorisationInfo: {
        description: 'Default header for testing',
        authorised: true,
        date: new Date(),
      },
    }
  }
}
