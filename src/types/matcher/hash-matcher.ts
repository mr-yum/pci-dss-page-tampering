/**
 * HashMatcher Implementation
 *
 * Matches scripts by cryptographic hash (SHA-256).
 * Used for strict integrity verification of script content.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { InventoryScriptHashInfo } from '../inventory/model.js'
import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorizationTraceStep, AuthorizeOptions } from './authorization-trace.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

/**
 * Matches scripts by cryptographic hash (SHA-256).
 *
 * Use Cases:
 * - Strict integrity verification for external scripts
 * - Tracking hash history for scripts that change over time
 *
 * Behavior:
 * - identify(): Matches the script's pre-computed hash. Prefer a stable
 *   name/content/provenance matcher for inventory identification so changed
 *   bytes remain associated with the known script.
 * - authorize(): Compares the script's pre-computed SHA-256 hash (computed from
 *   the response body at detection time) against the authorizedHashes array
 * - Returns false for null/empty content (fail-secure: no content, no trust)
 *
 * Validation:
 * - authorizedHashes array must contain at least 1 hash (with timestamp)
 * - Each hash must have value (hex string) and timestamp
 */
export class HashMatcher implements AuthorisationMatcher<Matchable> {
  private readonly authorizedHashes: InventoryScriptHashInfo[]
  private readonly authorisationInfo: AuthorisationInfo | undefined

  /**
   * Creates a new HashMatcher with an array of authorized hash values.
   *
   * @param hashes - Array of authorized hashes with timestamps (must have at least 1 entry)
   * @param authorisationInfo - Optional authorization metadata
   * @throws {Error} If hashes array is empty or null
   */
  constructor(hashes: InventoryScriptHashInfo[], authorisationInfo: AuthorisationInfo | undefined = undefined) {
    if (!hashes || hashes.length === 0) {
      throw new Error('HashMatcher requires at least one authorized hash')
    }
    this.authorizedHashes = hashes
    this.authorisationInfo = authorisationInfo
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
   * Returns a human-readable description for logging.
   *
   * @returns Formatted string like "hash:3 authorized hashes"
   */
  getDescription(): string {
    const count = this.authorizedHashes.length
    return `hash:${count} authorized ${count === 1 ? 'hash' : 'hashes'}`
  }

  /**
   * Returns the authorization metadata for this matcher.
   *
   * @returns Authorization metadata if present, undefined otherwise
   */
  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  /**
   * Identifies an exact script body using its pre-computed hash.
   *
   * Hash identification is supported for policies that deliberately treat a
   * byte-for-byte version as the resource identity. Most inventory entries
   * should instead identify by stable name/content/provenance and reserve the
   * hash for authorization, so a changed body is reported as a known script
   * with unauthorized content rather than as an unknown script.
   *
   * @param script - The detected resource with an optional pre-computed hash
   * @returns true when the script has non-empty content and its hash is listed
   */
  identify(script: Matchable): boolean {
    const hash = script.hash
    if (!script.content || script.content.trim() === '' || !hash) {
      return false
    }
    return this.authorizedHashes.some((authorizedHashInfo) => authorizedHashInfo.hash.value === hash.value)
  }

  /**
   * Authorizes a detected script by comparing its computed hash against authorized hashes.
   * Uses SHA-256 hash comparison for cryptographic integrity verification.
   *
   * @param script - The detected script with pre-computed hash
   * @returns AuthorizationResult with authorized=true if hash matches any authorized hash, authorized=false with reason otherwise
   */
  authorize(script: Matchable, options?: AuthorizeOptions): AuthorizationResult {
    // Descriptive only — `withTrace` never changes a decision, and returns the
    // result untouched unless the caller opted in.
    const withTrace = (result: AuthorizationResult, consulted: readonly AuthorizationTraceStep[]): AuthorizationResult => {
      if (!options?.collectTrace) return result

      return { ...result, trace: { type: 'hash', consulted } }
    }

    if (!script.content || script.content.trim() === '') {
      return withTrace(
        {
          authorized: false,
          reason: 'content is null or empty',
        },
        [],
      )
    }

    const hash = script.hash
    if (!hash) {
      return withTrace(
        {
          authorized: false,
          reason: 'hash is missing',
        },
        [],
      )
    }

    if (this.authorisationInfo?.authorised === false) {
      return withTrace(
        {
          authorized: false,
          reason: `Top-level authorization denied: ${this.authorisationInfo.description}`,
          metadataPath: [this.authorisationInfo],
        },
        [],
      )
    }

    // Check if the script's computed hash matches any authorized hash.
    // findIndex rather than some: same single pass, but the position is what the
    // auditor report cites as `.../hashes/<n>`.
    const matchingHashIndex = this.authorizedHashes.findIndex((authorizedHashInfo) => authorizedHashInfo.hash.value === hash.value)
    const isAuthorized = matchingHashIndex !== -1

    const result: AuthorizationResult = isAuthorized
      ? { authorized: true }
      : {
          authorized: false,
          reason: `hash ${hash.value} not in authorized list`,
        }

    // Include authorisationInfo in metadataPath if present
    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return withTrace(result, isAuthorized ? [{ slot: 'hashes', index: matchingHashIndex }] : [])
  }
}
