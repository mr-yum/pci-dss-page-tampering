import { assertInventoryBranchReplacementSafe, prepareInventoryBranch } from './inventory-branch-coordinator.js'
import type { PullRequestService } from './pull-request.js'

const makePullRequestService = (): jest.Mocked<Pick<PullRequestService, 'findOpenPullRequest'>> => ({
  findOpenPullRequest: jest.fn(),
})

describe('assertInventoryBranchReplacementSafe', () => {
  it('aborts when a pull request opened during workflow execution', async () => {
    const pullRequestService = makePullRequestService()
    pullRequestService.findOpenPullRequest.mockResolvedValue({ url: 'https://github.com/example/inventory/pull/8' })

    await expect(assertInventoryBranchReplacementSafe({ ...baseArgs, pullRequestService }, 'inventory-updates')).rejects.toThrow('because it now has an open pull request')
  })

  it('permits replacement only after a fresh GitHub check finds no open pull request', async () => {
    const pullRequestService = makePullRequestService()
    pullRequestService.findOpenPullRequest.mockResolvedValue({ url: null })

    await expect(assertInventoryBranchReplacementSafe({ ...baseArgs, pullRequestService }, 'inventory-updates')).resolves.toBeUndefined()
    expect(pullRequestService.findOpenPullRequest).toHaveBeenCalledWith({ repoUrl: baseArgs.repository.url, gitToken: 'token', headBranch: 'inventory-updates' })
  })
})

const baseArgs = {
  repository: { url: 'https://github.com/example/inventory', clonePath: './pulled_repo' },
  branches: { inventory: 'inventory-updates', detection: 'main' },
  gitToken: 'token',
  log: jest.fn(),
} as const

describe('prepareInventoryBranch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('preserves a branch associated with an open pull request', async () => {
    const pullRequestService = makePullRequestService()
    pullRequestService.findOpenPullRequest.mockResolvedValue({ url: 'https://github.com/example/inventory/pull/7' })

    await expect(prepareInventoryBranch({ ...baseArgs, pullRequestService })).resolves.toEqual({ baseBranchName: 'main' })
    expect(baseArgs.log).toHaveBeenCalledWith('Inventory update branch is associated with an open pull request: https://github.com/example/inventory/pull/7')
  })

  it('restarts a GitHub update branch that has no open pull request', async () => {
    const pullRequestService = makePullRequestService()
    pullRequestService.findOpenPullRequest.mockResolvedValue({ url: null })

    await expect(prepareInventoryBranch({ ...baseArgs, pullRequestService })).resolves.toEqual({ baseBranchName: 'main', resetToBase: true })
  })

  it('leaves unsupported repository branch semantics unchanged', async () => {
    const pullRequestService = makePullRequestService()
    pullRequestService.findOpenPullRequest.mockResolvedValue(null)

    await expect(prepareInventoryBranch({ ...baseArgs, pullRequestService })).resolves.toEqual({ baseBranchName: 'main' })
  })

  it('does not query GitHub when inventory and detection use the same branch', async () => {
    const pullRequestService = makePullRequestService()

    await expect(prepareInventoryBranch({ ...baseArgs, branches: { inventory: 'main', detection: 'main' }, pullRequestService })).resolves.toEqual({ baseBranchName: 'main' })
    expect(pullRequestService.findOpenPullRequest).not.toHaveBeenCalled()
  })
})
