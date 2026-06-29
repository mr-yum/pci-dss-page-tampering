/**
 * UrlMatcher Implementation
 *
 * Matches a resource (script or response header) by its full originating
 * URL — host + path + query — using a regex pattern. Use this when the
 * inventory needs path-level precision (e.g. only `out-*.js` from
 * `m.stripe.network`, not arbitrary paths). For host-only matching use the
 * sibling `HostMatcher` which derives the host from the same `Matchable.url`.
 *
 * Fails-secure (returns false / unauthorized) when `url` is missing.
 *
 * @see matcher.interface.ts — Matchable.url contract
 * @see host-matcher.ts — sibling matcher for host-only matching
 */

import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

export class UrlMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'url' {
    return 'url'
  }

  getPattern(): string {
    return this.pattern.source
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `url:/${truncated}/`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  identify(resource: Matchable): boolean {
    if (!resource.url || resource.url.trim() === '') return false
    return this.pattern.test(resource.url)
  }

  authorize(resource: Matchable): AuthorizationResult {
    if (!resource.url || resource.url.trim() === '') {
      return {
        authorized: false,
        reason: 'url is missing or empty',
      }
    }

    const matches = this.pattern.test(resource.url)
    const result: AuthorizationResult = matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `url '${resource.url}' does not match pattern: ${this.pattern.source}`,
        }

    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }
}
