import type { SHA256Hash } from './hash'
import type { WorkflowDefinition } from './workflow'
import type { Target } from './target'

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
  name: string
  hashes: InventoryScriptHashInfo[]
  authorisationInfo: InventoryScriptAuthorisationInfo
}

export type InventoryTarget = {
  inventory: Target
  detection: Target
  workflow: WorkflowDefinition
}

export type InventoryPayload = {
  target: InventoryTarget
  scripts: InventoryScriptInfo[]
}
