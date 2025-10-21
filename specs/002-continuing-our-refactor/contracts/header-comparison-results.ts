/**
 * Header Comparison Result Type Contracts
 *
 * Defines TypeScript interfaces for header comparison results following the
 * typed comparison result pattern established for scripts.
 *
 * @see ../data-model.md for entity definitions and validation rules
 * @see ../research.md for design decisions and rationale
 */

import type { ComparisonResult } from '../../../src/types/comparison/comparison-result'
import type { Matcher } from '../../../src/types/matcher/matcher.interface'
import type { Target } from '../../../src/types/target'

/**
 * Represents a single detected header name-value pair.
 * Generated from HeaderDetectionSummary by expanding Map<name, Set<values>>
 * into one DetectedHeader per value.
 *
 * @see data-model.md E4: DetectedHeader
 */
export interface DetectedHeader {
  /**
   * Header name (e.g., "Content-Security-Policy").
   * Normalized to lowercase for case-insensitive matching per HTTP RFC 7230.
   */
  readonly name: string

  /**
   * Single header value being evaluated.
   * May be empty string "" per FR-013a (authorization determined by ContentMatcher).
   */
  readonly value: string

  /**
   * Target where this header was detected.
   */
  readonly target: Target

  /**
   * Workflow context (e.g., "checkout").
   */
  readonly workflow: string
}

/**
 * Result: Header not found in inventory.
 *
 * Triggers:
 * - No inventory entry's identifyWith matcher returns true for header name
 * - Header has null/empty value set (fail-secure behavior)
 *
 * Alert mapping:
 * - Inventory workflow → new_inventory_header_identified
 * - Detection workflow → uninventoried_header_detected
 *
 * @see data-model.md E1: UnknownHeaderFound
 */
export class UnknownHeaderFound extends ComparisonResult {
  readonly type = 'unknown_header_found' as const

  /**
   * Full details of the unknown header (name, value, target, workflow).
   * Handlers use this to generate alerts with complete context.
   */
  public readonly header: DetectedHeader

  constructor(target: Target, timestamp: Date, header: DetectedHeader) {
    super(target, timestamp)
    this.header = header
  }
}

/**
 * Header inventory entry schema.
 * Mirrors InventoryScriptInfo structure for consistency.
 *
 * @see data-model.md E5: InventoryHeaderInfo
 */
export interface InventoryHeaderInfo {
  /**
   * Matcher for header name identification (case-insensitive).
   * Must be NameMatcher instance.
   */
  readonly identifyWith: Matcher

  /**
   * Matcher for header value authorization (case-sensitive).
   * Must be ContentMatcher instance.
   */
  readonly authoriseWith: Matcher

  /**
   * Authorization metadata for audit trail.
   */
  readonly authorisationInfo: {
    readonly authorised: boolean
    readonly justification: string
    readonly authorisedAt: string // ISO 8601
  }
}

/**
 * Result: Header identified but value authorization failed.
 *
 * This is a critical security event - header is known but content has changed,
 * indicating potential tampering or misconfiguration.
 *
 * Triggers:
 * - Header name matches inventory entry's identifyWith matcher (case-insensitive)
 * - Same header's value fails inventory entry's authoriseWith matcher (case-sensitive)
 *
 * Alert mapping:
 * - Detection workflow → mismatched_header_detected
 *
 * @see data-model.md E2: KnownHeaderWithUnauthorisedContentFound
 */
export class KnownHeaderWithUnauthorisedContentFound extends ComparisonResult {
  readonly type = 'known_header_unauthorised_content' as const

  /**
   * Full details of the detected header.
   */
  public readonly header: DetectedHeader

  /**
   * The inventory entry that identified this header.
   * Includes authorisationInfo for alert context.
   */
  public readonly inventoryEntry: InventoryHeaderInfo

  /**
   * The matcher that failed authorization.
   * Handlers use getPattern() to show what was expected.
   */
  public readonly authorizationMatcher: Matcher

  /**
   * Human-readable explanation of why authorization failed.
   * Examples:
   * - "value does not match pattern"
   * - "content does not match expected CSP directives"
   */
  public readonly failureReason: string

  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo, authorizationMatcher: Matcher, failureReason: string) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
    this.authorizationMatcher = authorizationMatcher
    this.failureReason = failureReason
  }
}

/**
 * Result: Header both identified and authorized (compliant).
 *
 * Triggers:
 * - Header name matches inventory entry's identifyWith matcher
 * - Same header's value matches inventory entry's authoriseWith matcher
 *
 * Alert mapping:
 * - No alert generated (compliant header)
 *
 * @see data-model.md E3: AuthorizedHeaderFound
 */
export class AuthorizedHeaderFound extends ComparisonResult {
  readonly type = 'authorized_header' as const

  /**
   * Full details of the authorized header.
   */
  public readonly header: DetectedHeader

  /**
   * The inventory entry that matched and authorized this header.
   */
  public readonly inventoryEntry: InventoryHeaderInfo

  constructor(target: Target, timestamp: Date, header: DetectedHeader, inventoryEntry: InventoryHeaderInfo) {
    super(target, timestamp)
    this.header = header
    this.inventoryEntry = inventoryEntry
  }
}

/**
 * Discriminated union of all header comparison result types.
 * Used for type-safe handling in alert service.
 *
 * @see data-model.md E6: ComparisonResultType (extended with header types)
 */
export type HeaderComparisonResultType = UnknownHeaderFound | KnownHeaderWithUnauthorisedContentFound | AuthorizedHeaderFound
