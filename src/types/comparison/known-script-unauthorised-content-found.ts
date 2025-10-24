/**
 * Known Script With Unauthorised Content Found Result
 *
 * Indicates a script matched by identification but failed authorization.
 * This is a critical security event - script is known but content has changed.
 *
 * Enhanced with metadataPath for composite matchers (FR-009):
 * - Contains partial metadata path showing which matchers were evaluated before failure
 * - Useful for debugging complex composite matcher authorization failures
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 * @see specs/005-enhance-the-schema/data-model.md for metadataPath enhancement
 */

import type { InventoryAuthorisationInfo, InventoryScriptInfo } from '../inventory/model'
import type { DetectedScript, Matcher } from '../matcher/matcher.interface'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

/**
 * Result indicating a script matched by identification but failed authorization.
 *
 * Triggers:
 * - Script identified by identifyWith matcher
 * - Same script fails authoriseWith matcher
 *
 * Alert mapping:
 * - Detection workflow → scriptMismatchDetected
 *
 * This is a critical security event - script is known but content has changed.
 */
export class KnownScriptWithUnauthorisedContentFound extends ComparisonResult {
  readonly type = 'known_script_unauthorised_content'

  /**
   * Full details of the detected script.
   */
  public readonly script: DetectedScript

  /**
   * The inventory entry that identified this script.
   * Includes authorisationInfo for alert context.
   */
  public readonly inventoryEntry: InventoryScriptInfo

  /**
   * The matcher that failed authorization.
   * Handlers use getPattern() to show what was expected.
   */
  public readonly authorizationMatcher: Matcher

  /**
   * Human-readable explanation of why authorization failed.
   * Examples:
   * - "content does not match pattern"
   * - "hash abc123... not in authorized list"
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
   * NEW in Phase 3 (T026): Added for composite matcher support
   */
  public readonly metadataPath: InventoryAuthorisationInfo[]

  /**
   * Creates a new KnownScriptWithUnauthorisedContentFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param script - The detected script that was identified but failed authorization
   * @param inventoryEntry - The inventory entry that identified this script
   * @param authorizationMatcher - The matcher that failed authorization
   * @param failureReason - Human-readable explanation of why authorization failed
   * @param metadataPath - Partial authorization metadata path up to point of failure (default: empty array)
   */
  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: InventoryScriptInfo, authorizationMatcher: Matcher, failureReason: string, metadataPath: InventoryAuthorisationInfo[] = []) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
    this.metadataPath = metadataPath
  }
}
