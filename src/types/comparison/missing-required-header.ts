import type { ResponseResourceType } from '../header.js'
import type { InventoryHeaderInfo } from '../inventory/model.js'
import type { Target } from '../target.js'
import { ComparisonResult } from './comparison-result.js'

/** A required security header was absent from an in-scope response. */
export class MissingRequiredHeader extends ComparisonResult {
  readonly type = 'missing_required_header'

  constructor(
    target: Target,
    timestamp: Date,
    public readonly headerName: string,
    public readonly url: string,
    public readonly resourceType: ResponseResourceType,
    public readonly inventoryEntry: InventoryHeaderInfo,
  ) {
    super(target, timestamp)
  }
}
