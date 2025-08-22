import type { IInventoryStore } from '../../interfaces/inventory'
import type { Inventory, InventoryPullResult } from '../../types/inventory/model'
import type { GitInventoryStoreProps } from '../../types/inventory/props'
import type { SimpleGit } from 'simple-git'

import { simpleGit } from 'simple-git'
import { readdir } from 'fs/promises'
import { getInventoryFileNames, getRawInventoryFromFile } from '../../utils/file'
import { GIT_CLONE_PATH, GIT_UPDATED_SCRIPTS_BRANCH_NAME, TARGET_DIRECTORY_NAME, TARGET_PATH, WORKFLOW_DIRECTORY_NAME } from '../../utils/constants'

export class GitInventoryStore implements IInventoryStore {
  private readonly initialGitClient: SimpleGit
  private readonly repositoryTarget: string

  constructor(args: GitInventoryStoreProps) {
    this.initialGitClient = args.gitClient
    this.repositoryTarget = args.repositoryTarget
  }

  async pull(): Promise<InventoryPullResult> {
    // Clone repository
    console.log(`[Inventory → Store] Cloning repository '${this.repositoryTarget}' to path '${GIT_CLONE_PATH}'.`)
    await this.initialGitClient.clone(this.repositoryTarget, GIT_CLONE_PATH)

    // Ensure that the appropriate folders exist
    if (!(await this.requiredFoldersExist())) {
      return Promise.reject(new Error(`[Inventory → Store] Required folders not found! Please ensure that the following folders exist: '${WORKFLOW_DIRECTORY_NAME}' and '${TARGET_DIRECTORY_NAME}'.`))
    }

    // Create new Git client which runs commands within clone path
    const repositoryGitClient = simpleGit(GIT_CLONE_PATH)

    // Checkout branch
    await this.switchBranch(repositoryGitClient, GIT_UPDATED_SCRIPTS_BRANCH_NAME)

    // Get and return raw inventory from files
    console.log(`[Inventory → Store] Reading and returning raw inventory.`)
    const files = await getInventoryFileNames()

    // Read and return raw inventory + filename
    const pullResponse = await Promise.all(
      files.map(async (fileName) => {
        const filePath = `${TARGET_PATH}/${fileName}`
        const rawInventory = await getRawInventoryFromFile(filePath)

        return {
          fileName: fileName,
          rawInventory: rawInventory,
        }
      }),
    )

    return {
      payloads: pullResponse,
    }
  }

  // @ts-ignore
  async push(inventory: Inventory[]): Promise<void> {
    return Promise.resolve(undefined)
  }

  private async requiredFoldersExist(): Promise<boolean> {
    const folders = await readdir(GIT_CLONE_PATH)
    return folders.some((name) => name === WORKFLOW_DIRECTORY_NAME) && folders.some((name) => name === TARGET_DIRECTORY_NAME)
  }

  private async switchBranch(gitClient: SimpleGit, branchName: string): Promise<void> {
    try {
      // Fetch to make sure we have the latest remote information
      console.log(`[Inventory → Store] Fetching from repository '${this.repositoryTarget}'.`)
      await gitClient.fetch()

      // Get a list of all branches (local and remote)
      const branches = await gitClient.branch()

      // Check if the branch exists on the remote 'origin'
      const remoteBranch = `remotes/origin/${branchName}`

      // Switch to remote branch if exists
      if (branches.all.includes(remoteBranch)) {
        console.log(`[Inventory → Store] Branch '${branchName}' found on remote, switching to branch.`)
        await gitClient.checkout(branchName)
      }
      // Switch to local branch if exists
      else if (branches.all.includes(branchName)) {
        console.log(`[Inventory → Store] Branch '${branchName}' found locally, switching to branch.`)
        await gitClient.checkout(branchName)
      }
      // Create and switch to new branch if neither exist
      else {
        console.log(`[Inventory → Store] Branch '${branchName}' not found locally or on remote, checkout out to new branch.`)
        await gitClient.checkoutBranch(branchName, 'origin/main')
      }
    } catch (error) {
      console.error('[Inventory → Store] An error occurred: ', error)
    }
  }
}
