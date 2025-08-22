import type { IInventoryStore, IScriptInventoryRepository } from '../interfaces/inventory'
import type { Inventory } from '../types/inventory/model'
import type { InventoryRepositoryProps } from '../types/inventory/props'

import { getWorkflowDefinitionFromFile } from '../utils/file'
import { WORKFLOW_PATH } from '../utils/constants'

export class ScriptInventoryRepository implements IScriptInventoryRepository {
  private readonly inventoryStore: IInventoryStore

  constructor(args: InventoryRepositoryProps) {
    this.inventoryStore = args.inventoryStore
  }

  async pull(): Promise<Inventory[]> {
    const rawInventory = await this.inventoryStore.pull()

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

    return Promise.resolve(processedInventories)
  }

  push(_inventory: Inventory): Promise<void> {
    return Promise.resolve(undefined)
  }
}
