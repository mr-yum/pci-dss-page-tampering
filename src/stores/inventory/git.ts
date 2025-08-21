import type { IInventoryStore } from '../../interfaces/inventory'
import type { GitInventoryStoreProps, Inventory } from '../../types/inventory'
import type { SimpleGit } from 'simple-git'

import fs from 'fs'
import { readFile } from '@mr-yum/mryum-yaml/dist/utilities/fs'
import { InventorySchema } from '../../types/zod'

export class GitInventoryStore implements IInventoryStore {
  private readonly _git: SimpleGit
  private readonly repositoryTarget: string
  private readonly clonePath: string

  private readonly _expectedWorkflowDirectoryName = 'workflows'
  private readonly _expectedTargetDirectoryName = 'targets'

  constructor(args: GitInventoryStoreProps) {
    this._git = args.gitClient
    this.repositoryTarget = args.repositoryTarget
    this.clonePath = args.clonePath
  }

  async pull(): Promise<Inventory[]> {
    // Clean up any existing clones
    this.cleanUpExistingClone()

    // Clone repository
    console.log(`[Store] Cloning repository '${this.repositoryTarget}' to path '${this.clonePath}'.`)
    await this._git.clone(this.repositoryTarget, this.clonePath)

    // Switch git context to checked out repository
    await this._git.cwd(this.clonePath)

    // Pull repository
    console.log(`[Store] Fetching from repository '${this.repositoryTarget}'.`)
    await this._git.fetch()

    // Checkout to testing branch
    const branch = 'feature/CAD-715_initial-inventory-payload'
    console.log(`[Store] Checking out to branch '${branch}'.`)
    await this._git.checkout(branch)

    // Ensure that the appropriate folders exist
    this.ensureRequiredFoldersExist()

    const getInventoryJson = JSON.parse(await readFile(`${this.clonePath}/${this._expectedTargetDirectoryName}/1.0.json`))
    const inventory = InventorySchema.parse(getInventoryJson)

    console.log(inventory)

    return Promise.resolve([])
  }

  // @ts-ignore
  async push(inventory: Inventory[]): Promise<void> {
    return Promise.resolve(undefined)
  }

  /* This will clean up the cloned repo if it exists to ensure that we always have a clean slate to work with */
  private cleanUpExistingClone(): void {
    if (fs.existsSync(this.clonePath)) {
      console.log(`[Store] Cleaning up existing clone found in path '${this.clonePath}'`)
      fs.rmSync(this.clonePath, { recursive: true, force: true })
    }
  }

  private ensureRequiredFoldersExist(): void {
    fs.readdir(this.clonePath, (_maybeError, files) => {
      console.log(`[Store] Discovered files and folders: '${files}'.`)
      if (!files.some((name) => name === this._expectedWorkflowDirectoryName) && !files.some((name) => name === this._expectedTargetDirectoryName)) {
        throw new Error(`[Store] Required folders not found! Please ensure that the following folders exist: '${this._expectedWorkflowDirectoryName}' and '${this._expectedTargetDirectoryName}'.`)
      }
    })
  }
}
