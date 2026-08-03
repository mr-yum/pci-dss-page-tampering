import type { SimpleGit } from 'simple-git'

import type { IInventoryStore, IScriptInventoryRepository } from '../../interfaces/inventory.js'

export type InventoryServiceProps = {
  inventoryRepository: IScriptInventoryRepository
}

export type GitInventoryStoreProps = {
  gitClient: SimpleGit
  repositoryTarget: string
  gitUserName: string
  gitUserEmail: string
  verifyBranchReplacement?: ((branchName: string) => Promise<void>) | undefined
}

export type InventoryRepositoryProps = {
  inventoryStore: IInventoryStore
}
