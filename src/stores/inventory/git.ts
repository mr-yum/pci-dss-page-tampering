import type { IInventoryStore } from '../../interfaces/inventory'
import type { Inventory } from '../../types/inventory/model'
import type { GitInventoryStoreProps } from '../../types/inventory/props'
import type { SimpleGit } from 'simple-git'
import type { RawInventory } from '../../types/inventory/raw'

import { simpleGit } from 'simple-git'
import { rm, readdir } from 'fs/promises'
import { getRawInventoryFromDirectory } from '../../utils/file'
import { GIT_CLONE_PATH, TARGET_DIRECTORY_NAME, TARGET_PATH, WORKFLOW_DIRECTORY_NAME } from '../../utils/constants'

export class GitInventoryStore implements IInventoryStore {
  private readonly initialGitClient: SimpleGit
  private readonly repositoryTarget: string

  constructor(args: GitInventoryStoreProps) {
    this.initialGitClient = args.gitClient
    this.repositoryTarget = args.repositoryTarget
  }

  async pull(): Promise<RawInventory[]> {
    // Clean up any existing clones
    console.log(`[Store] Removing any existing clones with path '${GIT_CLONE_PATH}'.`)
    await this.cleanUpExistingClone()

    // Clone repository
    console.log(`[Store] Cloning repository '${this.repositoryTarget}' to path '${GIT_CLONE_PATH}'.`)
    await this.initialGitClient.clone(this.repositoryTarget, GIT_CLONE_PATH)

    // Ensure that the appropriate folders exist
    if (!(await this.requiredFoldersExist())) {
      return Promise.reject(new Error(`[Store] Required folders not found! Please ensure that the following folders exist: '${WORKFLOW_DIRECTORY_NAME}' and '${TARGET_DIRECTORY_NAME}'.`))
    }

    // Create new Git client which runs commands within clone path
    const repositoryGitClient = simpleGit(GIT_CLONE_PATH)

    // Pull repository
    console.log(`[Store] Fetching from repository '${this.repositoryTarget}'.`)
    await repositoryGitClient.fetch()

    // Checkout to testing branch
    const branch = 'feature/CAD-715_initial-inventory-payload'
    console.log(`[Store] Checking out to branch '${branch}'.`)
    await repositoryGitClient.checkout(branch)

    // Get and return raw inventory from files
    console.log(`[Store] Reading and returning raw inventory. '${branch}'.`)
    return await getRawInventoryFromDirectory(TARGET_PATH)
  }

  // @ts-ignore
  async push(inventory: Inventory[]): Promise<void> {
    return Promise.resolve(undefined)
  }

  /* This will clean up the cloned repo if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(GIT_CLONE_PATH, { recursive: true, force: true })
  }

  private async requiredFoldersExist(): Promise<boolean> {
    const folders = await readdir(GIT_CLONE_PATH)
    return folders.some((name) => name === WORKFLOW_DIRECTORY_NAME) && folders.some((name) => name === TARGET_DIRECTORY_NAME)
  }
}
