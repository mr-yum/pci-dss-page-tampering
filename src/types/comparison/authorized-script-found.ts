/**
 * Authorized Script Found Result
 *
 * Indicates a script that is both identified and authorized (compliant).
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 */

import type { InventoryScriptInfo } from '../inventory/model'
import type { DetectedScript } from '../matcher/matcher.interface'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

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
  public readonly inventoryEntry: InventoryScriptInfo

  /**
   * Creates a new AuthorizedScriptFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param script - The detected script that was both identified and authorized
   * @param inventoryEntry - The inventory entry that matched and authorized this script
   */
  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: InventoryScriptInfo) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
  }
}
