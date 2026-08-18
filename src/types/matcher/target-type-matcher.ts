import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

/**
 * Matches resources by which pass observed them: `inventory` or `detection`.
 *
 * `WorkflowMatcher` cannot express this. A workflow id names a checkout
 * variation, and one variation owns both an inventory target and a detection
 * target, so `workflowMatcher` is live during both passes. That makes a
 * staging-only origin impossible to authorise without also trusting it on the
 * production payment page.
 *
 * Combine with the other matchers to scope an entry to one environment:
 *
 *   andMatcher: [
 *     { targetTypeMatcher: '^inventory$' },
 *     { nameMatcher: '^https://sandbox\\.provider\\.example/.+$' },
 *   ]
 *
 * Fails secure when the target type is missing or empty.
 */
export class TargetTypeMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'targetType' {
    return 'targetType'
  }

  getPattern(): string {
    return this.pattern.source
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `target-type:/${truncated}/`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  identify(resource: Matchable): boolean {
    return resource.targetType !== undefined && resource.targetType.trim() !== '' && this.pattern.test(resource.targetType)
  }

  authorize(resource: Matchable): AuthorizationResult {
    if (resource.targetType === undefined || resource.targetType.trim() === '') {
      return { authorized: false, reason: 'target type is missing or empty' }
    }

    if (this.authorisationInfo?.authorised === false) {
      return {
        authorized: false,
        reason: `Top-level authorization denied: ${this.authorisationInfo.description}`,
        metadataPath: [this.authorisationInfo],
      }
    }

    const result: AuthorizationResult = this.pattern.test(resource.targetType) ? { authorized: true } : { authorized: false, reason: `target type '${resource.targetType}' does not match pattern: ${this.pattern.source}` }

    if (this.authorisationInfo) result.metadataPath = [this.authorisationInfo]
    return result
  }
}
