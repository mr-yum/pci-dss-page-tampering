import type { IInventoryStore, IScriptInventoryRepository } from '../interfaces/inventory'
import type { Inventory } from '../types/inventory/model'
import type { InventoryRepositoryProps } from '../types/inventory/props'

import { getWorkflowDefinitionFromFile } from '../utils/file'
import { GIT_CLONE_PATH, WORKFLOW_PATH } from '../utils/constants'
import { rm } from 'fs/promises'

export class ScriptInventoryRepository implements IScriptInventoryRepository {
  private readonly inventoryStore: IInventoryStore

  constructor(args: InventoryRepositoryProps) {
    this.inventoryStore = args.inventoryStore
  }

  async pull(): Promise<Inventory[]> {
    // Clean up any existing clones
    console.log(`[Inventory → Repository] Removing any existing clones from path '${GIT_CLONE_PATH}'.`)
    await this.cleanUpExistingClone()

    const rawInventory = await this.inventoryStore.pull()

    console.log(`[Inventory → Repository] Processing raw inventory.`)
    const processedInventories = await Promise.all(
      rawInventory.map(async (rawInventory) => {
        const pathToWorkflowFile = `${WORKFLOW_PATH}/${rawInventory.target.workflow}`
        const workflowDefinition = await getWorkflowDefinitionFromFile(pathToWorkflowFile)
        return {
          target: {
            inventory: rawInventory.target.inventory,
            detection: rawInventory.target.detection,
            workflow: workflowDefinition,
          },
          scripts: rawInventory.scripts,
        }
      }),
    )

    console.log(`[Inventory → Repository] Raw inventory successfully processed.`)
    return Promise.resolve(processedInventories)
  }

  push(_inventory: Inventory): Promise<void> {
    return Promise.resolve(undefined)
  }

  /* This will clean up any cloned repos if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(GIT_CLONE_PATH, { recursive: true, force: true })
  }
}
