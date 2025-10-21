/**
 * Authorized Header Found Result
 *
 * Indicates a header that is both identified and authorized.
 * Indicates compliance, no alert generated.
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 */

import type { DetectedHeader } from '../header'
import type { InventoryHeaderInfo } from '../inventory/model'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

/**
 * Result indicating a header that is both identified and authorized.
 *
 * Triggers:
 * - Header name matches inventory entry's identifyWith matcher (case-insensitive)
 * - Header value matches inventory entry's authoriseWith matcher (case-sensitive)
 * - One result per authorized value (header with 3 values = 3 separate results)
 *
 * Alert mapping:
 * - No alert (compliant header)
 */
export class AuthorizedHeaderFound extends ComparisonResult {
  readonly type = 'authorized_header'

  /**
   * Full details of the authorized header (name, value, target, workflow).
   */
  public readonly header: DetectedHeader

  /**
   * Inventory entry that matched and authorized this header.
   */
  public readonly inventoryEntry: InventoryHeaderInfo

  /**
   * Creates a new AuthorizedHeaderFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param header - The detected header that was authorized
   * @param inventoryEntry - The inventory entry that authorized it
   */
  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
  }
}
