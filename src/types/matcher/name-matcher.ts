/**
 * NameMatcher Implementation
 *
 * Matches scripts by name/URL using regex patterns.
 * Used for identifying external scripts with static or dynamic URLs.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { SHA256Hash } from '../hash'
import type { Matcher, DetectedScript } from './matcher.interface'
import type { AuthorizationResult } from './authorization-result'

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

  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  getType(): 'name' {
    return 'name'
  }

  getPattern(): string {
    return this.pattern.source
  }

  identify(script: DetectedScript): boolean {
    if (!script.name || script.name.trim() === '') {
      return false
    }
    return this.pattern.test(script.name)
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
