import type { IInventoryStore } from '../../interfaces/inventory'
import type { Inventory } from '../../types/inventory/model'
import type { GitInventoryStoreProps } from '../../types/inventory/props'
import simpleGit, { type SimpleGit } from 'simple-git'
import type { RawInventory } from '../../types/inventory/raw'

import { rm, readdir } from 'fs/promises'
import { getRawInventoryFromDirectory } from '../../utils/file'

export class GitInventoryStore implements IInventoryStore {
  private readonly initialGitClient: SimpleGit
  private readonly repositoryTarget: string
  private readonly clonePath: string

  private readonly _expectedWorkflowDirectoryName = 'workflows'
  private readonly _expectedTargetDirectoryName = 'targets'

  constructor(args: GitInventoryStoreProps) {
    this.initialGitClient = args.gitClient
    this.repositoryTarget = args.repositoryTarget
    this.clonePath = args.clonePath
  }

  async pull(): Promise<RawInventory[]> {
    // Clean up any existing clones
    console.log(`[Store] Removing any existing clones with path '${this.clonePath}'.`)
    await this.cleanUpExistingClone()

    // Clone repository
    console.log(`[Store] Cloning repository '${this.repositoryTarget}' to path '${this.clonePath}'.`)
    await this.initialGitClient.clone(this.repositoryTarget, this.clonePath)

    // Ensure that the appropriate folders exist
    if (!(await this.requiredFoldersExist())) {
      return Promise.reject(new Error(`[Store] Required folders not found! Please ensure that the following folders exist: '${this._expectedWorkflowDirectoryName}' and '${this._expectedTargetDirectoryName}'.`))
    }

    // Create new Git client which runs commands within clone path
    const repositoryGitClient = simpleGit(this.clonePath)

    // Pull repository
    console.log(`[Store] Fetching from repository '${this.repositoryTarget}'.`)
    await repositoryGitClient.fetch()

    // Checkout to testing branch
    const branch = 'feature/CAD-715_initial-inventory-payload'
    console.log(`[Store] Checking out to branch '${branch}'.`)
    await repositoryGitClient.checkout(branch)

    // Get and return raw inventory from files
    console.log(`[Store] Reading and returning raw inventory. '${branch}'.`)
    const inventoryPath = `${this.clonePath}/${this._expectedTargetDirectoryName}`
    return await getRawInventoryFromDirectory(inventoryPath)
  }

  // @ts-ignore
  async push(inventory: Inventory[]): Promise<void> {
    return Promise.resolve(undefined)
  }

  /* This will clean up the cloned repo if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(this.clonePath, { recursive: true, force: true })
  }

  private async requiredFoldersExist(): Promise<boolean> {
    const folders = await readdir(this.clonePath)
    return folders.some((name) => name === this._expectedWorkflowDirectoryName) && folders.some((name) => name === this._expectedTargetDirectoryName)
  }
}
