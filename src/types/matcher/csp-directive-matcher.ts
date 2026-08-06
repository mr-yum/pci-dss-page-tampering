import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

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
 * This compares sets instead:
 *
 * - **Order-insensitive** — a permutation of the same sources is the same policy.
 * - **Tolerant of removals** — a policy that allows fewer origins than approved
 *   is strictly safer, so it passes.
 * - **Strict about additions** — a source that is not in `allow` fails, and the
 *   failure reason names it. That is the direction an attacker moves in, and
 *   the one an assessor cares about.
 *
 * Source expressions are compared **exactly**. Wildcards are not expanded: the
 * subject is the policy text, so `https://*.example.com` and
 * `https://a.example.com` are different assertions and a change between them is
 * a change worth reporting. Directive names are compared case-insensitively,
 * as CSP defines them.
 *
 * @see ../../services/comparison/header.ts for how header values reach a matcher
 */
export class CspDirectiveMatcher implements AuthorisationMatcher {
  private readonly directive: string
  private readonly allow: ReadonlySet<string>
  private readonly allowOrdered: readonly string[]
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(directive: string, allow: readonly string[], authorisationInfo: AuthorisationInfo | undefined = undefined) {
    const normalisedDirective = directive.trim().toLowerCase()

    if (normalisedDirective === '') throw new Error('CspDirectiveMatcher requires a directive name')

    this.directive = normalisedDirective
    this.allowOrdered = [...allow]
    this.allow = new Set(allow)
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

  identify(resource: Matchable): boolean {
    return this.parse(resource.content)?.directive === this.directive
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

    // Subset semantics: only sources absent from `allow` are a problem.
    const unapproved = parsed.sources.filter((source) => !this.allow.has(source))

    const result: AuthorizationResult =
      unapproved.length === 0
        ? { authorized: true }
        : {
            authorized: false,
            reason: `${this.directive} allows ${unapproved.length} source${unapproved.length === 1 ? '' : 's'} not in the approved set: ${unapproved.join(' ')}`,
          }

    if (this.authorisationInfo) result.metadataPath = [this.authorisationInfo]

    return result
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
