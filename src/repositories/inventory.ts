import { rm, writeFile } from 'fs/promises'

import type { IInventoryStore, InventoryPullOptions, InventoryPushResult, IScriptInventoryRepository } from '../interfaces/inventory.js'
import type { Inventory, InventoryWorkflow } from '../types/inventory/model.js'
import type { InventoryRepositoryProps } from '../types/inventory/props.js'
import type { RawInventoryWorkflow } from '../types/inventory/raw.js'
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

  async pull(target: PullTarget, branchName?: string, options?: InventoryPullOptions): Promise<Inventory[]> {
    // Clean up any existing clones
    console.log(`[Inventory → Repository] Removing any existing clones from path '${GIT_CLONE_PATH}'.`)
    await this.cleanUpExistingClone()

    const pullResult = await this.inventoryStore.pull(target, branchName, options)
    const payloads = pullResult.payloads

    const payloadsToProcess = payloads.map(async (payload): Promise<Inventory> => {
      // Default name to filename (without .json extension) if not specified
      const defaultName = payload.fileName.replace(/\.json$/, '')

      const processWorkflow = async (rawWorkflow: RawInventoryWorkflow): Promise<InventoryWorkflow> => {
        const inventoryWorkflow = await getWorkflowFromFile(rawWorkflow.inventory.workflow)
        const detectionWorkflow = await getWorkflowFromFile(rawWorkflow.detection.workflow)
        const workflowDefaultName = rawWorkflow.id === 'default' ? defaultName : `${defaultName}/${rawWorkflow.id}`
        const inventoryName = rawWorkflow.inventory.name ?? workflowDefaultName
        const detectionName = rawWorkflow.detection.name ?? workflowDefaultName

        const inventoryTarget = {
          type: rawWorkflow.inventory.type,
          workflowId: rawWorkflow.id,
          name: inventoryName,
          url: rawWorkflow.inventory.url,
          workflow: inventoryWorkflow,
          logger: createTargetLogger({
            type: rawWorkflow.inventory.type,
            workflowId: rawWorkflow.id,
            name: inventoryName,
            url: rawWorkflow.inventory.url,
            workflow: inventoryWorkflow,
            logger: undefined as any, // Temporary for creating logger
          }),
        }

        const detectionTarget = {
          type: rawWorkflow.detection.type,
          workflowId: rawWorkflow.id,
          name: detectionName,
          url: rawWorkflow.detection.url,
          workflow: detectionWorkflow,
          logger: createTargetLogger({
            type: rawWorkflow.detection.type,
            workflowId: rawWorkflow.id,
            name: detectionName,
            url: rawWorkflow.detection.url,
            workflow: detectionWorkflow,
            logger: undefined as any, // Temporary for creating logger
          }),
        }

        return { id: rawWorkflow.id, inventory: inventoryTarget, detection: detectionTarget }
      }

      const rawTarget = payload.rawInventory.target
      const rawWorkflows: RawInventoryWorkflow[] = rawTarget.workflows !== undefined ? rawTarget.workflows : [{ id: 'default', inventory: rawTarget.inventory, detection: rawTarget.detection }]
      const workflows = await Promise.all(rawWorkflows.map(processWorkflow))

      return {
        fileName: payload.fileName,
        alerts: payload.rawInventory.alerts,
        target:
          rawTarget.workflows !== undefined
            ? { workflows }
            : {
                inventory: workflows[0]!.inventory,
                detection: workflows[0]!.detection,
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
