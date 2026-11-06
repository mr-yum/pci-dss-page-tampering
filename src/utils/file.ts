import { readdir, readFile } from 'fs/promises'

import type { MatcherRefSite, SharedMatchers } from '../types/inventory/matcher-ref.js'
import type { RawInventory } from '../types/inventory/raw.js'
import { RawInventorySchema } from '../types/inventory/zod.js'
import type { WorkflowDefinition } from '../types/workflow.js'
import { WorkflowDefinitionSchema } from '../types/workflow/zod.js'
import { SHARED_MATCHERS_FILE, SHARED_MATCHERS_PATH, TARGET_PATH } from './constants.js'
import { annotateMatcherRefIssues, expandMatcherRefs, parseSharedMatchers } from './matcher-ref.js'

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
export async function getRawInventoryFromFile(pathToFile: string, shared?: SharedMatchers): Promise<{ rawInventory: RawInventory; rawText: string; refSites: MatcherRefSite[] }> {
  const rawText = await readFile(pathToFile, 'utf8')

  // Refs are expanded before validation, so every schema refinement judges the
  // matcher that will actually run. @see ./matcher-ref.ts
  const { expanded, sites } = expandMatcherRefs(JSON.parse(rawText), shared, pathToFile.split('/').slice(-2).join('/'))

  try {
    return { rawInventory: RawInventorySchema.parse(expanded), rawText, refSites: sites }
  } catch (error) {
    throw annotateMatcherRefIssues(error, sites, shared)
  }
}

/**
 * Read `shared/matchers.json`, or `undefined` when the repository has none.
 *
 * The file is optional: an inventory with no refs needs nothing shared. Its
 * text is retained for the same reason a target's is — the clone is deleted at
 * the start of every pull, and the report cites line numbers in it.
 */
export async function getSharedMatchersFromFile(): Promise<SharedMatchers | undefined> {
  let text: string
  try {
    text = await readFile(SHARED_MATCHERS_PATH, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return parseSharedMatchers(text, SHARED_MATCHERS_FILE)
}

export async function getInventoryFileNames(): Promise<string[]> {
  return await readdir(TARGET_PATH)
}

async function parseJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8'))
}
