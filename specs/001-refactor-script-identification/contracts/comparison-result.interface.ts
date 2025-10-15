/**
 * Comparison Result Interface Contract
 *
 * Defines typed comparison results returned by ScriptComparisonService.
 * Each result type includes complete context for alert handlers.
 *
 * @see data-model.md for entity definitions
 * @see research.md (R3) for design rationale
 */

import { DetectedScript } from '../../../src/types/script'
import { Target } from '../../../src/types/target'
import { ScriptInventoryEntry } from '../../../src/types/inventory/model'
import { Matcher } from './matcher.interface'

/**
 * Base class for all comparison results.
 * Provides common context shared across all result types.
 */
export abstract class ComparisonResult {
  /**
   * Discriminator for TypeScript discriminated unions.
   * Enables exhaustive type checking in handlers.
   */
  abstract readonly type: string

  /**
   * The target being processed (inventory or detection URL).
   */
  public readonly target: Target

  /**
   * When the comparison occurred (UTC).
   */
  public readonly timestamp: Date

  constructor(target: Target, timestamp: Date) {
    this.target = target
    this.timestamp = timestamp
  }
}

/**
 * Result indicating a detected script with no matching inventory entry.
 *
 * Triggers:
 * - No inventory entry matches via identifyWith matcher
 * - Detected script has null/empty content (fail-secure per clarification Q3)
 *
 * Alert mapping:
 * - Inventory workflow → newScriptIdentified
 * - Detection workflow → newScriptDetected
 */
export class UnknownScriptFound extends ComparisonResult {
  readonly type = 'unknown_script_found'

  /**
   * Full details of the unknown script (name, content, hash).
   * Handlers use this to generate alerts with script context.
   */
  public readonly script: DetectedScript

  constructor(target: Target, timestamp: Date, script: DetectedScript) {
    super(target, timestamp)
    this.script = script
  }
}

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
  public readonly inventoryEntry: ScriptInventoryEntry

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

  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: ScriptInventoryEntry, authorizationMatcher: Matcher, failureReason: string) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
  }
}

/**
 * Result indicating a script that is both identified and authorized.
 *
 * Triggers:
 * - Script identified by identifyWith matcher
 * - Same script passes authoriseWith matcher
 *
 * Alert mapping:
 * - No alert generated (compliant script)
 */
export class AuthorizedScriptFound extends ComparisonResult {
  readonly type = 'authorized_script'

  /**
   * Full details of the authorized script.
   */
  public readonly script: DetectedScript

  /**
   * The inventory entry that matched and authorized this script.
   */
  public readonly inventoryEntry: ScriptInventoryEntry

  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: ScriptInventoryEntry) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
  }
}

/**
 * Union type for all possible comparison results.
 * Enables exhaustive type checking in handlers via discriminated union.
 *
 * Example handler pattern:
 *
 * ```typescript
 * function handleResult(result: ComparisonResultType) {
 *   switch (result.type) {
 *     case 'unknown_script_found':
 *       // TypeScript narrows to UnknownScriptFound
 *       sendAlert({ script: result.script, target: result.target });
 *       break;
 *     case 'known_script_unauthorised_content':
 *       // TypeScript narrows to KnownScriptWithUnauthorisedContentFound
 *       sendAlert({
 *         script: result.script,
 *         reason: result.failureReason,
 *         expected: result.authorizationMatcher.getPattern()
 *       });
 *       break;
 *     case 'authorized_script':
 *       // No alert needed
 *       break;
 *   }
 * }
 * ```
 */
export type ComparisonResultType = UnknownScriptFound | KnownScriptWithUnauthorisedContentFound | AuthorizedScriptFound
