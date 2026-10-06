/**
 * Authorized Script Found Result
 *
 * Indicates a script that is both identified and authorized (compliant).
 *
 * Enhanced with metadataPath for composite matchers (FR-009):
 * - Leaf matchers: Single-element array (or empty if no authorization info)
 * - Composite matchers: Array from root to leaf showing full authorization chain
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 * @see specs/005-enhance-the-schema/data-model.md for metadataPath enhancement
 */

import type { InitiatorHop } from '../initiator-chain.js'
import type { InventoryAuthorisationInfo, InventoryScriptInfo } from '../inventory/model.js'
import type { DetectedScript } from '../matcher/matcher.interface.js'
import type { Target } from '../target.js'
import { ComparisonResult } from './comparison-result.js'

/**
 * How a script that no entry identified came to be authorised anyway: an
 * ancestor in its initiator chain was authorised in the same run by an entry
 * that grants its loads (`authorisesLoads`).
 */
export type InheritedAuthorisation = {
  /** The granting script, as its hop names it (URL, or inline identity). */
  from: string
  /** The chain from this script out to and including the granting hop. */
  via: InitiatorHop[]
  /** `direct` or `transitive`, as the granting entry declares it. */
  mode: 'direct' | 'transitive'
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
  public readonly inventoryEntry: InventoryScriptInfo

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
   * NEW in Phase 3 (T025): Added for composite matcher support
   */
  public readonly metadataPath: InventoryAuthorisationInfo[]

  /**
   * Set only when the script was authorised by inheritance rather than by an
   * entry identifying it. `inventoryEntry` is then the GRANTING entry — what
   * an auditor follows to the justification — and nothing identified this
   * script itself.
   */
  public readonly inherited: InheritedAuthorisation | undefined

  /**
   * Creates a new AuthorizedScriptFound result.
   *
   * @param target - The target being processed
   * @param timestamp - When the comparison occurred
   * @param script - The detected script that was both identified and authorized
   * @param inventoryEntry - The inventory entry that matched and authorized this script
   * @param metadataPath - Authorization metadata path from composite matcher evaluation (default: empty array)
   */
  constructor(target: Target, timestamp: Date, script: DetectedScript, inventoryEntry: InventoryScriptInfo, metadataPath: InventoryAuthorisationInfo[] = [], inherited?: InheritedAuthorisation) {
    super(target, timestamp)
    this.script = script
    this.inventoryEntry = inventoryEntry
    this.metadataPath = metadataPath
    this.inherited = inherited
  }
}
