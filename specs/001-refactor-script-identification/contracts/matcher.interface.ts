/**
 * Matcher Interface Contract
 *
 * Defines the contract for all matcher implementations used in script
 * identification and authorization.
 *
 * @see data-model.md for entity definitions
 * @see research.md (R1) for pattern selection rationale
 */

import { DetectedScript } from '../../../src/types/script'
import { Hash } from '../../../src/types/hash'

/**
 * Result of an authorization check.
 */
export interface AuthorizationResult {
  /**
   * Whether the script content is authorized.
   */
  authorized: boolean

  /**
   * Human-readable reason for authorization failure.
   * Required when authorized is false.
   * Examples:
   * - "content does not match pattern"
   * - "hash not in authorized list"
   * - "content is null or empty"
   */
  reason?: string
}

/**
 * Strategy interface for script matching operations.
 *
 * Implementations:
 * - NameMatcher: Matches by script name/URL using regex
 * - ContentMatcher: Matches by script content using regex
 * - HashMatcher: Matches by cryptographic hash (SHA-256)
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
  getPattern(): string | Hash[]

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
   * - Invalid regex (should be caught by Zod schema): not applicable (matchers receive valid patterns)
   */
  authorize(script: DetectedScript): AuthorizationResult
}

/**
 * Configuration for creating a matcher instance.
 * Corresponds to inventory JSON schema.
 */
export type MatcherConfig = { nameMatcher: string } | { contentMatcher: string } | { hashes: Hash[] }

/**
 * Factory function for creating matcher instances from configuration.
 *
 * @param config - Matcher configuration from inventory JSON
 * @returns Concrete matcher implementation (NameMatcher, ContentMatcher, or HashMatcher)
 *
 * @throws Error if config is invalid (should be prevented by Zod schema validation)
 */
export function createMatcher(config: MatcherConfig): Matcher
