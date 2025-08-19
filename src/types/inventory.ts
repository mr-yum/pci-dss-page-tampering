import type { SHA256Hash } from './hash'
import type { WorkflowDefinition } from './workflow'
import type { TargetDetection, TargetInventory } from './target'

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
  workflow: WorkflowDefinition
}

export type Inventory = {
  target: InventoryTarget
  scripts: InventoryScriptInfo[]
}
