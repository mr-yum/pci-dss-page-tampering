/**
 * HeaderNameMatcher Implementation
 *
 * Matches HTTP headers by name using case-insensitive regex patterns (per RFC 7230).
 * Used for identifying headers in inventory with domain-appropriate matching semantics.
 *
 * Key differences from NameMatcher (ScriptNameMatcher):
 * - identify(): Case-insensitive matching for HTTP header names
 * - authorize(): Case-sensitive matching for header values
 * - Both implement the same Matcher interface but with different behaviors
 *
 * @see ../../../specs/002-continuing-our-refactor/data-model.md for design (BR-3)
 * @see ../../../specs/002-continuing-our-refactor/spec.md for FR-010a, FR-010b
 */

import type { AuthorizationResult } from './authorization-result'
import type { DetectedScript, Matcher } from './matcher.interface'

/**
 * Matches HTTP headers by name using case-insensitive regex patterns.
 *
 * Use Cases:
 * - Standard HTTP headers: `^content-type$`, `^x-frame-options$`
 * - Header families: `^x-custom-.*$`
 * - Multiple headers: `^(content-type|content-encoding|content-language)$`
 *
 * Behavior (FR-010a, FR-010b):
 * - identify(): Tests input.name (normalized to lowercase) against pattern
 * - authorize(): Tests input.content or value (case-sensitive) against pattern
 * - Returns false for null/undefined/empty names or content
 *
 * Implementation Notes (T052-T056):
 * - T052: Class implements Matcher interface with header-specific semantics
 * - T053: identify() normalizes to lowercase per BR-3 (RFC 7230 compliance)
 * - T054: authorize() uses case-sensitive matching for values
 * - T055: getType() returns 'header-name' as discriminator
 * - T056: getPattern() returns regex pattern string for logging
 *
 * Note: Implements the generic Matcher interface but interprets fields for headers:
 * - script.name → header name
 * - script.content → header value
 */
export class HeaderNameMatcher implements Matcher {
  private readonly pattern: RegExp

  /**
   * Creates a new HeaderNameMatcher with the specified regex pattern.
   *
   * @param patternString - Regex pattern string (validated by Zod schema before instantiation)
   */
  constructor(patternString: string) {
    this.pattern = new RegExp(patternString)
  }

  /**
   * Returns the matcher type discriminator (T055).
   *
   * @returns The string 'header-name' for type-based dispatch
   */
  getType(): 'header-name' {
    return 'header-name'
  }

  /**
   * Returns the regex pattern source for logging and debugging (T056).
   *
   * @returns The regex pattern as a string
   */
  getPattern(): string {
    return this.pattern.source
  }

  /**
   * Identifies if a detected resource matches this pattern by testing the name (T053).
   *
   * For headers:
   * - input.name represents the header name (e.g., "Content-Type")
   * - Normalizes to lowercase before regex test per RFC 7230 (BR-3)
   * - Pattern should be written in lowercase (e.g., "^content-type$")
   *
   * @param input - The detected resource to test (name field used for headers)
   * @returns true if name (normalized) matches the pattern, false otherwise
   */
  identify(input: DetectedScript): boolean {
    if (!input.name || input.name.trim() === '') {
      return false
    }
    // T053: Normalize to lowercase for case-insensitive matching (BR-3)
    return this.pattern.test(input.name.toLowerCase())
  }

  /**
   * Authorizes a detected resource by testing the content against the pattern (T054).
   *
   * For headers:
   * - input.content represents the header value
   * - Case-sensitive matching (BR-4): "DENY" ≠ "deny"
   * - Empty string values trigger authorization failure per BR-5
   *
   * @param input - The detected resource to authorize (content field used for header values)
   * @returns AuthorizationResult with authorized=true if content matches, authorized=false with reason otherwise
   */
  authorize(input: DetectedScript): AuthorizationResult {
    // T054: Handle empty/null content per BR-5
    if (!input.content || input.content.trim() === '') {
      return {
        authorized: false,
        reason: 'content is null or empty',
      }
    }

    // T054: Case-sensitive content matching (BR-4)
    const matches = this.pattern.test(input.content)
    return matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `content does not match pattern: ${this.pattern.source}`,
        }
  }
}
