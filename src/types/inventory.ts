import type { SHA256Hash } from './hash'
import type { WorkflowDefinition } from './workflow'
import type { TargetDetection, TargetInventory } from './target'
import type { IInventoryStore } from '../interfaces/inventory'
import type { SimpleGit } from 'simple-git'

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

export type InventoryDifferenceResult = {
  oldInventory: Inventory
  newInventory: Inventory
}

export type InventoryServiceProps = {
  inventoryStore: IInventoryStore
}

export type GitInventoryStoreProps = {
  gitClient: SimpleGit
  repositoryTarget: string
  clonePath: string
}
