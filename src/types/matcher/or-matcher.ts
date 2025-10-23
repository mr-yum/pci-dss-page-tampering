/**
 * OrMatcher - Composite Matcher with OR Logic
 *
 * Generic composite matcher implementing OR logic. Authorizes if ANY child matcher succeeds.
 * Works with any Matchable resource type (scripts or headers).
 *
 * Type parameter T allows the matcher to be used with:
 * - Scripts: OrMatcher<DetectedScript>
 * - Headers: OrMatcher<Matchable> (hash is undefined)
 * - Any matchable resource: OrMatcher<T extends Matchable>
 *
 * Implements:
 * - FR-001: OR logic (succeeds if ANY child succeeds)
 * - FR-008: Minimum 1 child matcher required
 * - FR-012: Empty array triggers constructor error (fail-secure)
 * - FR-013: First-match-wins evaluation order (short-circuit on first success)
 * - FR-004: Top-level authorisationInfo overrides child authorization decisions
 * - FR-011: authorisationInfo.authorised: false always denies
 * - FR-009: Metadata path collection from root to leaf
 *
 * @see ../../../specs/005-enhance-the-schema/research.md for design rationale
 * @see ../../../specs/005-enhance-the-schema/data-model.md for entity definitions
 */

import type { Matcher, Matchable } from './matcher.interface'
import type { AuthorizationResult } from './authorization-result'
import type { InventoryAuthorisationInfo } from '../inventory/model'

/**
 * OrMatcher - Composite matcher with OR logic (any child matches).
 *
 * Evaluation strategy:
 * 1. Find first child that identifies the resource (first-match-wins)
 * 2. Delegate authorization to that child
 * 3. Apply top-level authorisationInfo override if present
 * 4. Collect metadata path from root to leaf
 *
 * Fail-secure behavior:
 * - Empty children array rejected at construction (FR-008, FR-012)
 * - Null/empty content triggers unauthorized result
 * - No matching child triggers unauthorized result
 * - Top-level authorised: false always denies (FR-011)
 */
export class OrMatcher<T extends Matchable = Matchable> implements Matcher<T> {
  private readonly children: Matcher<T>[]
  private readonly authorisationInfo: InventoryAuthorisationInfo | undefined

  /**
   * Creates an OrMatcher with the given child matchers.
   *
   * @param children - Array of child matchers (min length 1)
   * @param authorisationInfo - Optional top-level authorization metadata
   * @throws Error if children array is empty or null (fail-secure: FR-008, FR-012)
   */
  constructor(children: Matcher<T>[], authorisationInfo?: InventoryAuthorisationInfo) {
    // FR-008, FR-012: Reject empty arrays (fail-secure)
    // CRITICAL: Prevents vacuous logic and ensures at least one authorization path exists
    if (!children || children.length === 0) {
      throw new Error('OrMatcher requires at least one child matcher')
    }
    this.children = children
    this.authorisationInfo = authorisationInfo
  }

  /**
   * Returns matcher type discriminator.
   */
  getType(): 'or' {
    return 'or'
  }

  /**
   * Returns child matchers for inspection/debugging.
   */
  getPattern(): Matcher<T>[] {
    return this.children
  }

  /**
   * Identifies if ANY child matcher identifies the resource.
   *
   * FR-001: OR logic - succeeds if any child succeeds.
   *
   * @param resource - The resource to identify
   * @returns true if any child identifies the resource, false otherwise
   */
  identify(resource: T): boolean {
    // FR-001: Succeeds if ANY child identifies
    return this.children.some((child) => child.identify(resource))
  }

  /**
   * Authorizes the resource using first-match-wins OR logic.
   *
   * Evaluation steps:
   * 1. Validate resource content is not null/empty (fail-secure)
   * 2. Find first child that identifies the resource (FR-013)
   * 3. Get authorization result from matching child
   * 4. Apply top-level authorisationInfo override if present (FR-004, FR-011)
   * 5. Return result with metadata path from root to leaf (FR-009)
   *
   * @param resource - The resource to authorize
   * @returns AuthorizationResult with authorized flag, optional reason, and metadata path
   */
  authorize(resource: T): AuthorizationResult {
    // Fail-secure: null/empty content check
    if (!resource || !resource.content || resource.content.trim() === '') {
      return {
        authorized: false,
        reason: 'Resource content is null or empty',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    // FR-013: First-match-wins semantics (short-circuit on first identifying child)
    const matchingChild = this.children.find((child) => child.identify(resource))

    if (!matchingChild) {
      return {
        authorized: false,
        reason: 'No child matcher identified the resource',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    // Get authorization from matching child
    const childResult = matchingChild.authorize(resource)

    // FR-004, FR-011: Top-level authorisationInfo overrides child result
    // - If authorised: true → override to authorized
    // - If authorised: false → always deny (FR-011)
    if (this.authorisationInfo) {
      const authorized = this.authorisationInfo.authorised
      const result: AuthorizationResult = {
        authorized,
        // FR-009: Metadata path from root to leaf
        metadataPath: [this.authorisationInfo, ...(childResult.metadataPath ?? [])],
      }
      if (!authorized) {
        result.reason = `Top-level authorization denied: ${this.authorisationInfo.description}`
      }
      return result
    }

    // Use child authorization result without override
    return childResult
  }
}
