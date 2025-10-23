/**
 * Known Header With Unauthorised Content Found Result
 *
 * Indicates a header identified by inventory but with unauthorized value.
 * Critical security event indicating potential tampering.
 *
 * Enhanced with metadataPath for composite matchers (FR-009):
 * - Contains partial metadata path showing which matchers were evaluated before failure
 * - Useful for debugging complex composite matcher authorization failures
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 * @see specs/005-enhance-the-schema/data-model.md for metadataPath enhancement
 */

import type { DetectedHeader } from '../header'
import type { InventoryAuthorisationInfo, InventoryHeaderInfo } from '../inventory/model'
import type { Matcher } from '../matcher/matcher.interface'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

/**
 * Result indicating a header identified by inventory but authorization failed.
 *
 * Triggers:
 * - Header name matches inventory entry's identifyWith matcher (case-insensitive)
 * - Header value fails inventory entry's authoriseWith matcher (case-sensitive)
 * - One result generated per unauthorized value (multiple values = multiple results)
 *
 * Alert mapping:
 * - Detection workflow → mismatched_header_detected
 * - Inventory workflow → Should not occur (inventory updates baseline)
 */
export class KnownHeaderWithUnauthorisedContentFound extends ComparisonResult {
  readonly type = 'known_header_unauthorised_content'

  /**
   * Full details of the detected header (name, value, target, workflow).
   */
  public readonly header: DetectedHeader

  /**
   * Inventory entry that identified this header.
   * Provides context about expected authorization pattern.
   */
  public readonly inventoryEntry: InventoryHeaderInfo

  /**
   * The specific matcher that failed authorization.
   * Typically the same as inventoryEntry.authoriseWith.
   */
  public readonly authorizationMatcher: Matcher

  /**
   * Human-readable explanation of why authorization failed.
   * Examples:
   * - "value does not match pattern: ^DENY$"
   * - "Child matcher failed: [child reason]"
   * - "Top-level authorization denied: [description]"
   */
  public readonly failureReason: string

  /**
   * Authorization metadata path showing which matchers were evaluated before failure.
   * Array ordering: root → intermediate → failing matcher (partial path)
   *
   * Examples:
   * - Leaf matcher failure: [] or [{ description: "...", authorised: false, date: ... }]
   * - AND matcher failure: [rootInfo, successfulChild1Info, ...] (up to point of failure)
   * - Nested composite failure: [rootInfo, intermediateInfo] (partial path before failure)
   *
   * NEW in Phase 3 (T028): Added for composite matcher support
   */
  public readonly metadataPath: InventoryAuthorisationInfo[]

  /**
   * Creates a new KnownHeaderWithUnauthorisedContentFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param header - The detected header with unauthorized content
   * @param inventoryEntry - The inventory entry that matched
   * @param authorizationMatcher - The matcher that failed
   * @param failureReason - Why authorization failed
   * @param metadataPath - Partial authorization metadata path up to point of failure (default: empty array)
   */
  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo, authorizationMatcher: Matcher, failureReason: string, metadataPath: InventoryAuthorisationInfo[] = []) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
    this.metadataPath = metadataPath
  }
}
