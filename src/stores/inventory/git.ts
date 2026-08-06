import { readdir } from 'fs/promises'
import type { SimpleGit } from 'simple-git'
import { simpleGit } from 'simple-git'

import type { IInventoryStore, InventoryPullOptions } from '../../interfaces/inventory.js'
import type { Inventory, InventoryPullResult, InventoryRef } from '../../types/inventory/model.js'
import type { GitInventoryStoreProps } from '../../types/inventory/props.js'
import { PullTarget } from '../../types/target.js'
import { GIT_CLONE_PATH, GIT_DETECTION_SCRIPTS_BRANCH_NAME, GIT_UPDATED_SCRIPTS_BRANCH_NAME, TARGET_DIRECTORY_NAME, TARGET_PATH, WORKFLOW_DIRECTORY_NAME } from '../../utils/constants.js'
import { getInventoryFileNames, getRawInventoryFromFile } from '../../utils/file.js'
import { redactRepositoryTarget, redactUrlCredentials } from '../../utils/url.js'

export class GitInventoryStore implements IInventoryStore {
  private readonly initialGitClient: SimpleGit
  private readonly repositoryTarget: string
  private readonly displayRepositoryTarget: string
  private readonly gitUserName: string
  private readonly gitUserEmail: string
  private readonly verifyBranchReplacement: ((branchName: string) => Promise<void>) | undefined
  private repositoryGitClient: SimpleGit | undefined
  private pushWithLease = false

  constructor(args: GitInventoryStoreProps) {
    this.initialGitClient = args.gitClient
    this.repositoryTarget = args.repositoryTarget
    this.displayRepositoryTarget = redactRepositoryTarget(args.repositoryTarget)
    this.gitUserName = args.gitUserName
    this.gitUserEmail = args.gitUserEmail
    this.verifyBranchReplacement = args.verifyBranchReplacement
  }

  async pull(target: PullTarget, branchName?: string, options: InventoryPullOptions = {}): Promise<InventoryPullResult> {
    // Clone repository
    console.log(`[Inventory → Store] Cloning repository '${this.displayRepositoryTarget}' to path '${GIT_CLONE_PATH}'.`)
    try {
      await this.initialGitClient.clone(this.repositoryTarget, GIT_CLONE_PATH)
    } catch (error) {
      throw this.sanitizedGitError(`Failed to clone repository '${this.displayRepositoryTarget}'`, error)
    }

    // Ensure that the appropriate folders exist
    if (!(await this.requiredFoldersExist())) {
      return Promise.reject(new Error(`[Inventory → Store] Required folders not found! Please ensure that the following folders exist: '${WORKFLOW_DIRECTORY_NAME}' and '${TARGET_DIRECTORY_NAME}'.`))
    }

    // Create new Git client which runs commands within clone path
    if (!this.repositoryGitClient) {
      this.repositoryGitClient = simpleGit(GIT_CLONE_PATH)
    }

    // Checkout branch (use provided branchName or fall back to constants)
    const targetBranch = branchName ?? (target === PullTarget.Inventory ? GIT_UPDATED_SCRIPTS_BRANCH_NAME : GIT_DETECTION_SCRIPTS_BRANCH_NAME)
    await this.switchBranch(this.repositoryGitClient, targetBranch, options)

    // Get and return raw inventory from files
    console.log(`[Inventory → Store] Reading and returning raw inventory.`)
    const files = await getInventoryFileNames()

    // Read and return raw inventory + filename
    const pullResponse = await Promise.all(
      files.map(async (fileName) => {
        const filePath = `${TARGET_PATH}/${fileName}`

        try {
          const { rawInventory, rawText } = await getRawInventoryFromFile(filePath)
          return {
            fileName: fileName,
            rawInventory: rawInventory,
            rawText: rawText,
          }
        } catch (error) {
          // Enhanced error message with file context for Zod validation failures
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new Error(`[Inventory → Store] Validation failed for inventory file '${fileName}': ${errorMessage}`, { cause: error })
        }
      }),
    )

    return {
      payloads: pullResponse,
      ...(await this.readInventoryRef(targetBranch)),
    }
  }

  /**
   * Read the revision this pull is reading from, for the auditor report.
   *
   * Best-effort: a repository that cannot report a revision still yields a
   * usable inventory, and losing the commit id must never fail a run.
   */
  private async readInventoryRef(branch: string): Promise<{ ref?: InventoryRef }> {
    try {
      const client = this.repositoryGitClient ?? simpleGit(GIT_CLONE_PATH)
      const commitSha = (await client.revparse(['HEAD'])).trim()
      const latest = (await client.log(['-1'])).latest

      return { ref: { branch, commitSha, commitIsoDate: latest?.date === undefined ? null : new Date(latest.date).toISOString() } }
    } catch (error) {
      console.log(`[Inventory → Store] Could not read the inventory revision: ${error instanceof Error ? error.message : String(error)}`)

      return {}
    }
  }

  async push(_inventory: Inventory[], branchName?: string, commitMessage?: string): Promise<void> {
    console.log(`[Inventory → Store] Setting user.name and user.email for the local repo.`)
    await this.repositoryGitClient?.addConfig('user.name', this.gitUserName)
    await this.repositoryGitClient?.addConfig('user.email', this.gitUserEmail)

    console.log(`[Inventory → Store] Adding all changed files found in '${GIT_CLONE_PATH}'.`)
    await this.repositoryGitClient?.add('.')

    const resolvedMessage = commitMessage ?? 'inventory: update'
    console.log(`[Inventory → Store] Committing changes with message '${resolvedMessage}'`)
    await this.repositoryGitClient?.commit(resolvedMessage)

    const targetBranch = branchName ?? GIT_UPDATED_SCRIPTS_BRANCH_NAME
    console.log(`[Inventory → Store] Pushing changes to branch '${targetBranch}'`)
    try {
      if (this.pushWithLease) {
        // PR state may have changed during a long browser run. Revalidate as
        // close to the force-with-lease push as possible so a newly reviewed
        // branch is not replaced merely because its Git ref is unchanged.
        if (!this.verifyBranchReplacement) {
          throw new Error(`Refusing to replace branch '${targetBranch}' without a branch-review state verifier`)
        }
        await this.verifyBranchReplacement(targetBranch)
        await this.repositoryGitClient?.push('origin', targetBranch, ['--force-with-lease'])
      } else {
        await this.repositoryGitClient?.push('origin', targetBranch)
      }
    } catch (error) {
      throw this.sanitizedGitError(`Failed to push repository '${this.displayRepositoryTarget}'`, error)
    }

    return Promise.resolve()
  }

  private async requiredFoldersExist(): Promise<boolean> {
    const folders = await readdir(GIT_CLONE_PATH)
    return folders.some((name) => name === WORKFLOW_DIRECTORY_NAME) && folders.some((name) => name === TARGET_DIRECTORY_NAME)
  }

  private async switchBranch(gitClient: SimpleGit, branchName: string, options: InventoryPullOptions): Promise<void> {
    try {
      this.pushWithLease = false
      // Fetch to make sure we have the latest remote information
      console.log(`[Inventory → Store] Fetching from repository '${this.displayRepositoryTarget}'.`)
      await gitClient.fetch()

      // Get a list of all branches (local and remote)
      const branches = await gitClient.branch()

      // Check if the branch exists on the remote 'origin'
      const remoteBranch = `remotes/origin/${branchName}`

      if (options.resetToBase === true) {
        const baseBranchName = options.baseBranchName
        if (!baseBranchName) throw new Error(`Cannot reset branch '${branchName}' without a base branch`)
        const remoteBaseBranch = `remotes/origin/${baseBranchName}`
        if (!branches.all.includes(remoteBaseBranch)) throw new Error(`Base branch '${baseBranchName}' was not found on remote 'origin'`)

        console.log(`[Inventory → Store] Starting branch '${branchName}' from current base branch '${baseBranchName}'.`)
        this.pushWithLease = branches.all.includes(remoteBranch)
        await gitClient.checkout(['-B', branchName, `origin/${baseBranchName}`])
        return
      }

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
        const baseBranchName = options.baseBranchName ?? 'main'
        await gitClient.checkoutBranch(branchName, `origin/${baseBranchName}`)
      }
    } catch (error) {
      throw this.sanitizedGitError(`Failed to switch to branch '${branchName}'`, error)
    }
  }

  private sanitizeGitErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return redactUrlCredentials(message)
  }

  private sanitizedGitError(context: string, error: unknown): Error {
    return new Error(`[Inventory → Store] ${context}: ${this.sanitizeGitErrorMessage(error)}`)
  }
}
