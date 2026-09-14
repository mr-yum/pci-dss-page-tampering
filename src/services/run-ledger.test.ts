import type { IAlertService } from '../interfaces/alert.js'
import { ExecutionMode } from '../types/config.js'
import type { InventoryAlert } from '../types/inventory/model.js'
import { RunLedger, TargetRunFailuresError } from './run-ledger.js'

const destinations: InventoryAlert = {
  inventory: { newScriptIdentified: { destination: '#alerts' }, newHeaderIdentified: { destination: '#alerts' } },
  detection: { newScriptDetected: { destination: '#alerts' }, scriptMismatchDetected: { destination: '#alerts' }, newHeaderDetected: { destination: '#alerts' } },
  successNotification: { destination: '#alerts' },
}

function makeAlertService(events: string[], behaviour: 'ok' | 'throw' = 'ok'): IAlertService {
  return {
    alertOnRunCompletion: jest.fn(async () => {
      events.push('summary-sent')
      if (behaviour === 'throw') throw new Error('slack down')
    }),
  } as unknown as IAlertService
}

function finishInput(alertService: IAlertService, alertDestinations: InventoryAlert | null = destinations) {
  return {
    alertService,
    alertDestinations,
    mode: ExecutionMode.All,
    repositoryUrl: 'https://github.example.com/org/inventory',
    inventoryBranch: 'inventory-updates',
    detectionBranch: 'main',
    executionStartTime: Date.now() - 1000,
    auditorReport: null,
  }
}

describe('RunLedger', () => {
  let logs: string[]
  let ledger: RunLedger

  beforeEach(() => {
    logs = []
    ledger = new RunLedger((message) => logs.push(message))
  })

  it('sends the summary and returns normally when every target succeeded', async () => {
    const events: string[] = []
    const alertService = makeAlertService(events)
    ledger.recordSuccess('1.0 Stripe staging', 10)
    ledger.recordSuccess('1.0 Stripe staging', 5) // same name twice keeps one entry, sums resources

    await expect(ledger.finish(finishInput(alertService))).resolves.toBeUndefined()

    const summary = (alertService.alertOnRunCompletion as jest.Mock).mock.calls[0][0]
    expect(summary.targetsProcessed).toEqual(['1.0 Stripe staging'])
    expect(summary.targetsFailed).toEqual([])
    expect(summary.resourceCount).toBe(15)
  })

  it('sends the summary before throwing, and the thrown error names every failed target with its pass', async () => {
    const events: string[] = []
    const alertService = makeAlertService(events)
    ledger.recordSuccess('1.0 Stripe staging', 3)
    ledger.recordFailure('1.0 Toast staging', 'inventory', new Error('Timed out waiting for selector \'[id="credit_card_number"]\''))
    ledger.recordFailure('2.0 Paystack production', 'detection', 'net::ERR_NAME_NOT_RESOLVED')

    let thrown: unknown
    try {
      await ledger.finish(finishInput(alertService))
    } catch (error) {
      events.push('thrown')
      thrown = error
    }

    expect(events).toEqual(['summary-sent', 'thrown'])
    expect(thrown).toBeInstanceOf(TargetRunFailuresError)
    expect((thrown as Error).message).toBe('2 target run(s) failed: 1.0 Toast staging (inventory), 2.0 Paystack production (detection). The remaining targets were processed; see the run summary and the auditor report.')
    const summary = (alertService.alertOnRunCompletion as jest.Mock).mock.calls[0][0]
    expect(summary.targetsProcessed).toEqual(['1.0 Stripe staging'])
    expect(summary.targetsFailed).toEqual([
      { name: '1.0 Toast staging', pass: 'inventory', reason: 'Timed out waiting for selector \'[id="credit_card_number"]\'' },
      { name: '2.0 Paystack production', pass: 'detection', reason: 'net::ERR_NAME_NOT_RESOLVED' },
    ])
  })

  it('still throws for the failed targets when the summary itself could not be sent', async () => {
    const events: string[] = []
    const alertService = makeAlertService(events, 'throw')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ledger.recordFailure('1.0 Toast staging', 'inventory', new Error('boom'))

    await expect(ledger.finish(finishInput(alertService))).rejects.toBeInstanceOf(TargetRunFailuresError)

    expect(events).toEqual(['summary-sent'])
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Main]: Failed to send the run summary notification:', expect.any(Error))
    consoleErrorSpy.mockRestore()
  })

  it('summarises a run in which every target failed, and exits through the same error', async () => {
    const alertService = makeAlertService([])
    ledger.recordFailure('1.0', 'detection', new Error('browser crashed'))

    await expect(ledger.finish(finishInput(alertService))).rejects.toBeInstanceOf(TargetRunFailuresError)

    const summary = (alertService.alertOnRunCompletion as jest.Mock).mock.calls[0][0]
    expect(summary.targetsProcessed).toEqual([])
    expect(summary.targetsFailed).toHaveLength(1)
  })

  it('redacts the failure reason the same way the auditor report does', () => {
    const failure = ledger.recordFailure('1.0', 'inventory', new Error('fatal: unable to access https://x-access-token:ghp_secret123@github.example.com/org/inventory.git/?token=abc: 403'))

    expect(failure.reason).not.toContain('ghp_secret123')
    expect(failure.reason).not.toContain('token=abc')
    expect(failure.reason).toContain('github.example.com')
    expect(logs[0]).toContain("Target '1.0' failed during the inventory pass")
    expect(logs[0]).not.toContain('ghp_secret123')
  })

  it('sends nothing and does not throw when no target was attempted', async () => {
    const alertService = makeAlertService([])

    await expect(ledger.finish(finishInput(alertService))).resolves.toBeUndefined()

    expect(alertService.alertOnRunCompletion).not.toHaveBeenCalled()
    expect(logs).toEqual(['No targets attempted, skipping the run summary.'])
  })

  it('skips the summary without alert destinations but still fails the run for failed targets', async () => {
    const alertService = makeAlertService([])
    ledger.recordFailure('1.0', 'inventory', new Error('boom'))

    await expect(ledger.finish(finishInput(alertService, null))).rejects.toBeInstanceOf(TargetRunFailuresError)

    expect(alertService.alertOnRunCompletion).not.toHaveBeenCalled()
  })
})
