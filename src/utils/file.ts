import type { RawInventory } from '../types/inventory/raw'

import * as path from 'node:path'

import { readdir, readFile } from 'fs/promises'
import { RawInventorySchema } from '../types/inventory/zod'

export async function getRawInventoryFromDirectory(directoryPath: string): Promise<RawInventory[]> {
  // Read directory for inventory json files
  const filesWithPath = (await readdir(directoryPath)).map((filename) => path.join(directoryPath, filename))

  // Prepare to parse inventory files
  const getJsonDataFromFiles = filesWithPath.map((filename) => parseJson(filename))

  // Parse inventory files to get JSON data for mapping into raw model
  const parsedJsonFromFiles = await Promise.all(getJsonDataFromFiles)

  // Map to raw model and return
  return parsedJsonFromFiles.map((jsonData) => RawInventorySchema.parse(jsonData))
}

async function parseJson(filename: string): Promise<string> {
  return JSON.parse(await readFile(filename, 'utf8'))
}
