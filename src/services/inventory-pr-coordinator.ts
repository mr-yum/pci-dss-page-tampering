import type { IAlertService } from '../interfaces/alert'
import type { BranchConfiguration, RepositoryConfiguration } from '../types/config'
import type { InventoryAlert } from '../types/inventory/model'
import type { PullRequestService } from './pull-request'

export type EnsureInventoryPullRequestArgs = Readonly<{
  pullRequestService: PullRequestService
  alertService: IAlertService
  repository: RepositoryConfiguration
  branches: BranchConfiguration
  gitToken: string
  commitMessage: string
  alertDestinations: InventoryAlert | null
  log: (message: string) => void
}>

/**
 * Open (or reuse) a pull request so the inventory repo's CI `--mode validate`
 * check runs against the update. Returns the PR URL on success (or when an
 * existing PR is reused), `null` when skipped (file://, same branch, no token).
 *
 * Failures here throw — the inventory commit is already on the remote, so a
 * missed PR is a compliance gap that the operator must resolve manually. The
 * caller lets the error bubble to the process exit.
 */
export async function ensureInventoryPullRequest(args: EnsureInventoryPullRequestArgs): Promise<string | null> {
  const { pullRequestService, alertService, repository, branches, gitToken, commitMessage, alertDestinations, log } = args
  const headBranch = branches.inventory
  const baseBranch = branches.detection

  if (headBranch === baseBranch) {
    log(`Skipping PR creation: --inventory-branch and --detection-branch are both '${headBranch}'.`)
    return null
  }

  if (gitToken.length === 0) {
    log('Skipping PR creation: no --git-token provided.')
    return null
  }

  const [titleLine, ...bodyLines] = commitMessage.split('\n')
  const normalizedTitle = (titleLine ?? '').trim()
  const title = normalizedTitle.length > 0 ? normalizedTitle : 'chore(inventory): auto-update'
  const body = [bodyLines.join('\n').trim(), `Auto-opened to trigger \`--mode validate\` CI validation of this inventory update.`].filter((segment) => segment.length > 0).join('\n\n')

  try {
    const result = await pullRequestService.ensurePullRequest({
      repoUrl: repository.url,
      gitToken,
      headBranch,
      baseBranch,
      title,
      body,
    })

    if (result === null) {
      log(`Skipping PR creation: '${repository.url}' is not a GitHub HTTPS repository.`)
      return null
    }

    log(result.created ? `Opened pull request: ${result.url}` : `Pull request already open, reusing: ${result.url}`)
    return result.url
  } catch (error) {
    console.error('[InventoryPRCoordinator]: Failed to create pull request after inventory push:', error)
    if (alertDestinations !== null) {
      await alertService.alertOnPullRequestFailure({ error, repoUrl: repository.url, headBranch, baseBranch }, alertDestinations)
    }
    throw error
  }
}
