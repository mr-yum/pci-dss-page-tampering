import { readdir, readFile } from 'fs/promises'

import type { RawInventory } from '../types/inventory/raw.js'
import { RawInventorySchema } from '../types/inventory/zod.js'
import type { WorkflowDefinition } from '../types/workflow.js'
import { WorkflowDefinitionSchema } from '../types/workflow/zod.js'
import { TARGET_PATH } from './constants.js'

export async function getWorkflowDefinitionFromFile(pathToFile: string): Promise<WorkflowDefinition> {
  // Get JSON data from workflow definition file
  const jsonData = await parseJson(pathToFile)

  // Map to workflow definition and return
  return WorkflowDefinitionSchema.parse(jsonData)
}

/**
 * Read and validate an inventory file, returning the validated model alongside
 * the exact bytes it was parsed from.
 *
 * The raw text is retained because the auditor report has to report the line
 * number an authorisation lives on, and it cannot be recovered later: the
 * validated model has unknown keys stripped and timestamps coerced to `Date`
 * by Zod, and the clone directory is deleted at the start of every pull.
 *
 * @see ../utils/json-position.ts for the consumer that turns text into positions
 */
export async function getRawInventoryFromFile(pathToFile: string): Promise<{ rawInventory: RawInventory; rawText: string }> {
  const rawText = await readFile(pathToFile, 'utf8')

  return { rawInventory: RawInventorySchema.parse(JSON.parse(rawText)), rawText }
}

export async function getInventoryFileNames(): Promise<string[]> {
  return await readdir(TARGET_PATH)
}

async function parseJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8'))
}
