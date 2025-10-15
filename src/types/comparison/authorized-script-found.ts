/**
 * Authorized Script Found Result
 *
 * Indicates a script that is both identified and authorized (compliant).
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 */

import { ComparisonResult } from './comparison-result';
import type { DetectedScript } from '../matcher/matcher.interface';
import type { Target } from '../target';
import type { InventoryScriptInfo } from '../inventory/model';

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
  readonly type = 'authorized_script';

  /**
   * Full details of the authorized script.
   */
  public readonly script: DetectedScript;

  /**
   * The inventory entry that matched and authorized this script.
   */
  public readonly inventoryEntry: InventoryScriptInfo;

  constructor(
    target: Target,
    timestamp: Date,
    script: DetectedScript,
    inventoryEntry: InventoryScriptInfo
  ) {
    super(target, timestamp);
    this.script = script;
    this.inventoryEntry = inventoryEntry;
  }
}
