import { readdir } from 'fs/promises'
import { simpleGit } from 'simple-git'

import { PullTarget } from '../../types/target.js'
import { getInventoryFileNames } from '../../utils/file.js'
import { GitInventoryStore } from './git.js'

jest.mock('fs/promises', () => ({ readdir: jest.fn() }))
jest.mock('simple-git', () => ({ simpleGit: jest.fn() }))
jest.mock('../../utils/file.js', () => ({ getInventoryFileNames: jest.fn(), getRawInventoryFromFile: jest.fn() }))

const authenticatedTarget = 'https://x-access-token:ghp_super_secret@github.com/org/inventory'

function createStore(clone = jest.fn().mockResolvedValue(undefined)) {
  return {
    clone,
    store: new GitInventoryStore({
      gitClient: { clone } as never,
      repositoryTarget: authenticatedTarget,
      gitUserName: 'Inventory Bot',
      gitUserEmail: 'inventory@example.com',
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

  it('scrubs credentials from propagated clone errors', async () => {
    const clone = jest.fn().mockRejectedValue(new Error(`fatal: repository '${authenticatedTarget}' not found`))
    const { store } = createStore(clone)

    const error = await store.pull(PullTarget.Detection, 'main').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('https://[credentials-redacted]@github.com/org/inventory')
    expect((error as Error).message).not.toContain('ghp_super_secret')
  })
})
