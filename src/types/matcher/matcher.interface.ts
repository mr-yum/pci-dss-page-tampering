/**
 * Matcher Interface
 *
 * Strategy interface for script identification and authorization.
 * Enables separation of concerns between identifying scripts and validating their content.
 *
 * @see ../../services/comparison/script.ts for usage
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design rationale
 */

import type { SHA256Hash } from '../hash'
import type { InventoryScriptHashInfo } from '../inventory/model'
import type { AuthorizationResult } from './authorization-result'

/**
 * Authorization metadata for matchers.
 * Contains information about the authorization decision for audit trail.
 */
export interface AuthorisationInfo {
  /**
   * Human-readable description of what this matcher authorizes
   */
  description: string

  /**
   * Whether this matcher is authorized (true) or explicitly denied (false)
   */
  authorised: boolean

  /**
   * Date when this authorization was granted or denied
   */
  date: Date
}

/**
 * Generic matchable resource (script or header).
 * Provides common structure for matcher operations.
 *
 * This interface enables type-safe matching across both scripts and headers
 * without requiring type casting workarounds.
 */
export interface Matchable {
  /**
   * Resource name (script URL or header name)
   */
  name: string

  /**
   * Resource content (script source or header value).
   * May be null if fetch failed or content unavailable.
   */
  content: string | null

  /**
   * Optional cryptographic hash (scripts only, undefined for headers).
   * Scripts will always have a hash; headers will have undefined.
   */
  hash?: SHA256Hash

  /**
   * Optional originating host. Populated for response-derived resources
   * (HTTP headers, external scripts) so matchers can discriminate by
   * provenance — e.g. an inventory entry can require a CSP `default-src`
   * directive to come from `*.meandu.app`, not from a third-party domain.
   *
   * Undefined when host doesn't apply (e.g. inline scripts) or wasn't
   * captured. HostMatcher fails-secure (returns false / unauthorized) when
   * this is missing.
   */
  host?: string
}

/**
 * Detected script structure for matcher operations.
 * Extends Matchable with required hash field for scripts.
 *
 * Contains script name (URL or identifier) and content for matching.
 * Backward compatible with existing code.
 */
export type DetectedScript = Matchable & {
  /**
   * SHA-256 hash of content (computed on detection).
   * Required for scripts (not optional like in base Matchable).
   */
  hash: SHA256Hash
}

/**
 * Generic strategy interface for script and header matching operations.
 *
 * Type parameter T allows matchers to work with any Matchable resource:
 * - Generic matchers (NameMatcher, ContentMatcher, HeaderNameMatcher): Matcher<Matchable>
 * - Script-specific matchers (HashMatcher): Matcher<DetectedScript>
 * - Composite matchers (OrMatcher, AndMatcher): Matcher<T extends Matchable>
 *
 * Implementations:
 * - NameMatcher: Matches by script name/URL using regex (case-sensitive)
 * - HeaderNameMatcher: Matches by header name using regex (case-insensitive per RFC 7230)
 * - ContentMatcher: Matches by script/header content using regex
 * - HashMatcher: Matches by cryptographic hash (SHA-256, scripts only)
 * - OrMatcher: Composite matcher with OR logic (any child matches)
 * - AndMatcher: Composite matcher with AND logic (all children match)
 *
 * Pattern: Strategy Pattern + Composite Pattern (per research.md R1, R2)
 */
export interface Matcher<T extends Matchable = Matchable> {
  /**
   * Returns the matcher type discriminator.
   * Used for logging, debugging, and type narrowing.
   */
  getType(): 'name' | 'header-name' | 'content' | 'hash' | 'host' | 'or' | 'and'

  /**
   * Returns the pattern, hashes, or child matchers used by this matcher.
   * - For NameMatcher/ContentMatcher/HeaderNameMatcher: regex pattern string
   * - For HashMatcher: array of authorized hashes with timestamps
   * - For OrMatcher/AndMatcher: array of child matchers
   */
  getPattern(): string | InventoryScriptHashInfo[] | Matcher<T>[]

  /**
   * Returns a human-readable description of this matcher for logging.
   * - For NameMatcher/ContentMatcher/HeaderNameMatcher: shows matcher type and truncated pattern
   * - For HashMatcher: shows hash count
   * - For OrMatcher/AndMatcher: shows child count and logic
   *
   * Example outputs:
   * - "name:/^https:\\/\\/example\\.com\\/script\\.js$/"
   * - "content:/fbq\\('init',/"
   * - "hash:3 authorized hashes"
   * - "or:5 matchers"
   * - "and:3 matchers"
   */
  getDescription(): string

  /**
   * Determines if the given resource matches this matcher's identification criteria.
   *
   * @param resource - The detected resource (script or header) to test
   * @returns true if resource matches, false otherwise
   *
   * Behavior by matcher type:
   * - NameMatcher: Tests resource.name against regex pattern
   * - HeaderNameMatcher: Tests resource.name against regex pattern (case-insensitive)
   * - ContentMatcher: Tests resource.content against regex pattern
   * - HashMatcher: Always returns false (hashes cannot identify, only authorize)
   * - OrMatcher: Returns true if ANY child identifies the resource
   * - AndMatcher: Returns true if ALL children identify the resource
   *
   * Edge cases:
   * - Null/empty resource.name (NameMatcher/HeaderNameMatcher): returns false
   * - Null/empty resource.content (ContentMatcher): returns false
   */
  identify(resource: T): boolean

  /**
   * Determines if the given resource's content is authorized.
   *
   * @param resource - The detected resource (script or header) to authorize
   * @returns AuthorizationResult with authorized flag, optional reason, and metadata path
   *
   * Behavior by matcher type:
   * - NameMatcher: Tests resource.content against regex pattern
   * - HeaderNameMatcher: Tests resource.content against regex pattern
   * - ContentMatcher: Tests resource.content against regex pattern
   * - HashMatcher: Computes SHA-256 hash of resource.content, checks against authorized hashes
   * - OrMatcher: Returns authorized if ANY child authorizes (first-match-wins)
   * - AndMatcher: Returns authorized if ALL children authorize (short-circuit on failure)
   *
   * Edge cases:
   * - Null/empty resource.content: returns { authorized: false, reason: "content is null or empty" }
   * - Top-level authorisationInfo.authorised: false always denies regardless of matcher result
   */
  authorize(resource: T): AuthorizationResult
}

/**
 * Matcher with optional authorization metadata.
 *
 * This interface extends Matcher to support matchers that carry their own
 * authorization metadata. This is essential for:
 * - Array syntax where each element has its own authorisationInfo
 * - Composite matchers where children have individual authorization metadata
 * - Preserving authorization context through serialization/deserialization
 *
 * All concrete matcher implementations (except HeaderNameMatcher which is only
 * used for identification) can be AuthorisationMatchers.
 *
 * @example
 * // Simple matcher with authorization metadata
 * const matcher = new ContentMatcher(/analytics/, {
 *   description: "Analytics script for conversion tracking",
 *   authorised: true,
 *   date: new Date('2025-10-21')
 * })
 *
 * @example
 * // Composite matcher with metadata at multiple levels
 * const matcher = new OrMatcher([
 *   new HashMatcher([hash1], { description: "Version 1.0", authorised: true, date: ... }),
 *   new HashMatcher([hash2], { description: "Version 2.0", authorised: true, date: ... })
 * ], { description: "Accept either version", authorised: true, date: ... })
 */
export interface AuthorisationMatcher<T extends Matchable = Matchable> extends Matcher<T> {
  /**
   * Optional authorization metadata for this matcher.
   * When present, provides audit trail context for authorization decisions.
   * When absent, matcher is purely structural (e.g., intermediate composite nodes).
   */
  getAuthorisationInfo(): AuthorisationInfo | undefined
}
