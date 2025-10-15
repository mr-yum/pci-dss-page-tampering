/**
 * ContentMatcher Implementation
 *
 * Matches scripts by content using regex patterns.
 * Used for identifying inline scripts or scripts with specific code snippets.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { Matcher, DetectedScript } from './matcher.interface'
import type { AuthorizationResult } from './authorization-result'

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

  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  getType(): 'content' {
    return 'content'
  }

  getPattern(): string {
    return this.pattern.source
  }

  identify(script: DetectedScript): boolean {
    if (!script.content || script.content.trim() === '') {
      return false // Cannot match on empty content (fail-secure per research.md R5)
    }
    return this.pattern.test(script.content)
  }

  authorize(script: DetectedScript): AuthorizationResult {
    if (!script.content || script.content.trim() === '') {
      return {
        authorized: false,
        reason: 'content is null or empty'
      }
    }

    const matches = this.pattern.test(script.content)
    return matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `content does not match pattern: ${this.pattern.source}`
        }
  }
}
