/**
 * HashMatcher Implementation
 *
 * Matches scripts by cryptographic hash (SHA-256).
 * Used for strict integrity verification of script content.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { SHA256Hash } from '../hash'
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
 * - authorizedHashes array must contain at least 1 hash
 * - Each hash must have value (hex string)
 */
export class HashMatcher implements Matcher {
  private readonly authorizedHashes: SHA256Hash[]

  constructor(hashes: SHA256Hash[]) {
    if (!hashes || hashes.length === 0) {
      throw new Error('HashMatcher requires at least one authorized hash')
    }
    this.authorizedHashes = hashes
  }

  getType(): 'hash' {
    return 'hash'
  }

  getPattern(): SHA256Hash[] {
    return this.authorizedHashes
  }

  identify(script: DetectedScript): boolean {
    // Hashes cannot identify scripts, only authorize them
    return false
  }

  authorize(script: DetectedScript): AuthorizationResult {
    if (!script.content || script.content.trim() === '') {
      return {
        authorized: false,
        reason: 'content is null or empty'
      }
    }

    // Check if the script's computed hash matches any authorized hash
    const isAuthorized = this.authorizedHashes.some(
      (authorizedHash) => authorizedHash.value === script.hash.value
    )

    return isAuthorized
      ? { authorized: true }
      : {
          authorized: false,
          reason: `hash ${script.hash.value} not in authorized list`
        }
  }
}
