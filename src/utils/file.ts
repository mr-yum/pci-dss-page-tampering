import type { RawInventory } from '../types/inventory/raw'
import type { WorkflowDefinition } from '../types/workflow'

import { readdir, readFile } from 'fs/promises'
import { RawInventorySchema } from '../types/inventory/zod'
import { WorkflowDefinitionSchema } from '../types/zod'
import { TARGET_PATH } from './constants'

export async function getWorkflowDefinitionFromFile(pathToFile: string): Promise<WorkflowDefinition> {
  // Get JSON data from workflow definition file
  const jsonData = await parseJson(pathToFile)

  // Map to workflow definition and return
  return WorkflowDefinitionSchema.parse(jsonData)
}

export async function getRawInventoryFromFile(pathToFile: string): Promise<RawInventory> {
  // Get JSON data from workflow definition file
  const jsonData = await parseJson(pathToFile)

  // Map to workflow definition and return
  return RawInventorySchema.parse(jsonData)
}

export async function getInventoryFileNames(): Promise<string[]> {
  return await readdir(TARGET_PATH)
}

async function parseJson(filename: string): Promise<string> {
  return JSON.parse(await readFile(filename, 'utf8'))
}
