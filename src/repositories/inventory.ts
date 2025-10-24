import { rm, writeFile } from 'fs/promises'

import type { IInventoryStore, IScriptInventoryRepository } from '../interfaces/inventory'
import type { Inventory } from '../types/inventory/model'
import type { InventoryRepositoryProps } from '../types/inventory/props'
import type { PullTarget } from '../types/target'
import { GIT_CLONE_PATH, TARGET_PATH } from '../utils/constants'
import { inventoryToRawInventory, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory'
import { createTargetLogger } from '../utils/logger'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script'
import { getWorkflowFromFile } from '../utils/workflow'

export class ScriptInventoryRepository implements IScriptInventoryRepository {
  private readonly inventoryStore: IInventoryStore

  constructor(args: InventoryRepositoryProps) {
    this.inventoryStore = args.inventoryStore
  }

  async pull(target: PullTarget): Promise<Inventory[]> {
    // Clean up any existing clones
    console.log(`[Inventory → Repository] Removing any existing clones from path '${GIT_CLONE_PATH}'.`)
    await this.cleanUpExistingClone()

    const pullResult = await this.inventoryStore.pull(target)
    const payloads = pullResult.payloads

    const payloadsToProcess = payloads.map(async (payload): Promise<Inventory> => {
      const inventoryWorkflow = await getWorkflowFromFile(payload.rawInventory.target.inventory.workflow)
      const detectionWorkflow = await getWorkflowFromFile(payload.rawInventory.target.detection.workflow)

      const inventoryTarget = {
        type: payload.rawInventory.target.inventory.type,
        url: payload.rawInventory.target.inventory.url,
        workflow: inventoryWorkflow,
        logger: createTargetLogger({
          type: payload.rawInventory.target.inventory.type,
          url: payload.rawInventory.target.inventory.url,
          workflow: inventoryWorkflow,
          logger: undefined as any, // Temporary for creating logger
        }),
      }

      const detectionTarget = {
        type: payload.rawInventory.target.detection.type,
        url: payload.rawInventory.target.detection.url,
        workflow: detectionWorkflow,
        logger: createTargetLogger({
          type: payload.rawInventory.target.detection.type,
          url: payload.rawInventory.target.detection.url,
          workflow: detectionWorkflow,
          logger: undefined as any, // Temporary for creating logger
        }),
      }

      return {
        fileName: payload.fileName,
        alerts: payload.rawInventory.alerts,
        target: {
          inventory: inventoryTarget,
          detection: detectionTarget,
        },
        scripts: payload.rawInventory.scripts.map(rawInventoryScriptInfoToInventoryScriptInfo),
        headers: (payload.rawInventory.headers || []).map(rawInventoryHeaderInfoToInventoryHeaderInfo),
      }
    })

    const processedPayloads = await Promise.all(payloadsToProcess)
    console.log(`[Inventory → Repository] Raw inventory successfully processed.`)

    return Promise.resolve(processedPayloads)
  }

  push(inventories: Inventory[]): Promise<void> {
    const rawInventories = inventories.map((inventory) => {
      return {
        fileName: inventory.fileName,
        rawInventory: inventoryToRawInventory(inventory),
      }
    })

    rawInventories.forEach(async (inventory) => {
      const filePath = `${TARGET_PATH}/${inventory.fileName}`
      const jsonString = JSON.stringify(inventory.rawInventory, null, 2)

      console.log(`[Inventory → Repository] Cleaning up old inventory payload '${inventory.fileName}'.`)
      await rm(filePath)

      console.log(`[Inventory → Repository] Writing new inventory payload '${inventory.fileName}'.`)
      await writeFile(filePath, jsonString)
    })

    return this.inventoryStore.push(inventories)
  }

  /* This will clean up any cloned repos if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(GIT_CLONE_PATH, { recursive: true, force: true })
  }
}
