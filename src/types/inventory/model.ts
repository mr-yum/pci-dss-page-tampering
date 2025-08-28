import type { SHA256Hash } from '../hash'
import type { TargetDetection, TargetInventory } from '../target'
import type { RawInventory } from './raw'

export type InventoryAuthorisationInfo = {
  description: string
  authorised: boolean
  date: Date
}

export type InventoryScriptHashInfo = {
  timestamp: Date
  hash: SHA256Hash
}

export type InventoryScriptInfo = {
  matcher: RegExp
  hashes: InventoryScriptHashInfo[]
  authorisationInfo: InventoryAuthorisationInfo
}

export type InventoryHeaderInfo = {
  nameMatcher: RegExp
  contentMatcher: RegExp
  authorisationInfo: InventoryAuthorisationInfo
}

export type InventoryTarget = {
  inventory: TargetInventory
  detection: TargetDetection
}

export type Inventory = {
  fileName: string
  target: InventoryTarget
  scripts: InventoryScriptInfo[]
  headers: InventoryHeaderInfo[]
}

export type InventoryDifferenceResult = {
  oldInventory: Inventory
  newInventory: Inventory
}

export type InventoryPullPayload = {
  fileName: string
  rawInventory: RawInventory
}

export type InventoryPullResult = {
  payloads: InventoryPullPayload[]
}
