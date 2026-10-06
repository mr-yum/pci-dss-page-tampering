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
 * Transitive form (`{ "initiatorHostMatcher": { "host": "<regex>",
 * "transitive": true, "maxDepth": 8 } }`): the pattern is tested against the
 * host of EVERY hop of `Matchable.initiatorChain` (and of any forked path in
 * `alternateInitiatorChains`), up to `maxDepth` hops out — so "anything loaded,
 * however indirectly, by a script from js.example" is one matcher. Its
 * evidence is the chain, not `initiator`:
 *   - chain missing or empty → deny (`initiator chain is missing`);
 *   - a chain ending in an `unknown` hop is evaluated over its known prefix
 *     only — nothing past a hop the monitor could not tie to an observation is
 *     assumed;
 *   - inline hops (`inline_script/…`) carry no host and are skipped, the walk
 *     continuing through them;
 *   - a non-match denies with a reason that spells the chain out.
 * A match on any recorded path counts. That is sound because every path
 * starts at the same immediate inserter (exact evidence for this script);
 * paths differ only in how an ancestor itself arrived.
 *
 * @see matcher.interface.ts — Matchable.initiator contract
 * @see host-matcher.ts — the sibling matcher for the resource's own URL
 */

import { chainPaths, describeChain, hopHost, hopHostLabel, INITIATOR_CHAIN_MAX_DEPTH, type InitiatorHop, knownPrefix } from '../initiator-chain.js'
import { type AuthorizationResult, deniedByAuthorisationInfo } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

/** How far out the chain a transitive matcher looks. Omitted options mean the immediate-hop form. */
export type InitiatorHostMatcherOptions = {
  transitive: true
  /** Hops considered, 1..`INITIATOR_CHAIN_MAX_DEPTH`. Defaults to the maximum. */
  maxDepth?: number
}

export class InitiatorHostMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined
  private readonly options: InitiatorHostMatcherOptions | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined, options: InitiatorHostMatcherOptions | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
    if (options !== undefined) {
      const maxDepth = options.maxDepth ?? INITIATOR_CHAIN_MAX_DEPTH
      if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > INITIATOR_CHAIN_MAX_DEPTH) {
        throw new Error(`initiatorHostMatcher.maxDepth must be an integer from 1 to ${INITIATOR_CHAIN_MAX_DEPTH}, got ${options.maxDepth}`)
      }
      this.options = { transitive: true, ...(options.maxDepth !== undefined ? { maxDepth } : {}) }
    }
  }

  getType(): 'initiator-host' {
    return 'initiator-host'
  }

  getPattern(): string {
    return this.pattern.source
  }

  /** The transitive options, or undefined for the immediate-hop (string) form. Used to serialise the entry back. */
  getOptions(): InitiatorHostMatcherOptions | undefined {
    return this.options
  }

  private maxDepth(): number {
    return this.options?.maxDepth ?? INITIATOR_CHAIN_MAX_DEPTH
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return this.options === undefined ? `initiator-host:/${truncated}/` : `initiator-host(transitive, ≤${this.maxDepth()} hops):/${truncated}/`
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

  /** The hops a transitive match may consider, per recorded path: known prefix, capped at `maxDepth`. */
  private evaluablePaths(resource: Matchable): InitiatorHop[][] {
    return chainPaths(resource).map((path) => knownPrefix(path).slice(0, this.maxDepth()))
  }

  private transitiveMatch(resource: Matchable): boolean {
    return this.evaluablePaths(resource).some((path) =>
      path.some((hop) => {
        const host = hopHost(hop)
        return host !== null && this.pattern.test(host)
      }),
    )
  }

  identify(resource: Matchable): boolean {
    if (this.options !== undefined) return this.transitiveMatch(resource)
    const host = this.deriveInitiatorHost(resource)
    if (host === null) return false
    return this.pattern.test(host)
  }

  authorize(resource: Matchable): AuthorizationResult {
    return this.options !== undefined ? this.authorizeTransitive(resource) : this.authorizeImmediate(resource)
  }

  private authorizeImmediate(resource: Matchable): AuthorizationResult {
    const host = this.deriveInitiatorHost(resource)
    if (host === null) {
      return {
        authorized: false,
        reason: 'initiator is missing or unparseable',
      }
    }

    const declined = deniedByAuthorisationInfo(this.authorisationInfo)
    if (declined) return declined

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

  private authorizeTransitive(resource: Matchable): AuthorizationResult {
    const paths = chainPaths(resource)
    if (paths.length === 0) return { authorized: false, reason: 'initiator chain is missing' }
    const declined = deniedByAuthorisationInfo(this.authorisationInfo)
    if (declined) return declined

    const result: AuthorizationResult = this.transitiveMatch(resource)
      ? { authorized: true }
      : {
          authorized: false,
          reason: `no hop within ${this.maxDepth()} of the initiator chain has a host matching pattern ${this.pattern.source}: ${paths.map((path) => describeChain(path.slice(0, this.maxDepth()), hopHostLabel)).join('; or ')}`,
        }

    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }
}
