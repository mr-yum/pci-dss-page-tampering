/**
 * Known Header With Unauthorised Content Found Result
 *
 * Indicates a header identified by inventory but with unauthorized value.
 * Critical security event indicating potential tampering.
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 */

import type { DetectedHeader } from '../header'
import type { InventoryHeaderInfo } from '../inventory/model'
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
   * Example: "value does not match pattern: ^DENY$"
   */
  public readonly failureReason: string

  /**
   * Creates a new KnownHeaderWithUnauthorisedContentFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param header - The detected header with unauthorized content
   * @param inventoryEntry - The inventory entry that matched
   * @param authorizationMatcher - The matcher that failed
   * @param failureReason - Why authorization failed
   */
  constructor(
    target: Target,
    timestamp: Date,
    header: DetectedHeader,
    inventoryEntry: InventoryHeaderInfo,
    authorizationMatcher: Matcher,
    failureReason: string,
  ) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
  }
}
