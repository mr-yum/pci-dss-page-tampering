/**
 * HostMatcher Implementation
 *
 * Matches resources (scripts or response headers) by the host portion of the
 * originating URL using a regex pattern. The host is the value `Matchable.host`
 * carries — populated by the detection layer from `response.url()` (headers)
 * or the script URL (external scripts). Inline scripts and any resource where
 * the host couldn't be extracted leave `host` undefined; HostMatcher
 * fails-secure on those (returns false / unauthorized).
 *
 * Use cases:
 * - Restrict CSP directive authorisation to a known first-party host:
 *     identifyWith: andMatcher: [{ headerNameMatcher: "^content-security-policy$" },
 *                                 { hostMatcher: "^.*\\.meandu\\.app$" }]
 * - Authorise scripts only when served from a specific CDN:
 *     authoriseWith: { hostMatcher: "^cdn\\.example\\.com$", ... }
 *
 * HostMatcher purposefully does NOT consume `content` — it only inspects the
 * origin, which means it can be combined with other matchers under
 * AndMatcher/OrMatcher to express "from this host AND with this content".
 *
 * @see matcher.interface.ts for the Matchable contract (host? field)
 */

import type { AuthorizationResult } from './authorization-result'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface'

export class HostMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'host' {
    return 'host'
  }

  getPattern(): string {
    return this.pattern.source
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `host:/${truncated}/`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  /**
   * Fail-secure when `host` is missing. Inline scripts, blob URLs, or any
   * resource the detection layer couldn't extract a host for will never
   * identify under a HostMatcher — operators must use a different matcher
   * (NameMatcher / ContentMatcher) for those.
   */
  identify(resource: Matchable): boolean {
    if (!resource.host || resource.host.trim() === '') {
      return false
    }
    return this.pattern.test(resource.host)
  }

  authorize(resource: Matchable): AuthorizationResult {
    if (!resource.host || resource.host.trim() === '') {
      return {
        authorized: false,
        reason: 'host is null or empty',
      }
    }

    const matches = this.pattern.test(resource.host)
    const result: AuthorizationResult = matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `host does not match pattern: ${this.pattern.source}`,
        }

    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }
}
