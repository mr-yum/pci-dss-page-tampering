import type { Inventory, InventoryScriptInfo, InventoryHeaderInfo } from '../types/inventory/model'
import type { RawInventory, RawInventoryHeaderInfo } from '../types/inventory/raw'
import { inventoryScriptInfoToRawInventoryScriptInfo } from './script'

export function copyInventory(inventory: Inventory, args?: { newScripts: InventoryScriptInfo[] }): Inventory {
  return {
    fileName: inventory.fileName,
    target: inventory.target,
    alerts: inventory.alerts,
    scripts: args ? args.newScripts : inventory.scripts,
    headers: inventory.headers,
  }
}

export function inventoryToRawInventory(inventory: Inventory): RawInventory {
  return {
    target: {
      inventory: {
        type: inventory.target.inventory.type,
        url: inventory.target.inventory.url,
        workflow: inventory.target.inventory.workflow.fileName,
      },
      detection: {
        type: inventory.target.detection.type,
        url: inventory.target.detection.url,
        workflow: inventory.target.detection.workflow.fileName,
      },
    },
    alerts: inventory.alerts,
    scripts: inventory.scripts.map(inventoryScriptInfoToRawInventoryScriptInfo),
    headers: inventory.headers.map(inventoryHeaderInfoToRawInventoryHeaderInfo),
  }
}

export function rawInventoryHeaderInfoToInventoryHeaderInfo(rawHeaderInfo: RawInventoryHeaderInfo): InventoryHeaderInfo {
  return {
    nameMatcher: new RegExp(rawHeaderInfo.nameMatcher),
    contentMatcher: new RegExp(rawHeaderInfo.contentMatcher),
    authorisationInfo: {
      description: rawHeaderInfo.authorisationInfo.description,
      authorised: rawHeaderInfo.authorisationInfo.authorised,
      date: new Date(rawHeaderInfo.authorisationInfo.date),
    },
  }
}

export function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo {
  return {
    nameMatcher: headerInfo.nameMatcher.source,
    contentMatcher: headerInfo.contentMatcher.source,
    authorisationInfo: {
      description: headerInfo.authorisationInfo.description,
      authorised: headerInfo.authorisationInfo.authorised,
      date: headerInfo.authorisationInfo.date,
    },
  }
}
