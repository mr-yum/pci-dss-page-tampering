import type { Inventory, InventoryScriptInfo, InventoryHeaderInfo } from '../types/inventory/model'
import type { RawInventory, RawInventoryHeaderInfo } from '../types/inventory/raw'
import { inventoryScriptInfoToRawInventoryScriptInfo } from './script'

export function copyInventory(inventory: Inventory, args?: { newScripts: InventoryScriptInfo[] }): Inventory {
  return {
    fileName: inventory.fileName,
    target: inventory.target,
    scripts: args ? args.newScripts : inventory.scripts,
    headers: inventory.headers,
  }
}

export function inventoryToRawInventory(inventory: Inventory): RawInventory {
  return {
    target: {
      inventory: inventory.target.inventory,
      detection: inventory.target.detection,
      workflow: inventory.target.workflow.fileName,
    },
    scripts: inventory.scripts.map(inventoryScriptInfoToRawInventoryScriptInfo),
    headers: (inventory.headers || []).map(inventoryHeaderInfoToRawInventoryHeaderInfo),
  }
}

export function rawInventoryHeaderInfoToInventoryHeaderInfo(rawHeaderInfo: RawInventoryHeaderInfo): InventoryHeaderInfo {
  return {
    nameMatcher: new RegExp(rawHeaderInfo.nameMatcher),
    contentMatcher: new RegExp(rawHeaderInfo.contentMatcher),
    description: rawHeaderInfo.description,
    authorised: rawHeaderInfo.authorised,
    date: new Date(rawHeaderInfo.date),
  }
}

export function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo {
  return {
    nameMatcher: headerInfo.nameMatcher.source,
    contentMatcher: headerInfo.contentMatcher.source,
    description: headerInfo.description,
    authorised: headerInfo.authorised,
    date: headerInfo.date.toISOString(),
  }
}
