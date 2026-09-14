import type { IAlertService } from '../interfaces/alert.js'
import { ExecutionMode } from '../types/config.js'
import type { AlertDeliveryFailure } from '../types/execution-summary.js'
import type { InventoryAlert } from '../types/inventory/model.js'
import { RunFailuresError, RunLedger } from './run-ledger.js'

const destinations: InventoryAlert = {
  inventory: { newScriptIdentified: { destination: '#alerts' }, newHeaderIdentified: { destination: '#alerts' } },
  detection: { newScriptDetected: { destination: '#alerts' }, scriptMismatchDetected: { destination: '#alerts' }, newHeaderDetected: { destination: '#alerts' } },
  successNotification: { destination: '#alerts' },
}

function makeAlertService(events: string[], behaviour: 'ok' | 'throw' = 'ok', deliveryFailures: AlertDeliveryFailure[] = []): IAlertService {
  return {
    alertOnRunCompletion: jest.fn(async () => {
      events.push('summary-sent')
      if (behaviour === 'throw') throw new Error('slack down')
    }),
    getDeliveryFailures: () => deliveryFailures,
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
    expect(thrown).toBeInstanceOf(RunFailuresError)
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

    await expect(ledger.finish(finishInput(alertService))).rejects.toBeInstanceOf(RunFailuresError)

    expect(events).toEqual(['summary-sent'])
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Main]: Failed to send the run summary notification:', expect.any(Error))
    consoleErrorSpy.mockRestore()
  })

  it('summarises a run in which every target failed, and exits through the same error', async () => {
    const alertService = makeAlertService([])
    ledger.recordFailure('1.0', 'detection', new Error('browser crashed'))

    await expect(ledger.finish(finishInput(alertService))).rejects.toBeInstanceOf(RunFailuresError)

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

    await expect(ledger.finish(finishInput(alertService, null))).rejects.toBeInstanceOf(RunFailuresError)

    expect(alertService.alertOnRunCompletion).not.toHaveBeenCalled()
  })

  it('fails the run for an undelivered alert even when every target succeeded, and names it in the summary first', async () => {
    const events: string[] = []
    const rejected: AlertDeliveryFailure = { alert: 'unauthorized header alerts', target: 'https://pay.example.com/checkout', reason: 'Slack rejected the message: invalid_blocks' }
    const alertService = makeAlertService(events, 'ok', [rejected])
    ledger.recordSuccess('reservations production', 300)

    let thrown: unknown
    try {
      await ledger.finish(finishInput(alertService))
    } catch (error) {
      events.push('thrown')
      thrown = error
    }

    expect(events).toEqual(['summary-sent', 'thrown'])
    expect(thrown).toBeInstanceOf(RunFailuresError)
    expect((thrown as Error).message).toContain('1 alert(s) could not be delivered: unauthorized header alerts for https://pay.example.com/checkout')
    const summary = (alertService.alertOnRunCompletion as jest.Mock).mock.calls[0][0]
    expect(summary.targetsFailed).toEqual([])
    expect(summary.alertsUndelivered).toEqual([rejected])
    expect(logs.some((line) => line.includes('Alert could not be delivered (unauthorized header alerts for https://pay.example.com/checkout)'))).toBe(true)
  })

  it('does not double count a delivery failure handed over twice', () => {
    const failure: AlertDeliveryFailure = { alert: 'x', target: null, reason: 'boom' }
    ledger.recordUndeliveredAlerts([failure])
    ledger.recordUndeliveredAlerts([failure])

    expect(ledger.alertsUndelivered).toHaveLength(1)
  })

  it('counts a run summary that could not be sent as an undelivered alert and exits non-zero for it', async () => {
    const alertService = makeAlertService([], 'throw')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ledger.recordSuccess('1.0', 1)

    await expect(ledger.finish(finishInput(alertService))).rejects.toMatchObject({ name: 'RunFailuresError', message: expect.stringContaining('run summary') })

    expect(ledger.alertsUndelivered).toEqual([{ alert: 'run summary', target: null, reason: 'slack down' }])
    consoleErrorSpy.mockRestore()
  })

  it('picks up a delivery failure the service records while sending the summary itself', async () => {
    const recorded: AlertDeliveryFailure[] = []
    const alertService = {
      alertOnRunCompletion: jest.fn(async () => {
        // Mirrors SlackAlertService: a rejected summary is caught and recorded, never thrown.
        recorded.push({ alert: 'the run summary notification', target: null, reason: 'Slack rejected the message: invalid_blocks' })
      }),
      getDeliveryFailures: () => recorded,
    } as unknown as IAlertService
    ledger.recordSuccess('1.0', 1)

    await expect(ledger.finish(finishInput(alertService))).rejects.toMatchObject({ name: 'RunFailuresError', message: expect.stringContaining('the run summary notification') })

    expect(ledger.alertsUndelivered).toEqual(recorded)
  })
})
