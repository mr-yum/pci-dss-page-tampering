import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, Matchable } from './matcher.interface.js'

/** Matches resources by the stable workflow id assigned by orchestration. */
export class WorkflowMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  getType(): 'workflow' {
    return 'workflow'
  }

  getPattern(): string {
    return this.pattern.source
  }

  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `workflow:/${truncated}/`
  }

  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  identify(resource: Matchable): boolean {
    return resource.workflowId !== undefined && resource.workflowId.trim() !== '' && this.pattern.test(resource.workflowId)
  }

  authorize(resource: Matchable): AuthorizationResult {
    if (resource.workflowId === undefined || resource.workflowId.trim() === '') {
      return { authorized: false, reason: 'workflow id is missing or empty' }
    }

    if (this.authorisationInfo?.authorised === false) {
      return {
        authorized: false,
        reason: `Top-level authorization denied: ${this.authorisationInfo.description}`,
        metadataPath: [this.authorisationInfo],
      }
    }

    const result: AuthorizationResult = this.pattern.test(resource.workflowId) ? { authorized: true } : { authorized: false, reason: `workflow '${resource.workflowId}' does not match pattern: ${this.pattern.source}` }

    if (this.authorisationInfo) result.metadataPath = [this.authorisationInfo]
    return result
  }
}
