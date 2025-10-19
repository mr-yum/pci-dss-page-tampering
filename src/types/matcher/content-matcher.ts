/**
 * ContentMatcher Implementation
 *
 * Matches scripts by content using regex patterns.
 * Used for identifying inline scripts or scripts with specific code snippets.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { AuthorizationResult } from './authorization-result'
import type { DetectedScript, Matcher } from './matcher.interface'

/**
 * Matches scripts by content using regex patterns.
 *
 * Use Cases:
 * - Inline scripts with identifying code snippets: `fbq\('init',`
 * - Scripts with specific structure: `__NEXT_DATA__`
 *
 * Behavior:
 * - identify(): Tests script.content against pattern
 * - authorize(): Tests script.content against pattern (same pattern for both)
 * - Returns false for null/empty content (triggers UnknownScriptFound per clarification Q3)
 */
export class ContentMatcher implements Matcher {
  private readonly pattern: RegExp

  /**
   * Creates a new ContentMatcher with the specified regex pattern.
   *
   * @param patternString - Regex pattern string (validated by Zod schema before instantiation)
   */
  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  /**
   * Returns the matcher type discriminator.
   *
   * @returns The string 'content' for type-based dispatch
   */
  getType(): 'content' {
    return 'content'
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
   * Identifies if a detected script matches this pattern by testing the script content.
   * Fail-secure: returns false for null/empty content.
   *
   * @param script - The detected script to test
   * @returns true if script.content matches the pattern, false otherwise
   */
  identify(script: DetectedScript): boolean {
    if (!script.content || script.content.trim() === '') {
      return false // Cannot match on empty content (fail-secure per research.md R5)
    }
    return this.pattern.test(script.content)
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
