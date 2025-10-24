/**
 * NameMatcher Implementation
 *
 * Matches scripts by name/URL using regex patterns.
 * Used for identifying external scripts with static or dynamic URLs.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { AuthorizationResult } from './authorization-result'
import type { DetectedScript, Matcher } from './matcher.interface'

/**
 * Matches scripts by name/URL using regex patterns.
 *
 * Use Cases:
 * - External scripts with dynamic query parameters: `^https://example.com/script.js\?.*$`
 * - Scripts with versioned URLs: `^https://cdn.example.com/v[0-9]+/script.js$`
 *
 * Behavior:
 * - identify(): Tests script.name against pattern
 * - authorize(): Tests script.content against pattern (same pattern for both)
 * - Returns false for null/undefined script names
 */
export class NameMatcher implements Matcher {
  private readonly pattern: RegExp

  /**
   * Creates a new NameMatcher with the specified regex pattern.
   *
   * @param patternString - Regex pattern string (validated by Zod schema before instantiation)
   */
  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  /**
   * Returns the matcher type discriminator.
   *
   * @returns The string 'name' for type-based dispatch
   */
  getType(): 'name' {
    return 'name'
  }

  /**
   * Returns the regex pattern source for logging and debugging.
   *
   * @returns The regex pattern as a string
   */
  getPattern(): string {
    return this.pattern.source
  }

  /**
   * Returns a human-readable description for logging.
   *
   * @returns Formatted string like "name:/pattern/" with pattern truncated if too long
   */
  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `name:/${truncated}/`
  }

  /**
   * Identifies if a detected script matches this pattern by testing the script name.
   *
   * @param script - The detected script to test
   * @returns true if script.name matches the pattern, false otherwise
   */
  identify(script: DetectedScript): boolean {
    if (!script.name || script.name.trim() === '') {
      return false
    }
    return this.pattern.test(script.name)
  }

  /**
   * Authorizes a detected script by testing the script content against the pattern.
   *
   * @param script - The detected script to authorize
   * @returns AuthorizationResult with authorized=true if content matches, authorized=false with reason otherwise
   */
  authorize(script: DetectedScript): AuthorizationResult {
    if (!script.content || script.content.trim() === '') {
      return {
        authorized: false,
        reason: 'content is null or empty',
      }
    }

    const matches = this.pattern.test(script.content)
    return matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `content does not match pattern: ${this.pattern.source}`,
        }
  }
}
