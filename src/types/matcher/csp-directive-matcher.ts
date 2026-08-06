import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

/** The one wildcard `allow` understands. @see CspDirectiveMatcher */
export const CSP_ANY_NONCE = "'nonce-*'"

/** A single-response nonce source expression, per CSP's base64-value grammar. */
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/u

/**
 * Matches one Content-Security-Policy directive by its set of source
 * expressions, rather than by the literal text of the header value.
 *
 * A regex over a CSP directive is brittle by construction: reordering the
 * sources, or dropping one, produces a value that is semantically identical or
 * strictly safer yet fails to match, so every deploy mints another authorised
 * alternative. Real inventory entries accumulate a dozen-plus near-duplicate
 * regexes as a result.
 *
 * This compares the two source **sets** instead: a permutation of the same
 * sources is the same policy and passes, while any difference in membership —
 * added or removed — fails, and the reason names exactly which sources moved.
 *
 * Removals are **not** tolerated, despite being intuitively "safer". Some CSP
 * sources only suppress others while present, so dropping one can widen the
 * policy rather than narrow it:
 *
 * - `script-src 'self' 'unsafe-inline' 'nonce-…'` → drop the nonce and
 *   `'unsafe-inline'` stops being ignored and becomes live (CSP2/3).
 * - `script-src 'strict-dynamic' 'nonce-…' https:` → drop `'strict-dynamic'`
 *   and the `https:` scheme-source starts matching every HTTPS origin.
 * - `require-trusted-types-for 'script'` → drop the source and enforcement is
 *   simply off.
 *
 * A change-detection control that stays silent on those is not doing its job,
 * so membership must match exactly and every CSP change gets a human look.
 *
 * Source expressions are compared **exactly**, with one exception:
 * `'nonce-*'` in `allow` matches a single-response nonce, one for one. A nonce
 * is regenerated per response, so pinning a value would fail on the very next
 * request; this mirrors what the inventory already expresses by hand as
 * `'nonce-[A-Za-z0-9+/=]+'`. It is a placeholder, not a quantifier: two
 * observed nonces against one `'nonce-*'` is a difference and is reported.
 *
 * Host wildcards are **not** expanded: the subject is the policy text, so
 * `https://*.example.com` and `https://a.example.com` are different assertions
 * and a change between them is worth reporting. Directive names are compared
 * case-insensitively, as CSP defines them; source expressions are
 * case-sensitive, so a nonce cannot be matched by a differently-cased one.
 *
 * @see ../../services/comparison/header.ts for how header values reach a matcher
 */
export class CspDirectiveMatcher implements AuthorisationMatcher {
  private readonly directive: string
  private readonly allow: ReadonlySet<string>
  private readonly allowOrdered: readonly string[]
  private readonly expectedNonces: number
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(directive: string, allow: readonly string[], authorisationInfo: AuthorisationInfo | undefined = undefined) {
    const normalisedDirective = directive.trim().toLowerCase()

    if (normalisedDirective === '') throw new Error('CspDirectiveMatcher requires a directive name')

    this.directive = normalisedDirective
    this.allowOrdered = [...allow]
    this.allow = new Set(allow)
    this.expectedNonces = this.allowOrdered.filter((source) => source === CSP_ANY_NONCE).length
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'csp-directive' {
    return 'csp-directive'
  }

  /** The canonical policy text this matcher approves, for logs and reports. */
  getPattern(): string {
    return [this.directive, ...this.allowOrdered].join(' ')
  }

  getDirective(): string {
    return this.directive
  }

  getAllowedSources(): readonly string[] {
    return this.allowOrdered
  }

  getDescription(): string {
    return `csp-directive:${this.directive} (${this.allowOrdered.length} allowed source${this.allowOrdered.length === 1 ? '' : 's'})`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  /**
   * Identify only a value this matcher would also authorise.
   *
   * Deliberately strict, mirroring HashMatcher. `OrMatcher` picks the *first*
   * child that identifies and never tries another, so a matcher that identified
   * on directive name alone would make sibling alternatives for the same
   * directive unreachable — only the first would ever be consulted, and every
   * other approved variant of that directive would be reported unauthorised.
   */
  identify(resource: Matchable): boolean {
    const parsed = this.parse(resource.content)

    if (parsed === null || parsed.directive !== this.directive) return false

    return this.compareSets(parsed.sources).length === 0
  }

  authorize(resource: Matchable): AuthorizationResult {
    const parsed = this.parse(resource.content)

    if (parsed === null) {
      return { authorized: false, reason: 'content is null or empty' }
    }

    if (parsed.directive !== this.directive) {
      return { authorized: false, reason: `expected directive '${this.directive}' but found '${parsed.directive}'` }
    }

    if (this.authorisationInfo?.authorised === false) {
      return {
        authorized: false,
        reason: `Top-level authorization denied: ${this.authorisationInfo.description}`,
        metadataPath: [this.authorisationInfo],
      }
    }

    const differences = this.compareSets(parsed.sources)

    const result: AuthorizationResult =
      differences.length === 0
        ? { authorized: true }
        : {
            authorized: false,
            reason: `${this.directive} differs from the approved policy: ${differences.join('; ')}`,
          }

    if (this.authorisationInfo) result.metadataPath = [this.authorisationInfo]

    return result
  }

  /**
   * Describe every membership difference between observed and approved.
   *
   * Additions and removals are both reported, and separately, so the finding
   * says which way the policy moved.
   */
  private compareSets(observed: readonly string[]): string[] {
    const observedNonces = observed.filter((source) => NONCE_SOURCE.test(source))
    const observedRest = new Set(observed.filter((source) => !NONCE_SOURCE.test(source)))

    const added = [...observedRest].filter((source) => !this.allow.has(source))
    const removed = this.allowOrdered.filter((source) => source !== CSP_ANY_NONCE && !observedRest.has(source))

    const differences: string[] = []

    if (added.length > 0) differences.push(`${added.length} added source${added.length === 1 ? '' : 's'}: ${added.join(' ')}`)
    if (removed.length > 0) differences.push(`${removed.length} approved source${removed.length === 1 ? '' : 's'} no longer present: ${removed.join(' ')}`)

    // A nonce placeholder stands for exactly one nonce. An extra nonce is an
    // extra script-execution channel; a missing one can make an approved
    // 'unsafe-inline' live.
    if (observedNonces.length !== this.expectedNonces) {
      differences.push(`expected ${this.expectedNonces} nonce source${this.expectedNonces === 1 ? '' : 's'} but found ${observedNonces.length}`)
    }

    return differences
  }

  /**
   * Split a directive value into its name and source expressions.
   *
   * Returns null for content that cannot be a directive at all, so callers
   * fail secure rather than treating an empty value as an empty source list.
   */
  private parse(content: string | null | undefined): { directive: string; sources: string[] } | null {
    if (content === null || content === undefined) return null

    // A trailing ';' survives when a policy is split on directive boundaries.
    const tokens = content
      .replace(/;\s*$/u, '')
      .trim()
      .split(/\s+/u)
      .filter((token) => token !== '')

    if (tokens.length === 0) return null

    return { directive: tokens[0]!.toLowerCase(), sources: tokens.slice(1) }
  }
}
