import { rm, writeFile } from 'fs/promises'

import type { IInventoryStore, InventoryPushResult, IScriptInventoryRepository } from '../interfaces/inventory.js'
import type { Inventory } from '../types/inventory/model.js'
import type { InventoryRepositoryProps } from '../types/inventory/props.js'
import type { PullTarget } from '../types/target.js'
import { GIT_CLONE_PATH, TARGET_PATH } from '../utils/constants.js'
import { inventoryToRawInventory, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory.js'
import { createTargetLogger } from '../utils/logger.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script.js'
import { getWorkflowFromFile } from '../utils/workflow.js'

export class ScriptInventoryRepository implements IScriptInventoryRepository {
  private readonly inventoryStore: IInventoryStore

  constructor(args: InventoryRepositoryProps) {
    this.inventoryStore = args.inventoryStore
  }

  async pull(target: PullTarget, branchName?: string): Promise<Inventory[]> {
    // Clean up any existing clones
    console.log(`[Inventory → Repository] Removing any existing clones from path '${GIT_CLONE_PATH}'.`)
    await this.cleanUpExistingClone()

    const pullResult = await this.inventoryStore.pull(target, branchName)
    const payloads = pullResult.payloads

    const payloadsToProcess = payloads.map(async (payload): Promise<Inventory> => {
      const inventoryWorkflow = await getWorkflowFromFile(payload.rawInventory.target.inventory.workflow)
      const detectionWorkflow = await getWorkflowFromFile(payload.rawInventory.target.detection.workflow)

      // Default name to filename (without .json extension) if not specified
      const defaultName = payload.fileName.replace(/\.json$/, '')
      const inventoryName = payload.rawInventory.target.inventory.name ?? defaultName
      const detectionName = payload.rawInventory.target.detection.name ?? defaultName

      const inventoryTarget = {
        type: payload.rawInventory.target.inventory.type,
        name: inventoryName,
        url: payload.rawInventory.target.inventory.url,
        workflow: inventoryWorkflow,
        logger: createTargetLogger({
          type: payload.rawInventory.target.inventory.type,
          name: inventoryName,
          url: payload.rawInventory.target.inventory.url,
          workflow: inventoryWorkflow,
          logger: undefined as any, // Temporary for creating logger
        }),
      }

      const detectionTarget = {
        type: payload.rawInventory.target.detection.type,
        name: detectionName,
        url: payload.rawInventory.target.detection.url,
        workflow: detectionWorkflow,
        logger: createTargetLogger({
          type: payload.rawInventory.target.detection.type,
          name: detectionName,
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

  async push(inventories: Inventory[], branchName?: string, commitMessage?: string): Promise<InventoryPushResult> {
    const rawInventories = inventories.map((inventory) => {
      return {
        fileName: inventory.fileName,
        rawInventory: inventoryToRawInventory(inventory),
      }
    })

    await Promise.all(
      rawInventories.map(async (inventory) => {
        const filePath = `${TARGET_PATH}/${inventory.fileName}`
        const jsonString = JSON.stringify(inventory.rawInventory, null, 2)

        console.log(`[Inventory → Repository] Cleaning up old inventory payload '${inventory.fileName}'.`)
        await rm(filePath)

        console.log(`[Inventory → Repository] Writing new inventory payload '${inventory.fileName}'.`)
        await writeFile(filePath, jsonString)
      }),
    )

    await this.inventoryStore.push(inventories, branchName, commitMessage)

    // The service only calls us with a non-null commitMessage (no-op commits are
    // filtered out upstream), so reaching here means a push did occur.
    return commitMessage ? { pushed: true, commitMessage } : { pushed: false }
  }

  /* This will clean up any cloned repos if it exists to ensure that we always have a clean slate to work with */
  private async cleanUpExistingClone(): Promise<void> {
    await rm(GIT_CLONE_PATH, { recursive: true, force: true })
  }
}
