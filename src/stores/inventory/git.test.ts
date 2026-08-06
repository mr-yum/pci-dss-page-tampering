import { readdir } from 'fs/promises'
import { simpleGit } from 'simple-git'

import { PullTarget } from '../../types/target.js'
import { getInventoryFileNames } from '../../utils/file.js'
import { GitInventoryStore } from './git.js'

jest.mock('fs/promises', () => ({ readdir: jest.fn() }))
jest.mock('simple-git', () => ({ simpleGit: jest.fn() }))
jest.mock('../../utils/file.js', () => ({ getInventoryFileNames: jest.fn(), getRawInventoryFromFile: jest.fn() }))

const authenticatedTarget = 'https://x-access-token:ghp_super_secret@github.com/org/inventory'

function createStore(clone = jest.fn().mockResolvedValue(undefined), verifyBranchReplacement?: (branchName: string) => Promise<void>) {
  return {
    clone,
    store: new GitInventoryStore({
      gitClient: { clone } as never,
      repositoryTarget: authenticatedTarget,
      gitUserName: 'Inventory Bot',
      gitUserEmail: 'inventory@example.com',
      verifyBranchReplacement,
    }),
  }
}

describe('GitInventoryStore repository logging', () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    ;(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(['targets', 'workflows'] as never)
    ;(getInventoryFileNames as jest.MockedFunction<typeof getInventoryFileNames>).mockResolvedValue([])
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main'] }),
      checkout: jest.fn().mockResolvedValue(undefined),
    } as never)
  })

  afterAll(() => {
    consoleLog.mockRestore()
  })

  it('uses the credential-free repository target in clone and fetch logs', async () => {
    const { clone, store } = createStore()

    await store.pull(PullTarget.Detection, 'main')

    const output = consoleLog.mock.calls.flat().join('\n')
    expect(output).toContain("Cloning repository 'https://github.com/org/inventory'")
    expect(output).toContain("Fetching from repository 'https://github.com/org/inventory'")
    expect(output).not.toContain('ghp_super_secret')
    expect(clone).toHaveBeenCalledWith(authenticatedTarget, './pulled_repo')
  })

  it('records the inventory revision the pull read from', async () => {
    // Without a commit id, "detection ran against the inventory" is an
    // assertion an assessor cannot check. This is what makes it verifiable.
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main'] }),
      checkout: jest.fn().mockResolvedValue(undefined),
      revparse: jest.fn().mockResolvedValue('acece577a438c48985bec8eac857bff3ca13c678\n'),
      log: jest.fn().mockResolvedValue({ latest: { date: '2026-01-02T03:04:05.000Z' } }),
    } as never)

    const { store } = createStore()
    const result = await store.pull(PullTarget.Detection, 'main')

    expect(result.ref).toEqual({ branch: 'main', commitSha: 'acece577a438c48985bec8eac857bff3ca13c678', commitIsoDate: '2026-01-02T03:04:05.000Z' })
  })

  it('still returns the inventory when the revision cannot be read', async () => {
    // Best-effort: losing the commit id degrades the report, and must never
    // fail a detection run.
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main'] }),
      checkout: jest.fn().mockResolvedValue(undefined),
      revparse: jest.fn().mockRejectedValue(new Error('not a git repository')),
      log: jest.fn(),
    } as never)

    const { store } = createStore()
    const result = await store.pull(PullTarget.Detection, 'main')

    expect(result.ref).toBeUndefined()
    expect(result.payloads).toEqual([])
  })

  it('scrubs credentials from propagated clone errors', async () => {
    const clone = jest.fn().mockRejectedValue(new Error(`fatal: repository '${authenticatedTarget}?access_token=query_secret#fragment_secret' not found`))
    const { store } = createStore(clone)

    const error = await store.pull(PullTarget.Detection, 'main').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('https://[credentials-redacted]@github.com/org/inventory?[query-redacted]#[fragment-redacted]')
    expect((error as Error).message).not.toContain('ghp_super_secret')
    expect((error as Error).message).not.toContain('query_secret')
    expect((error as Error).message).not.toContain('fragment_secret')
  })

  it('starts a stale remote update branch from the configured base and pushes with a lease', async () => {
    const checkout = jest.fn().mockResolvedValue(undefined)
    const push = jest.fn().mockResolvedValue(undefined)
    const verifyBranchReplacement = jest.fn().mockResolvedValue(undefined)
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main', 'remotes/origin/inventory-updates'] }),
      checkout,
      addConfig: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push,
    } as never)
    const { store } = createStore(undefined, verifyBranchReplacement)

    await store.pull(PullTarget.Inventory, 'inventory-updates', { baseBranchName: 'main', resetToBase: true })
    await store.push([], 'inventory-updates')

    expect(checkout).toHaveBeenCalledWith(['-B', 'inventory-updates', 'origin/main'])
    expect(verifyBranchReplacement).toHaveBeenCalledWith('inventory-updates')
    expect(push).toHaveBeenCalledWith('origin', 'inventory-updates', ['--force-with-lease'])
  })

  it('does not replace a branch that entered review during the workflow run', async () => {
    const push = jest.fn().mockResolvedValue(undefined)
    const reviewError = new Error('branch now has an open pull request')
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main', 'remotes/origin/inventory-updates'] }),
      checkout: jest.fn().mockResolvedValue(undefined),
      addConfig: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push,
    } as never)
    const { store } = createStore(undefined, jest.fn().mockRejectedValue(reviewError))
    await store.pull(PullTarget.Inventory, 'inventory-updates', { baseBranchName: 'main', resetToBase: true })

    await expect(store.push([], 'inventory-updates')).rejects.toThrow(reviewError.message)
    expect(push).not.toHaveBeenCalled()
  })

  it('fails closed when a branch replacement verifier was not configured', async () => {
    const push = jest.fn().mockResolvedValue(undefined)
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main', 'remotes/origin/inventory-updates'] }),
      checkout: jest.fn().mockResolvedValue(undefined),
      addConfig: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push,
    } as never)
    const { store } = createStore()
    await store.pull(PullTarget.Inventory, 'inventory-updates', { baseBranchName: 'main', resetToBase: true })

    await expect(store.push([], 'inventory-updates')).rejects.toThrow('without a branch-review state verifier')
    expect(push).not.toHaveBeenCalled()
  })

  it('propagates a sanitized branch checkout failure', async () => {
    ;(simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue({
      fetch: jest.fn().mockResolvedValue(undefined),
      branch: jest.fn().mockResolvedValue({ all: ['remotes/origin/main'] }),
      checkout: jest.fn().mockRejectedValue(new Error(`fatal: ${authenticatedTarget}`)),
    } as never)
    const { store } = createStore()

    const error = await store.pull(PullTarget.Detection, 'main').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("Failed to switch to branch 'main'")
    expect((error as Error).message).not.toContain('ghp_super_secret')
  })
})
