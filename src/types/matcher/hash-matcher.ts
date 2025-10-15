/**
 * HashMatcher Implementation
 *
 * Matches scripts by cryptographic hash (SHA-256).
 * Used for strict integrity verification of script content.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { InventoryScriptHashInfo } from '../inventory/model'
import type { Matcher, DetectedScript } from './matcher.interface'
import type { AuthorizationResult } from './authorization-result'

/**
 * Matches scripts by cryptographic hash (SHA-256).
 *
 * Use Cases:
 * - Strict integrity verification for external scripts
 * - Tracking hash history for scripts that change over time
 *
 * Behavior:
 * - identify(): Always returns false (hashes cannot identify, only authorize)
 * - authorize(): Computes SHA-256 hash of script.content, checks if in authorizedHashes array
 * - Returns false for null/empty content (cannot compute hash)
 *
 * Validation:
 * - authorizedHashes array must contain at least 1 hash (with timestamp)
 * - Each hash must have value (hex string) and timestamp
 */
export class HashMatcher implements Matcher {
  private readonly authorizedHashes: InventoryScriptHashInfo[]

  constructor(hashes: InventoryScriptHashInfo[]) {
    if (!hashes || hashes.length === 0) {
      throw new Error('HashMatcher requires at least one authorized hash')
    }
    this.authorizedHashes = hashes
  }

  getType(): 'hash' {
    return 'hash'
  }

  getPattern(): InventoryScriptHashInfo[] {
    return this.authorizedHashes
  }

  identify(_script: DetectedScript): boolean {
    // Hashes cannot identify scripts, only authorize them
    return false
  }

  authorize(script: DetectedScript): AuthorizationResult {
    if (!script.content || script.content.trim() === '') {
      return {
        authorized: false,
        reason: 'content is null or empty',
      }
    }

    // Check if the script's computed hash matches any authorized hash
    const isAuthorized = this.authorizedHashes.some((authorizedHashInfo) => authorizedHashInfo.hash.value === script.hash.value)

    return isAuthorized
      ? { authorized: true }
      : {
          authorized: false,
          reason: `hash ${script.hash.value} not in authorized list`,
        }
  }
}
