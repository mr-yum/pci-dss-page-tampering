import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IAlertService } from '../interfaces/alert.js'
import type { IInventoryService } from '../interfaces/inventory.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { PullTarget } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { QueueMessage, QueueSource, RawQueueEntry } from './drain.js'
import { type RumCompareDeps, runRumCompare } from './run.js'

const silentLogger: Logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

// Fixture pattern mirrors src/rum/route.test.ts: entries are built with the
// real matcher factory and evaluated by the real comparison service.
const inventoryEntry = (namePattern: string): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: namePattern }),
  authoriseWith: {
    matcher: createMatcher({ contentMatcher: 'console\\.log' }),
    authorisationInfo: { description: 'Test entry', authorised: true, date: new Date() },
  },
})

const makeInventory = (fileName: string, scripts: InventoryScriptInfo[], workflowName?: { inventory: string; detection: string }): Inventory => ({
  fileName,
  target: {
    workflows: [
      {
        id: 'wf-1',
        inventory: {
          type: 'inventory',
          ...(workflowName === undefined ? {} : { name: workflowName.inventory }),
          url: 'https://staging.example.com',
          workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
          logger: silentLogger,
        },
        detection: {
          type: 'detection',
          ...(workflowName === undefined ? {} : { name: workflowName.detection }),
          url: 'https://pay.example.com/checkout',
          workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
          logger: silentLogger,
        },
      },
    ],
  },
  alerts: {
    inventory: {
      newScriptIdentified: { destination: 'inventory-script-channel' },
      newHeaderIdentified: { destination: 'inventory-header-channel' },
    },
    detection: {
      newScriptDetected: { destination: 'detection-script-channel' },
      scriptMismatchDetected: { destination: 'script-mismatch-channel' },
      newHeaderDetected: { destination: 'detection-header-channel' },
    },
    successNotification: { destination: 'success-channel' },
  },
  scripts,
  headers: [],
})

const queueMessage = (overrides: Partial<QueueMessage> = {}): QueueMessage => ({
  v: 1,
  target_id: '1.0',
  target_type: 'detection',
  observation: { kind: 'external-script', ts: 1755600000000, route: '/checkout', url: 'https://evil.example.org/skim.js', initiator: 'https://pay.example.com/checkout' },
  novelty: { pk: '1.0#url:https://evil.example.org/skim.js#pay.example.com', first_seen: 1755600000123, first_route: '/checkout' },
  received_at: 1755600000500,
  session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  ...overrides,
})

const entryOf = (message: QueueMessage, id = 'msg-1'): RawQueueEntry => ({ id, body: JSON.stringify(message) })

class FakeQueueSource implements QueueSource {
  deleted: string[] = []
  deadLettered: { id: string; reason: string }[] = []

  constructor(private readonly batches: RawQueueEntry[][]) {}

  async receiveBatch(): Promise<RawQueueEntry[]> {
    return this.batches.shift() ?? []
  }

  async delete(entry: RawQueueEntry): Promise<void> {
    this.deleted.push(entry.id)
  }

  async deadLetter(entry: RawQueueEntry, reason: string): Promise<void> {
    this.deadLettered.push({ id: entry.id, reason })
  }
}

const makeInventoryService = (detectionInventories: Inventory[], inventoryInventories: Inventory[], refs: { detection: string | null; inventory: string | null } = { detection: 'de7ec7104ef', inventory: '1abe11edref' }) => {
  const pull = jest.fn(async (target: PullTarget) => (target === PullTarget.Detection ? detectionInventories : inventoryInventories))
  const getLastPullRef = jest
    .fn()
    .mockReturnValueOnce(refs.detection === null ? null : { branch: 'main', commitSha: refs.detection, commitIsoDate: null })
    .mockReturnValueOnce(refs.inventory === null ? null : { branch: 'inventory-updates', commitSha: refs.inventory, commitIsoDate: null })
  return { pull, getLastPullRef, service: { pull, getLastPullRef } as unknown as IInventoryService }
}

const makeAlertService = () => {
  const alertForRumObservation = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined)
  return { mock: alertForRumObservation, service: { alertForRumObservation } as unknown as IAlertService }
}

const makeDeps = (overrides: Partial<RumCompareDeps> = {}): { deps: RumCompareDeps; alertMock: jest.Mock } => {
  const { mock, service } = makeAlertService()
  const deps: RumCompareDeps = {
    inventoryService: makeInventoryService([makeInventory('1.0.json', [inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])], [makeInventory('1.0.json', [])]).service,
    scriptComparison: new ScriptComparisonService(),
    alertService: service,
    queueSource: new FakeQueueSource([]),
    branches: { inventory: 'inventory-updates', detection: 'main' },
    reportDir: null,
    log: silentLogger,
    ...overrides,
  }
  return { deps, alertMock: mock }
}

describe('runRumCompare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads both passes and reports their inventory refs on an empty queue', async () => {
    const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])])
    const { deps } = makeDeps({ inventoryService: inventoryService.service })

    const summary = await runRumCompare(deps)

    expect(inventoryService.pull).toHaveBeenCalledWith(PullTarget.Detection, 'main')
    expect(inventoryService.pull).toHaveBeenCalledWith(PullTarget.Inventory, 'inventory-updates')
    expect(summary).toEqual({
      processed: 0,
      routed: 0,
      invalid: 0,
      failed: 0,
      unknownTargetIds: 0,
      outcomes: { alerted: 0, recorded: 0, recordedPending: 0, duplicateSuppressed: 0 },
      alertedByCategory: {},
      alertDeliveryFailures: 0,
      inventoryRefs: {
        detection: { branch: 'main', commitSha: 'de7ec7104ef' },
        inventory: { branch: 'inventory-updates', commitSha: '1abe11edref' },
      },
    })
  })

  it('alerts on an uninventoried detection observation, stamped with the detection-pass SHA', async () => {
    const queueSource = new FakeQueueSource([[entryOf(queueMessage())]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock).toHaveBeenCalledWith('rum_uninventoried_script_detected', expect.objectContaining({ inventoryRef: 'de7ec7104ef', targetType: 'detection' }), expect.anything())
    expect(queueSource.deleted).toEqual(['msg-1'])
    expect(summary.processed).toBe(1)
    expect(summary.routed).toBe(1)
    expect(summary.outcomes.alerted).toBe(1)
    expect(summary.alertedByCategory).toEqual({ rum_uninventoried_script_detected: 1 })
  })

  it('records an identified external script without alerting', async () => {
    const queueSource = new FakeQueueSource([[entryOf(queueMessage({ observation: { kind: 'external-script', ts: 1755600000000, route: '/checkout', url: 'https://cdn.example.com/known.js' } }))]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).not.toHaveBeenCalled()
    expect(summary.outcomes.recorded).toBe(1)
    expect(summary.routed).toBe(1)
  })

  it('suppresses a duplicate delivery within the run via one shared seen set', async () => {
    const message = queueMessage()
    const queueSource = new FakeQueueSource([[entryOf(message, 'msg-1'), entryOf(message, 'msg-2')]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(summary.outcomes.alerted).toBe(1)
    expect(summary.outcomes.duplicateSuppressed).toBe(1)
    expect(summary.routed).toBe(2)
  })

  it('dead-letters a message whose target_id no pass knows, without deleting it', async () => {
    const queueSource = new FakeQueueSource([[entryOf(queueMessage({ target_id: 'no-such-target' }))]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).not.toHaveBeenCalled()
    expect(queueSource.deleted).toEqual([])
    expect(queueSource.deadLettered).toEqual([{ id: 'msg-1', reason: 'handler reported skip-dlq' }])
    expect(summary.failed).toBe(1)
    expect(summary.unknownTargetIds).toBe(1)
    expect(summary.routed).toBe(0)
  })

  it('resolves a named workflow variation as a target_id', async () => {
    const inventoryService = makeInventoryService([makeInventory('1.0.json', [], { inventory: 'stg-a', detection: 'prod-a' })], [makeInventory('1.0.json', [], { inventory: 'stg-a', detection: 'prod-a' })])
    const queueSource = new FakeQueueSource([[entryOf(queueMessage({ target_id: 'prod-a' }))]])
    const { deps, alertMock } = makeDeps({ inventoryService: inventoryService.service, queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(summary.routed).toBe(1)
    expect(summary.unknownTargetIds).toBe(0)
  })

  it('tallies an inventory-pass message as recorded-pending (T031 stub) and routes it', async () => {
    const queueSource = new FakeQueueSource([[entryOf(queueMessage({ target_type: 'inventory' }))]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).not.toHaveBeenCalled()
    expect(summary.outcomes.recordedPending).toBe(1)
    expect(summary.routed).toBe(1)
  })

  it('falls back to the branch name as the routing ref when the store reports no SHA', async () => {
    const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])], { detection: null, inventory: null })
    const queueSource = new FakeQueueSource([[entryOf(queueMessage())]])
    const { deps, alertMock } = makeDeps({ inventoryService: inventoryService.service, queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ inventoryRef: 'main' }), expect.anything())
    expect(summary.inventoryRefs.detection).toEqual({ branch: 'main', commitSha: null })
    expect(summary.inventoryRefs.inventory).toEqual({ branch: 'inventory-updates', commitSha: null })
  })

  it('counts schema-invalid messages without handing them to routing', async () => {
    const queueSource = new FakeQueueSource([[{ id: 'bad-1', body: 'not json' }]])
    const { deps, alertMock } = makeDeps({ queueSource })

    const summary = await runRumCompare(deps)

    expect(alertMock).not.toHaveBeenCalled()
    expect(summary.invalid).toBe(1)
    expect(summary.routed).toBe(0)
  })

  describe('--report-dir artefact', () => {
    let reportDir: string

    beforeEach(async () => {
      reportDir = await mkdtemp(join(tmpdir(), 'rum-summary-'))
    })

    afterEach(async () => {
      await rm(reportDir, { recursive: true, force: true })
    })

    it('writes rum-compare/rum-summary.json when a report dir is configured', async () => {
      const queueSource = new FakeQueueSource([[entryOf(queueMessage())]])
      const { deps } = makeDeps({ queueSource, reportDir })

      const summary = await runRumCompare(deps)

      const written = JSON.parse(await readFile(join(reportDir, 'rum-compare', 'rum-summary.json'), 'utf8'))
      expect(written).toEqual({ ...summary, completedAt: expect.any(String) })
    })

    it('never fails the run when the summary cannot be written', async () => {
      // /dev/null is a file, so mkdir beneath it must fail — the run logs the
      // miss and still resolves with the summary.
      const { deps } = makeDeps({ reportDir: '/dev/null/not-a-dir' })

      const summary = await runRumCompare(deps)

      expect(summary.processed).toBe(0)
      expect(silentLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to write the RUM run summary'))
    })
  })
})
