/**
 * Mode-dispatch test for `--mode rum-compare` (T023).
 *
 * main.ts runs on import, so this suite sets argv, stubs process.exit, then
 * imports the module and waits for the exit call. The RUM runner itself is
 * mocked — its behaviour is covered by src/rum/run.test.ts; what matters here
 * is that the mode dispatches to it without ever launching a browser.
 */

const mockLaunch = jest.fn()
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: mockLaunch } }))

const mockRunRumCompare = jest.fn()
jest.mock('./rum/run.js', () => ({ runRumCompare: mockRunRumCompare }))

describe('main dispatch for --mode rum-compare', () => {
  const originalArgv = process.argv
  let exitSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    mockRunRumCompare.mockResolvedValue({ processed: 0 })
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.argv = originalArgv
    jest.restoreAllMocks()
  })

  const waitForExit = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      if (exitSpy.mock.calls.length > 0) return
      await new Promise((resolve) => setImmediate(resolve))
    }
    throw new Error('main() never called process.exit')
  }

  it('routes rum-compare mode to the RUM runner and exits 0 without launching a browser', async () => {
    process.argv = [
      'node',
      'main.js',
      '--mode',
      'rum-compare',
      '--repo',
      'file:///tmp/inventory-repo',
      '--git-token',
      'dummy',
      '--rum-queue-url',
      'file:///tmp/rum-queue',
      '--detection-branch',
      'main',
      '--inventory-branch',
      'inventory-updates',
    ]

    // Tests are transformed to CommonJS, so load the module synchronously —
    // module evaluation kicks off main() as a floating promise.
    jest.requireActual('./main.js')
    await waitForExit()

    expect(mockRunRumCompare).toHaveBeenCalledTimes(1)
    expect(mockRunRumCompare).toHaveBeenCalledWith(
      expect.objectContaining({
        branches: { inventory: 'inventory-updates', detection: 'main' },
        reportDir: null,
        queueSource: expect.anything(),
        inventoryService: expect.anything(),
        scriptComparison: expect.anything(),
        alertService: expect.anything(),
        log: expect.anything(),
      }),
    )
    expect(mockLaunch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
