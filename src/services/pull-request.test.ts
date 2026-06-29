import axios from 'axios'

import { PullRequestService } from './pull-request.js'

jest.mock('axios')

const mockedAxios = axios as jest.Mocked<typeof axios>

const baseArgs = {
  repoUrl: 'https://github.com/org/inventory',
  gitToken: 'ghp_test',
  headBranch: 'inventory-updates',
  baseBranch: 'main',
  title: 'chore(inventory): update hashes',
  body: 'details\n\nAuto-opened to trigger validate CI.',
} as const

describe('PullRequestService.ensurePullRequest', () => {
  let service: PullRequestService

  beforeEach(() => {
    service = new PullRequestService()
    jest.clearAllMocks()
  })

  it('creates a PR when none currently exists', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] })
    mockedAxios.post.mockResolvedValueOnce({ data: { html_url: 'https://github.com/org/inventory/pull/1' } })

    const result = await service.ensurePullRequest({ ...baseArgs })

    expect(result).toEqual({ url: 'https://github.com/org/inventory/pull/1', created: true })
    expect(mockedAxios.get).toHaveBeenCalledTimes(1)
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/inventory/pulls',
      { title: baseArgs.title, body: baseArgs.body, head: 'inventory-updates', base: 'main' },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
        timeout: 15_000,
      }),
    )
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 15_000 }))
  })

  it('reuses an existing open PR instead of creating', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [{ html_url: 'https://github.com/org/inventory/pull/42' }] })

    const result = await service.ensurePullRequest({ ...baseArgs })

    expect(result).toEqual({ url: 'https://github.com/org/inventory/pull/42', created: false })
    expect(mockedAxios.post).not.toHaveBeenCalled()
  })

  it('returns null for file:// repositories', async () => {
    const result = await service.ensurePullRequest({ ...baseArgs, repoUrl: 'file:///tmp/inventory' })

    expect(result).toBeNull()
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(mockedAxios.post).not.toHaveBeenCalled()
  })

  it('returns null for non-github.com hosts', async () => {
    const result = await service.ensurePullRequest({ ...baseArgs, repoUrl: 'https://gitlab.com/org/inventory' })

    expect(result).toBeNull()
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  it('swallows 422 "already exists" from POST and re-queries for the existing PR', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] })
    ;(mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true)
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 422, data: { errors: [{ message: 'A pull request already exists for org:inventory-updates.' }] } },
    })
    mockedAxios.get.mockResolvedValueOnce({ data: [{ html_url: 'https://github.com/org/inventory/pull/7' }] })

    const result = await service.ensurePullRequest({ ...baseArgs })

    expect(result).toEqual({ url: 'https://github.com/org/inventory/pull/7', created: false })
    expect(mockedAxios.get).toHaveBeenCalledTimes(2)
  })

  it('propagates non-422 errors from POST', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] })
    ;(mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true)
    const error = {
      isAxiosError: true,
      response: { status: 403, data: { message: 'Resource not accessible by integration' } },
    }
    mockedAxios.post.mockRejectedValueOnce(error)

    await expect(service.ensurePullRequest({ ...baseArgs })).rejects.toBe(error)
  })

  it('URL-encodes branch names with slashes in the GET query', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [] })
    mockedAxios.post.mockResolvedValueOnce({ data: { html_url: 'https://github.com/org/inventory/pull/2' } })

    await service.ensurePullRequest({ ...baseArgs, headBranch: 'feature/x', baseBranch: 'release/v2.0' })

    const [getUrl] = mockedAxios.get.mock.calls[0]!
    expect(getUrl).toContain('head=org:feature%2Fx')
    expect(getUrl).toContain('base=release%2Fv2.0')
  })
})
