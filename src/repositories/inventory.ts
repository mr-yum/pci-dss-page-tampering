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

    const pullResult = await this.inventoryStore.pull()
    const payloads = pullResult.payloads

    const payloadsToProcess = payloads.map(async (payload): Promise<Inventory> => {
      const pathToWorkflowFile = `${WORKFLOW_PATH}/${payload.rawInventory.target.workflow}`
      const workflowDefinition = await getWorkflowDefinitionFromFile(pathToWorkflowFile)

      return {
        fileName: payload.fileName,
        target: {
          inventory: payload.rawInventory.target.inventory,
          detection: payload.rawInventory.target.detection,
          workflow: workflowDefinition,
        },
        scripts: payload.rawInventory.scripts,
      }
    })

    const processedPayloads = await Promise.all(payloadsToProcess)
    console.log(`[Inventory → Repository] Raw inventory successfully processed.`)

    return Promise.resolve(processedPayloads)
  }

  push(_inventory: Inventory): Promise<void> {
    return Promise.resolve(undefined)
  }

  /* This will clean up any cloned repos if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(GIT_CLONE_PATH, { recursive: true, force: true })
  }
}
