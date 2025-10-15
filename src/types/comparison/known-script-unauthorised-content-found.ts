/**
 * Known Script With Unauthorised Content Found Result
 *
 * Indicates a script matched by identification but failed authorization.
 * This is a critical security event - script is known but content has changed.
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 */

import { ComparisonResult } from './comparison-result'
import type { DetectedScript, Matcher } from '../matcher/matcher.interface'
import type { Target } from '../target'
import type { InventoryScriptInfo } from '../inventory/model'

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
   */
  public readonly failureReason: string

  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: InventoryScriptInfo, authorizationMatcher: Matcher, failureReason: string) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
  }
}
