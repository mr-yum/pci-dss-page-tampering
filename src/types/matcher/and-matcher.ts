/**
 * AndMatcher - Composite Matcher with AND Logic
 *
 * Generic composite matcher implementing AND logic. Authorizes only if ALL child matchers succeed.
 * Works with any Matchable resource type (scripts or headers).
 *
 * Type parameter T allows the matcher to be used with:
 * - Scripts: AndMatcher<DetectedScript>
 * - Headers: AndMatcher<Matchable> (hash is undefined)
 * - Any matchable resource: AndMatcher<T extends Matchable>
 *
 * Implements:
 * - FR-002: AND logic (succeeds only if ALL children succeed)
 * - FR-008: Minimum 1 child matcher required
 * - FR-012: Empty array triggers constructor error (fail-secure, prevents vacuous truth)
 * - FR-014: Short-circuit evaluation (fails on first unsuccessful match)
 * - FR-004: Top-level authorisationInfo overrides child authorization decisions
 * - FR-011: authorisationInfo.authorised: false always denies
 * - FR-009: Metadata path collection from root to leaf
 *
 * @see ../../../specs/005-enhance-the-schema/research.md for design rationale
 * @see ../../../specs/005-enhance-the-schema/data-model.md for entity definitions
 */

import type { InventoryAuthorisationInfo } from '../inventory/model'
import type { AuthorizationResult } from './authorization-result'
import type { Matchable, Matcher } from './matcher.interface'

/**
 * AndMatcher - Composite matcher with AND logic (all children must match).
 *
 * Evaluation strategy:
 * 1. Verify all children identify the resource
 * 2. Evaluate authorization for each child in sequence
 * 3. Short-circuit on first authorization failure (FR-014)
 * 4. Apply top-level authorisationInfo override if present
 * 5. Collect metadata path from all evaluated children
 *
 * Fail-secure behavior:
 * - Empty children array rejected at construction (FR-008, FR-012)
 *   CRITICAL: Prevents Array.every([]) === true (vacuous truth security violation)
 * - Null/empty content triggers unauthorized result
 * - Any child identification failure triggers unauthorized result
 * - Any child authorization failure triggers unauthorized result (short-circuit)
 * - Top-level authorised: false always denies (FR-011)
 */
export class AndMatcher<T extends Matchable = Matchable> implements Matcher<T> {
  private readonly children: Matcher<T>[]
  private readonly authorisationInfo: InventoryAuthorisationInfo | undefined

  /**
   * Creates an AndMatcher with the given child matchers.
   *
   * @param children - Array of child matchers (min length 1)
   * @param authorisationInfo - Optional top-level authorization metadata
   * @throws Error if children array is empty or null (fail-secure: FR-008, FR-012)
   *
   * CRITICAL: Empty array rejection prevents vacuous truth scenario.
   * JavaScript Array.every([]) returns true, which would authorize everything.
   * This would be a SECURITY VIOLATION for AND logic.
   */
  constructor(children: Matcher<T>[], authorisationInfo?: InventoryAuthorisationInfo) {
    // FR-008, FR-012: Reject empty arrays (fail-secure)
    // CRITICAL: Prevents Array.every([]) === true (vacuous truth security violation)
    if (!children || children.length === 0) {
      throw new Error('AndMatcher requires at least one child matcher')
    }
    this.children = children
    this.authorisationInfo = authorisationInfo
  }

  /**
   * Returns matcher type discriminator.
   */
  getType(): 'and' {
    return 'and'
  }

  /**
   * Returns child matchers for inspection/debugging.
   */
  getPattern(): Matcher<T>[] {
    return this.children
  }

  /**
   * Returns a human-readable description for logging.
   *
   * @returns Formatted string like "and:[matcher1, matcher2, ...]" with child descriptions
   */
  getDescription(): string {
    const childDescriptions = this.children.length > 3 ? `${this.children.length} matchers` : this.children.map((child) => child.getDescription()).join(', ')
    return `and:[${childDescriptions}]`
  }

  /**
   * Identifies if ALL child matchers identify the resource.
   *
   * FR-002: AND logic - succeeds only if ALL children succeed.
   *
   * IMPORTANT: Only safe because constructor validates non-empty array.
   * Array.every([]) === true would be a security violation for AND logic.
   *
   * @param resource - The resource to identify
   * @returns true if all children identify the resource, false otherwise
   */
  identify(resource: T): boolean {
    // FR-002: Succeeds only if ALL children identify
    // SAFE: Constructor ensures children.length > 0
    return this.children.every((child) => child.identify(resource))
  }

  /**
   * Authorizes the resource using AND logic with short-circuit evaluation.
   *
   * Evaluation steps:
   * 1. Validate resource content is not null/empty (fail-secure)
   * 2. Verify all children identify the resource
   * 3. Evaluate each child's authorization in sequence
   * 4. Short-circuit on first authorization failure (FR-014)
   * 5. Apply top-level authorisationInfo override if present (FR-004, FR-011)
   * 6. Return result with metadata path from all evaluated children (FR-009)
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

    // Check if all children identify first (early exit if not)
    if (!this.identify(resource)) {
      return {
        authorized: false,
        reason: 'Not all child matchers identified the resource',
        metadataPath: this.authorisationInfo ? [this.authorisationInfo] : [],
      }
    }

    const childResults: AuthorizationResult[] = []

    // FR-014: Short-circuit on first failure
    // IMPORTANT: Never use Array.every() for security decisions without empty array check!
    for (const child of this.children) {
      const childResult = child.authorize(resource)
      childResults.push(childResult)

      if (!childResult.authorized) {
        // First failure - short-circuit and deny
        const metadataPath = childResults.flatMap((r) => r.metadataPath ?? [])
        return {
          authorized: false,
          reason: `Child matcher failed: ${childResult.reason}`,
          metadataPath: this.authorisationInfo ? [this.authorisationInfo, ...metadataPath] : metadataPath,
        }
      }
    }

    // All children succeeded - collect full metadata path (FR-009)
    const fullMetadataPath = childResults.flatMap((r) => r.metadataPath ?? [])

    // FR-004, FR-011: Top-level authorisationInfo overrides
    // - If authorised: true → override to authorized
    // - If authorised: false → always deny (FR-011)
    if (this.authorisationInfo) {
      const authorized = this.authorisationInfo.authorised
      const result: AuthorizationResult = {
        authorized,
        // FR-009: Metadata path from root through all children to leaves
        metadataPath: [this.authorisationInfo, ...fullMetadataPath],
      }
      if (!authorized) {
        result.reason = `Top-level authorization denied: ${this.authorisationInfo.description}`
      }
      return result
    }

    // All children authorized, no top-level override
    return {
      authorized: true,
      metadataPath: fullMetadataPath,
    }
  }
}
