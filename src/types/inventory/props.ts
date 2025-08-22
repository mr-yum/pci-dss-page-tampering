import type { IInventoryStore } from '../../interfaces/inventory'
import type { SimpleGit } from 'simple-git'

export type InventoryServiceProps = {
  inventoryStore: IInventoryStore
}

export type GitInventoryStoreProps = {
  gitClient: SimpleGit
  repositoryTarget: string
  clonePath: string
}
