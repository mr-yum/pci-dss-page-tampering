/**
 * Authorized Header Found Result
 *
 * Indicates a header that is both identified and authorized.
 * Indicates compliance, no alert generated.
 *
 * Enhanced with metadataPath for composite matchers (FR-009):
 * - Leaf matchers: Single-element array (or empty if no authorization info)
 * - Composite matchers: Array from root to leaf showing full authorization chain
 *
 * @see specs/002-continuing-our-refactor/data-model.md for entity definitions
 * @see specs/005-enhance-the-schema/data-model.md for metadataPath enhancement
 */

import type { DetectedHeader } from '../header.js'
import type { InventoryAuthorisationInfo, InventoryHeaderInfo } from '../inventory/model.js'
import type { Target } from '../target.js'
import { ComparisonResult } from './comparison-result.js'

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
   * Authorization metadata path from root composite to successful leaf.
   * Array ordering: root → intermediate → leaf (chronological traversal order)
   *
   * Examples:
   * - Leaf matcher: [] or [{ description: "...", authorised: true, date: ... }]
   * - OR matcher: [rootInfo, matchingChildInfo]
   * - AND matcher: [rootInfo, ...allChildrenInfo]
   * - Nested composite: [rootInfo, intermediateInfo, leafInfo]
   *
   * NEW in Phase 3 (T027): Added for composite matcher support
   */
  public readonly metadataPath: InventoryAuthorisationInfo[]

  /**
   * Creates a new AuthorizedHeaderFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param header - The detected header that was authorized
   * @param inventoryEntry - The inventory entry that authorized it
   * @param metadataPath - Authorization metadata path from composite matcher evaluation (default: empty array)
   */
  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo, metadataPath: InventoryAuthorisationInfo[] = []) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
    this.metadataPath = metadataPath
  }
}
