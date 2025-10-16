import { createHash } from 'crypto'

import type { SHA256Hash } from '../types/hash'
import type { InventoryScriptHashInfo } from '../types/inventory/model'
import type { ScriptInfo } from '../types/script'

/**
 * Calculates the SHA-256 hash of a given string.
 * @param content The string to hash.
 * @returns The SHA-256 hash as a hex string.
 */
export function createSha256Hash(content: string): SHA256Hash {
  return {
    value: createHash('sha256').update(content).digest('hex'),
  }
}

export function scriptHashToInventoryHashInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptHashInfo {
  return {
    timestamp: date,
    hash: scriptInfo.hash,
  }
}
