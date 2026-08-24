/**
 * InitiatorHostMatcher Implementation
 *
 * Matches a script by the host portion of `Matchable.initiator` — the URL of
 * whatever inserted or loaded it — so an inventory entry can constrain WHO
 * may load a script, independent of the script's own URL. The RUM novelty key
 * deliberately includes the initiator host so a known script re-injected by a
 * new source re-enters evaluation; this matcher is where the inventory
 * decides what to do with that event, as loose or tight as the author wants:
 *
 *   identifyWith: {
 *     andMatcher: [
 *       { nameMatcher: "^https://cdn\\.example\\.net/sdk\\.js$" },
 *       { initiatorHostMatcher: "^pay\\.example\\.com$" }
 *     ]
 *   }
 *
 * With that entry, the SDK arriving via any other initiator fails
 * identification and alerts as an uninventoried script — the supply-chain
 * signal the novelty key exists to surface. The collector never makes this
 * decision; it only dedupes and forwards.
 *
 * Evidence availability (fail-secure applies wherever it is absent):
 *   - RUM external and inline observations carry the initiator.
 *   - Synthetic inline scripts carry it (page-attribution shim).
 *   - Synthetic external scripts carry it via the CDP request initiator.
 *
 * Fails secure (returns false / unauthorized) when `initiator` is missing or
 * unparseable — per the evidence-aware principle, on ITS OWN evidence only.
 *
 * @see matcher.interface.ts — Matchable.initiator contract
 * @see host-matcher.ts — the sibling matcher for the resource's own URL
 */

import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

export class InitiatorHostMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'initiator-host' {
    return 'initiator-host'
  }

  getPattern(): string {
    return this.pattern.source
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `initiator-host:/${truncated}/`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  /**
   * Extract host from `resource.initiator`. Returns `null` when the initiator
   * is missing or unparseable so identify/authorize fail-secure uniformly.
   */
  private deriveInitiatorHost(resource: Matchable): string | null {
    if (!resource.initiator || resource.initiator.trim() === '') return null
    try {
      const host = new URL(resource.initiator).host
      return host.length > 0 ? host : null
    } catch {
      return null
    }
  }

  identify(resource: Matchable): boolean {
    const host = this.deriveInitiatorHost(resource)
    if (host === null) return false
    return this.pattern.test(host)
  }

  authorize(resource: Matchable): AuthorizationResult {
    const host = this.deriveInitiatorHost(resource)
    if (host === null) {
      return {
        authorized: false,
        reason: 'initiator is missing or unparseable',
      }
    }

    const matches = this.pattern.test(host)
    const result: AuthorizationResult = matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `initiator host '${host}' does not match pattern: ${this.pattern.source}`,
        }

    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }
}
