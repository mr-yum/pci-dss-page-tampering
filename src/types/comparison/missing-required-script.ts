import type { InventoryScriptInfo } from '../inventory/model.js'
import type { Target } from '../target.js'
import { ComparisonResult } from './comparison-result.js'

/**
 * A script the inventory requires to be present (entry carries `requiredOn`
 * for the current pass) was absent: no detected script in the run was
 * identified by the entry's `identifyWith` matcher.
 *
 * The script-side analogue of MissingRequiredHeader — presence of a control is
 * the assertion, and its absence is the finding. Integrity when the script IS
 * present is not this type's job: that is ordinary hash authorisation on the
 * same entry. Motivating use case: pinning the RUM monitoring agent so its
 * removal from a payment page alarms (feature 011, FR-016 / R12), but the
 * mechanism is generic to any script whose disappearance must alert.
 */
export class MissingRequiredScript extends ComparisonResult {
  readonly type = 'missing_required_script'

  constructor(
    target: Target,
    timestamp: Date,
    /** Human-readable identity of the absent script — the entry's identifyWith description. */
    public readonly scriptDescription: string,
    public readonly inventoryEntry: InventoryScriptInfo,
  ) {
    super(target, timestamp)
  }
}
