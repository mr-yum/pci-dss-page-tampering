/**
 * Authorization Result Type
 *
 * Result of an authorization check performed by a Matcher.
 * Contains authorization status and optional failure reason for debugging.
 */

/**
 * Result of an authorization check.
 */
export type AuthorizationResult = {
  /**
   * Whether the script content is authorized.
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
   */
  reason?: string
}
