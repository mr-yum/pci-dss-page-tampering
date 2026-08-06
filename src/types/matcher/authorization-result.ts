/**
 * Authorization Result Type
 *
 * Result of an authorization check performed by a Matcher.
 * Contains authorization status, optional failure reason, and authorization metadata path.
 *
 * Enhanced with metadataPath for composite matchers (FR-009):
 * - Leaf matchers: Single-element array (or empty if no authorization info)
 * - Composite matchers: Array from root to leaf showing full authorization chain
 */

import type { InventoryAuthorisationInfo } from '../inventory/model.js'
import type { AuthorizationTrace } from './authorization-trace.js'

/**
 * Result of an authorization check.
 */
export type AuthorizationResult = {
  /**
   * Whether the resource content is authorized.
   */
  authorized: boolean

  /**
   * Human-readable reason for authorization failure.
   * Required when authorized is false.
   *
   * Examples:
   * - "content does not match pattern"
   * - "hash not in authorized list"
   * - "content is null or empty"
   * - "Top-level authorization denied: [description]"
   * - "AND matcher failed: [child reason]"
   */
  reason?: string

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
   * Optional: undefined for legacy matchers without authorization info
   */
  metadataPath?: InventoryAuthorisationInfo[]

  /**
   * Which child slots the composite matchers actually visited.
   *
   * Present only when the caller passed `{ collectTrace: true }`, so results on
   * the normal detection path are byte-identical to what they have always been.
   * Used by the auditor report to cite the exact OR alternative or hash entry
   * that authorised a resource.
   *
   * @see ./authorization-trace.ts
   */
  trace?: AuthorizationTrace
}
