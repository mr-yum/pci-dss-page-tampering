import type { SimpleGit } from 'simple-git'

import type { IInventoryStore, IScriptInventoryRepository } from '../../interfaces/inventory'

export type InventoryServiceProps = {
  inventoryRepository: IScriptInventoryRepository
}

export type GitInventoryStoreProps = {
  gitClient: SimpleGit
  repositoryTarget: string
}

export type InventoryRepositoryProps = {
  inventoryStore: IInventoryStore
}
