import type { SHA256Hash } from './hash'

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

export type InventoryPayload = {
  scripts: InventoryScriptInfo[]
}
