import type { InventoryPullOptions } from '../interfaces/inventory.js'
import type { BranchConfiguration, RepositoryConfiguration } from '../types/config.js'
import { redactRepositoryTarget } from '../utils/url.js'
import type { PullRequestService } from './pull-request.js'

export type PrepareInventoryBranchArgs = Readonly<{
  pullRequestService: Pick<PullRequestService, 'findOpenPullRequest'>
  repository: RepositoryConfiguration
  branches: BranchConfiguration
  gitToken: string
  log: (message: string) => void
}>

/**
 * Decide whether an update branch is still active before using it as the
 * inventory source. An open PR proves the branch is intentional and preserves
 * its reviewed work. A GitHub branch with no open PR is treated as stale and
 * locally restarted from the current detection branch; its next push is
 * protected by force-with-lease.
 */
export async function prepareInventoryBranch(args: PrepareInventoryBranchArgs): Promise<InventoryPullOptions> {
  const { pullRequestService, repository, branches, gitToken, log } = args
  const baseBranchName = branches.detection

  if (branches.inventory === baseBranchName || gitToken.length === 0) {
    return { baseBranchName }
  }

  const result = await pullRequestService.findOpenPullRequest({
    repoUrl: repository.url,
    gitToken,
    headBranch: branches.inventory,
  })

  if (result === null) {
    log(`Skipping inventory branch lifecycle check: '${redactRepositoryTarget(repository.url)}' is not a GitHub HTTPS repository.`)
    return { baseBranchName }
  }

  if (result.url !== null) {
    log(`Inventory update branch is associated with an open pull request: ${result.url}`)
    return { baseBranchName }
  }

  log(`Inventory branch '${branches.inventory}' has no open pull request; starting it from current '${baseBranchName}'.`)
  return { baseBranchName, resetToBase: true }
}

/** Recheck immediately before replacing a remote branch after a long run. */
export async function assertInventoryBranchReplacementSafe(args: PrepareInventoryBranchArgs, branchName: string): Promise<void> {
  const result = await args.pullRequestService.findOpenPullRequest({
    repoUrl: args.repository.url,
    gitToken: args.gitToken,
    headBranch: branchName,
  })

  if (result === null) {
    throw new Error(`Cannot verify whether inventory branch '${branchName}' is under review because the repository is not a GitHub HTTPS repository`)
  }
  if (result.url !== null) {
    throw new Error(`Refusing to replace inventory branch '${branchName}' because it now has an open pull request: ${result.url}`)
  }
}
