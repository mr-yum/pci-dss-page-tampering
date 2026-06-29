/**
 * HostMatcher Implementation
 *
 * Matches a resource (script or response header) by the host portion of its
 * originating URL. `Matchable.url` is the single source of truth — this
 * matcher derives the host from it on the fly so an inventory entry like
 * `hostMatcher: "^([^.]+\\.)*meandu\\.app$"` matches every CSP directive
 * emitted by any `*.meandu.app` response, regardless of path. Use
 * `UrlMatcher` instead when you need to discriminate by path or query.
 *
 * `Matchable.url` is populated for:
 *   - Response headers (URL of the emitting response).
 *   - External scripts (the script's own URL).
 *   - Inline scripts (initiator URL captured by the page-attribution shim).
 *
 * HostMatcher fails-secure (returns false / unauthorized) when `url` is
 * missing or unparseable.
 *
 * @see matcher.interface.ts — Matchable.url contract
 * @see url-matcher.ts — sibling matcher for full-URL precision
 */

import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

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
   * Extract host from `resource.url`. Returns `null` when url is missing or
   * unparseable so callers can fail-secure uniformly across identify/authorize.
   */
  private deriveHost(resource: Matchable): string | null {
    if (!resource.url || resource.url.trim() === '') return null
    try {
      const host = new URL(resource.url).host
      return host.length > 0 ? host : null
    } catch {
      return null
    }
  }

  identify(resource: Matchable): boolean {
    const host = this.deriveHost(resource)
    if (host === null) return false
    return this.pattern.test(host)
  }

  authorize(resource: Matchable): AuthorizationResult {
    const host = this.deriveHost(resource)
    if (host === null) {
      return {
        authorized: false,
        reason: 'url is missing or unparseable',
      }
    }

    const matches = this.pattern.test(host)
    const result: AuthorizationResult = matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `host '${host}' does not match pattern: ${this.pattern.source}`,
        }

    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }
}
