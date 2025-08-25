import type { SHA256Hash } from '../hash'
import type { TargetDetection, TargetInventory } from '../target'
import type { Workflow } from '../workflow'
import type { RawInventory } from './raw'

export type InventoryScriptAuthorisationInfo = {
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
  authorisationInfo: InventoryScriptAuthorisationInfo
}

export type InventoryTarget = {
  inventory: TargetInventory
  detection: TargetDetection
  workflow: Workflow
}

export type Inventory = {
  fileName: string
  target: InventoryTarget
  scripts: InventoryScriptInfo[]
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
