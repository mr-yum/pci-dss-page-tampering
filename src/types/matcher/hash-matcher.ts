/**
 * HashMatcher Implementation
 *
 * Matches scripts by cryptographic hash (SHA-256).
 * Used for strict integrity verification of script content.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { InventoryScriptHashInfo } from '../inventory/model'
import type { AuthorizationResult } from './authorization-result'
import type { DetectedScript,Matcher } from './matcher.interface'

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

  /**
   * Creates a new HashMatcher with an array of authorized hash values.
   *
   * @param hashes - Array of authorized hashes with timestamps (must have at least 1 entry)
   * @throws {Error} If hashes array is empty or null
   */
  constructor(hashes: InventoryScriptHashInfo[]) {
    if (!hashes || hashes.length === 0) {
      throw new Error('HashMatcher requires at least one authorized hash')
    }
    this.authorizedHashes = hashes
  }

  /**
   * Returns the matcher type discriminator.
   *
   * @returns The string 'hash' for type-based dispatch
   */
  getType(): 'hash' {
    return 'hash'
  }

  /**
   * Returns the array of authorized hashes for logging and debugging.
   *
   * @returns The authorized hashes with timestamps
   */
  getPattern(): InventoryScriptHashInfo[] {
    return this.authorizedHashes
  }

  /**
   * Identifies scripts - always returns false for HashMatcher.
   * Hashes cannot identify scripts (requires known content), only authorize them.
   *
   * @param _script - The detected script (unused)
   * @returns Always false - use NameMatcher or ContentMatcher for identification
   */
  identify(_script: DetectedScript): boolean {
    // Hashes cannot identify scripts, only authorize them
    return false
  }

  /**
   * Authorizes a detected script by comparing its computed hash against authorized hashes.
   * Uses SHA-256 hash comparison for cryptographic integrity verification.
   *
   * @param script - The detected script with pre-computed hash
   * @returns AuthorizationResult with authorized=true if hash matches any authorized hash, authorized=false with reason otherwise
   */
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
