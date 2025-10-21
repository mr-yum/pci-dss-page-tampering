/**
 * Unknown Header Found Result
 *
 * Indicates a detected header with no matching inventory entry.
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 */

import type { DetectedHeader } from '../header'
import type { Target } from '../target'
import { ComparisonResult } from './comparison-result'

/**
 * Result indicating a detected header with no matching inventory entry.
 *
 * Triggers:
 * - No inventory entry matches via identifyWith matcher (case-insensitive name match)
 * - Detected header has null/empty value Set (fail-secure per research.md R7)
 *
 * Alert mapping:
 * - Inventory workflow → new_inventory_header_identified
 * - Detection workflow → uninventoried_header_detected
 */
export class UnknownHeaderFound extends ComparisonResult {
  readonly type = 'unknown_header_found'

  /**
   * Full details of the unknown header (name, value, target, workflow).
   * Handlers use this to generate alerts with header context.
   */
  public readonly header: DetectedHeader

  /**
   * Creates a new UnknownHeaderFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param header - The detected header that was not found in inventory
   */
  constructor(target: Target, timestamp: Date, header: DetectedHeader) {
    super(target, timestamp)
    this.header = header
  }
}
