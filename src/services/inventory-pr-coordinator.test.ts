import type { IAlertService } from '../interfaces/alert'
import type { BranchConfiguration, RepositoryConfiguration } from '../types/config'
import type { InventoryAlert } from '../types/inventory/model'
import { ensureInventoryPullRequest } from './inventory-pr-coordinator'
import type { PullRequestService } from './pull-request'

const makePullRequestService = (): jest.Mocked<Pick<PullRequestService, 'ensurePullRequest'>> => ({
  ensurePullRequest: jest.fn(),
})

const makeAlertService = (): jest.Mocked<Pick<IAlertService, 'alertOnPullRequestFailure'>> => ({
  alertOnPullRequestFailure: jest.fn().mockResolvedValue(undefined),
})

const baseRepository: RepositoryConfiguration = {
  url: 'https://github.com/org/inventory',
  clonePath: './pulled_repo',
}

const baseBranches: BranchConfiguration = {
  inventory: 'inventory-updates',
  detection: 'main',
}

const alertDestinations = {
  inventory: { newScriptIdentified: { destination: '#inventory' }, newHeaderIdentified: { destination: '#inventory' } },
  detection: { newScriptDetected: { destination: '#detection' }, scriptMismatchDetected: { destination: '#detection' }, newHeaderDetected: { destination: '#detection' } },
  successNotification: { destination: '#success' },
} satisfies InventoryAlert

describe('ensureInventoryPullRequest', () => {
  let pullRequestService: ReturnType<typeof makePullRequestService>
  let alertService: ReturnType<typeof makeAlertService>
  let log: jest.Mock

  beforeEach(() => {
    pullRequestService = makePullRequestService()
    alertService = makeAlertService()
    log = jest.fn()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const callWith = (overrides: Partial<Parameters<typeof ensureInventoryPullRequest>[0]> = {}) =>
    ensureInventoryPullRequest({
      pullRequestService: pullRequestService as unknown as PullRequestService,
      alertService: alertService as unknown as IAlertService,
      repository: baseRepository,
      branches: baseBranches,
      gitToken: 'ghp_test',
      commitMessage: 'chore(inventory): update hashes\n\nBody line one\nBody line two',
      alertDestinations,
      log,
      ...overrides,
    })

  it('opens a PR with commit message as title/body, logs the URL', async () => {
    pullRequestService.ensurePullRequest.mockResolvedValueOnce({ url: 'https://github.com/org/inventory/pull/5', created: true })

    await callWith()

    expect(pullRequestService.ensurePullRequest).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/org/inventory',
      gitToken: 'ghp_test',
      headBranch: 'inventory-updates',
      baseBranch: 'main',
      title: 'chore(inventory): update hashes',
      body: expect.stringContaining('Body line one\nBody line two'),
    })
    expect(pullRequestService.ensurePullRequest.mock.calls[0]![0]!.body).toContain('Auto-opened to trigger `--mode validate`')
    expect(log).toHaveBeenCalledWith('Opened pull request: https://github.com/org/inventory/pull/5')
  })

  it('logs a reuse message when an existing PR is returned', async () => {
    pullRequestService.ensurePullRequest.mockResolvedValueOnce({ url: 'https://github.com/org/inventory/pull/7', created: false })

    await callWith()

    expect(log).toHaveBeenCalledWith('Pull request already open, reusing: https://github.com/org/inventory/pull/7')
  })

  it('logs a skip message when the service returns null (non-github repo)', async () => {
    pullRequestService.ensurePullRequest.mockResolvedValueOnce(null)

    await callWith({ repository: { url: 'file:///tmp/inventory', clonePath: './pulled_repo' } })

    expect(log).toHaveBeenCalledWith("Skipping PR creation: 'file:///tmp/inventory' is not a GitHub HTTPS repository.")
  })

  it('skips without calling the service when branches are identical', async () => {
    await callWith({ branches: { inventory: 'main', detection: 'main' } })

    expect(pullRequestService.ensurePullRequest).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith("Skipping PR creation: --inventory-branch and --detection-branch are both 'main'.")
  })

  it('skips without calling the service when gitToken is empty', async () => {
    await callWith({ gitToken: '' })

    expect(pullRequestService.ensurePullRequest).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Skipping PR creation: no --git-token provided.')
  })

  it('alerts and rethrows when PR creation fails', async () => {
    const error = new Error('403 Resource not accessible by integration')
    pullRequestService.ensurePullRequest.mockRejectedValueOnce(error)

    await expect(callWith()).rejects.toBe(error)

    expect(alertService.alertOnPullRequestFailure).toHaveBeenCalledWith({ error, repoUrl: 'https://github.com/org/inventory', headBranch: 'inventory-updates', baseBranch: 'main' }, alertDestinations)
  })

  it('skips the alert when alertDestinations is null but still rethrows', async () => {
    const error = new Error('boom')
    pullRequestService.ensurePullRequest.mockRejectedValueOnce(error)

    await expect(callWith({ alertDestinations: null })).rejects.toBe(error)

    expect(alertService.alertOnPullRequestFailure).not.toHaveBeenCalled()
  })
})
