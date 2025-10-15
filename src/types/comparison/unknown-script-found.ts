/**
 * Unknown Script Found Result
 *
 * Indicates a detected script with no matching inventory entry.
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 */

import { ComparisonResult } from './comparison-result'
import type { DetectedScript } from '../matcher/matcher.interface'
import type { Target } from '../target'

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
