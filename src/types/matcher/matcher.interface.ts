/**
 * Matcher Interface
 *
 * Strategy interface for script identification and authorization.
 * Enables separation of concerns between identifying scripts and validating their content.
 *
 * @see ../../services/comparison/script.ts for usage
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design rationale
 */

import type { SHA256Hash } from '../hash'
import type { AuthorizationResult } from './authorization-result'

/**
 * Detected script structure for matcher operations.
 * Contains script name (URL or identifier) and content for matching.
 */
export type DetectedScript = {
  /**
   * Script name/URL for external scripts, generated ID for inline scripts
   */
  name: string

  /**
   * Script content/source code. May be null if fetch failed or content unavailable.
   */
  content: string | null

  /**
   * SHA-256 hash of content (computed on detection)
   */
  hash: SHA256Hash
}

/**
 * Strategy interface for script matching operations.
 *
 * Implementations:
 * - NameMatcher: Matches by script name/URL using regex
 * - ContentMatcher: Matches by script content using regex
 * - HashMatcher: Matches by cryptographic hash (SHA-256)
 *
 * Pattern: Strategy Pattern (per research.md R1)
 */
export interface Matcher {
  /**
   * Returns the matcher type discriminator.
   * Used for logging, debugging, and type narrowing.
   */
  getType(): 'name' | 'content' | 'hash'

  /**
   * Returns the pattern or hashes used by this matcher.
   * For NameMatcher/ContentMatcher: regex pattern string
   * For HashMatcher: array of authorized hashes
   */
  getPattern(): string | SHA256Hash[]

  /**
   * Determines if the given script matches this matcher's identification criteria.
   *
   * @param script - The detected script to test
   * @returns true if script matches, false otherwise
   *
   * Behavior by matcher type:
   * - NameMatcher: Tests script.name against regex pattern
   * - ContentMatcher: Tests script.content against regex pattern
   * - HashMatcher: Always returns false (hashes cannot identify, only authorize)
   *
   * Edge cases:
   * - Null/empty script.name (NameMatcher): returns false
   * - Null/empty script.content (ContentMatcher): returns false
   */
  identify(script: DetectedScript): boolean

  /**
   * Determines if the given script's content is authorized.
   *
   * @param script - The detected script to authorize
   * @returns AuthorizationResult with authorized flag and optional reason
   *
   * Behavior by matcher type:
   * - NameMatcher: Tests script.content against regex pattern
   * - ContentMatcher: Tests script.content against regex pattern
   * - HashMatcher: Computes SHA-256 hash of script.content, checks against authorized hashes
   *
   * Edge cases:
   * - Null/empty script.content: returns { authorized: false, reason: "content is null or empty" }
   */
  authorize(script: DetectedScript): AuthorizationResult
}
