import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IAlertService } from '../interfaces/alert.js'
import type { IScriptInventoryRepository } from '../interfaces/inventory.js'
import { ScriptComparisonService } from '../services/comparison/script.js'
import { ScriptInventoryService } from '../services/inventory.js'
import type { SHA256Hash } from '../types/hash.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { PullTarget } from '../types/target.js'
import type { Logger } from '../utils/logger.js'
import type { QueueMessage, QueueSource, RawQueueEntry } from './drain.js'
import { type RumCompareDeps, runRumCompare } from './run.js'

const silentLogger: Logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }

// Fixture pattern mirrors src/rum/route.test.ts: entries are built with the
// real matcher factory and evaluated by the real comparison service.
const inventoryEntry = (namePattern: string, authorisedHashes: string[] = []): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: namePattern }),
  authoriseWith: {
    matcher: authorisedHashes.length > 0 ? createMatcher({ hashes: authorisedHashes.map((hash) => ({ timestamp: new Date(), hash: { value: hash } as SHA256Hash })) }) : createMatcher({ contentMatcher: 'console\\.log' }),
    authorisationInfo: { description: 'Test entry', authorised: true, date: new Date() },
  },
})

/** An unapproved entry from an earlier run, exactly as the diff writes it. */
const pendingEntry = (namePattern: string): InventoryScriptInfo => ({
  identifyWith: createMatcher({ nameMatcher: namePattern }),
  authoriseWith: {
    matcher: createMatcher({ nameMatcher: namePattern }),
    authorisationInfo: { description: 'NO_DESCRIPTION', authorised: false, date: new Date() },
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

/**
 * A REAL ScriptInventoryService over a faked Git repository, so the candidate
 * flow (diff → matcher generation → idempotency → push gating) is exercised
 * by the actual production logic; only cloning and pushing are faked.
 */
const makeInventoryService = (detectionInventories: Inventory[], inventoryInventories: Inventory[], refs: { detection: string | null; inventory: string | null } = { detection: 'de7ec7104ef', inventory: '1abe11edref' }) => {
  const pull = jest.fn(async (target: PullTarget) => (target === PullTarget.Detection ? detectionInventories : inventoryInventories))
  const getLastPullRef = jest
    .fn()
    .mockReturnValueOnce(refs.detection === null ? null : { branch: 'main', commitSha: refs.detection, commitIsoDate: null })
    .mockReturnValueOnce(refs.inventory === null ? null : { branch: 'inventory-updates', commitSha: refs.inventory, commitIsoDate: null })
  // Mirrors ScriptInventoryRepository.push's contract: a non-null commit
  // message means a commit was pushed.
  const push = jest.fn(async (_inventories: Inventory[], _branchName?: string, commitMessage?: string) => (commitMessage ? { pushed: true as const, commitMessage } : { pushed: false as const }))
  const repository = { pull, getLastPullRef, push } as unknown as IScriptInventoryRepository
  return { pull, getLastPullRef, push, service: new ScriptInventoryService({ inventoryRepository: repository }) }
}

const makeAlertService = () => {
  const alertForRumObservation = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined)
  return { mock: alertForRumObservation, service: { alertForRumObservation } as unknown as IAlertService }
}

const makeDeps = (overrides: Partial<RumCompareDeps> = {}): { deps: RumCompareDeps; alertMock: jest.Mock; ensurePullRequest: jest.Mock } => {
  const { mock, service } = makeAlertService()
  const ensurePullRequest = jest.fn<Promise<string | null>, unknown[]>().mockResolvedValue(null)
  const deps: RumCompareDeps = {
    inventoryService: makeInventoryService([makeInventory('1.0.json', [inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])], [makeInventory('1.0.json', [])]).service,
    scriptComparison: new ScriptComparisonService(),
    alertService: service,
    queueSource: new FakeQueueSource([]),
    branches: { inventory: 'inventory-updates', detection: 'main' },
    reportDir: null,
    log: silentLogger,
    ensurePullRequest: ensurePullRequest as unknown as RumCompareDeps['ensurePullRequest'],
    ...overrides,
  }
  return { deps, alertMock: mock, ensurePullRequest }
}

describe('runRumCompare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads both passes and reports their inventory refs on an empty queue', async () => {
    const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])])
    const { deps } = makeDeps({ inventoryService: inventoryService.service })

    const summary = await runRumCompare(deps)

    expect(inventoryService.pull).toHaveBeenCalledWith(PullTarget.Detection, 'main', undefined)
    // Same base semantics as --mode inventory: a missing inventory branch
    // starts from the detection branch.
    expect(inventoryService.pull).toHaveBeenCalledWith(PullTarget.Inventory, 'inventory-updates', { baseBranchName: 'main' })
    expect(summary).toEqual({
      processed: 0,
      routed: 0,
      invalid: 0,
      failed: 0,
      unknownTargetIds: 0,
      outcomes: { alerted: 0, recorded: 0, candidate: 0, duplicateSuppressed: 0 },
      alertedByCategory: {},
      alertDeliveryFailures: 0,
      candidates: { byTarget: {}, entriesAppended: 0, pushed: false, prUrl: null },
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

  describe('inventory-pass candidate flow (US3)', () => {
    const NOVEL_URL = 'https://sandbox.newpay.example/sdk.js'
    const NOVEL_PATTERN = '^https://sandbox\\.newpay\\.example/sdk\\.js$'

    const novelStagingMessage = (pk = `1.0#url:${NOVEL_URL}#staging.example.com`): QueueMessage =>
      queueMessage({
        target_type: 'inventory',
        observation: { kind: 'external-script', ts: 1755600000000, route: '/checkout', url: NOVEL_URL, initiator: 'https://staging.example.com/checkout' },
        novelty: { pk, first_seen: 1755600000123, first_route: '/checkout' },
      })

    const inlineStagingMessage = (hash: string): QueueMessage =>
      queueMessage({
        target_type: 'inventory',
        observation: { kind: 'inline-script', ts: 1755600000000, route: '/checkout', hash, length: 42, head: 'window.__init(', tail: ');', initiator: 'https://staging.example.com/checkout' },
        novelty: { pk: `1.0#inline:${hash}#staging.example.com`, first_seen: 1755600000123, first_route: '/checkout' },
      })

    it('turns a novel staging script into one pending entry, pushed to the inventory branch with a PR', async () => {
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [inventoryEntry('^https://cdn\\.example\\.com/known\\.js$')])])
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage())]])
      const { deps, alertMock, ensurePullRequest } = makeDeps({ inventoryService: inventoryService.service, queueSource })

      const summary = await runRumCompare(deps)

      expect(alertMock).not.toHaveBeenCalled()
      expect(summary.outcomes.candidate).toBe(1)
      expect(summary.candidates).toEqual({ byTarget: { '1.0': 1 }, entriesAppended: 1, pushed: true, prUrl: null })
      expect(queueSource.deleted).toEqual(['msg-1'])

      // Pushed to the inventory branch with the standard commit message.
      expect(inventoryService.push).toHaveBeenCalledTimes(1)
      const [pushedInventories, pushedBranch, commitMessage] = inventoryService.push.mock.calls[0] as [Inventory[], string, string]
      expect(pushedBranch).toBe('inventory-updates')
      expect(commitMessage).toBe('inventory(1.0): add 1 script')

      // The appended entry: exact-name identification (matcher generation
      // reused from ScriptInventoryService), explicitly unauthorised, and —
      // because external RUM scripts carry no hash — authorised-by-exact-name
      // rather than a fabricated hash.
      const pushed = pushedInventories[0]!
      expect(pushed.scripts).toHaveLength(2)
      const appended = pushed.scripts[1]!
      expect(appended.identifyWith.getType()).toBe('name')
      // RegExp.source normalises `/` to `\/`, hence the doubled escaping.
      expect(appended.identifyWith.getPattern()).toBe('^https:\\/\\/sandbox\\.newpay\\.example\\/sdk\\.js$')
      expect(appended.authoriseWith.matcher.getType()).toBe('name')
      expect(appended.authoriseWith.authorisationInfo.authorised).toBe(false)

      // PR flow invoked exactly as --mode inventory would.
      expect(ensurePullRequest).toHaveBeenCalledTimes(1)
      expect(ensurePullRequest).toHaveBeenCalledWith('inventory(1.0): add 1 script', pushed.alerts)
    })

    it('the automated system never authorises: pre-existing authorised entries are untouched and every appended entry is authorised: false', async () => {
      const mismatchHash = 'b'.repeat(64)
      const identifiedEntry = inventoryEntry('^inline_script/rum:', ['c'.repeat(64)])
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [identifiedEntry])])
      // An identified inline script whose hash is NOT authorised: the synthetic
      // pass would append the hash to the identified entry (a de facto
      // authorisation) — the RUM lane must produce an unauthorised candidate.
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage(), 'msg-1'), entryOf(inlineStagingMessage(mismatchHash), 'msg-2')]])
      const { deps } = makeDeps({ inventoryService: inventoryService.service, queueSource })

      const summary = await runRumCompare(deps)

      expect(summary.outcomes.candidate).toBe(2)
      expect(summary.candidates.entriesAppended).toBe(2)

      const [pushedInventories] = inventoryService.push.mock.calls[0] as [Inventory[]]
      const pushed = pushedInventories[0]!
      // The identified entry kept its single authorised hash — nothing was
      // appended to it, and it is still the only authorised entry.
      expect(identifiedEntry.authoriseWith.matcher.getPattern()).toHaveLength(1)
      expect(pushed.scripts.filter((script) => script.authoriseWith.authorisationInfo.authorised)).toEqual([identifiedEntry])
      // Every appended candidate is explicitly unauthorised, and the inline
      // one pins the observed hash for the human to review.
      const appended = pushed.scripts.slice(1)
      expect(appended).toHaveLength(2)
      for (const entry of appended) {
        expect(entry.authoriseWith.authorisationInfo.authorised).toBe(false)
      }
      const inlineCandidate = appended.find((entry) => entry.authoriseWith.matcher.getType() === 'hash')!
      expect(inlineCandidate.authoriseWith.matcher.getPattern()).toEqual([expect.objectContaining({ hash: { value: mismatchHash } })])
    })

    it('a duplicate delivery within one run appends a single entry', async () => {
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])])
      const message = novelStagingMessage()
      const queueSource = new FakeQueueSource([[entryOf(message, 'msg-1'), entryOf(message, 'msg-2')]])
      const { deps } = makeDeps({ inventoryService: inventoryService.service, queueSource })

      const summary = await runRumCompare(deps)

      expect(summary.outcomes.candidate).toBe(1)
      expect(summary.outcomes.duplicateSuppressed).toBe(1)
      expect(summary.candidates.entriesAppended).toBe(1)
      const [pushedInventories] = inventoryService.push.mock.calls[0] as [Inventory[]]
      expect(pushedInventories[0]!.scripts).toHaveLength(1)
    })

    it('a script already covered by a pending entry is not re-appended, and nothing is pushed (idempotent across runs)', async () => {
      // The pending entry exactly as a previous run's diff wrote it: invisible
      // to identification (authorised: false), so routing still emits a
      // candidate — the diff's covered-entry check is what deduplicates.
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [pendingEntry(NOVEL_PATTERN)])])
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage())]])
      const { deps, ensurePullRequest } = makeDeps({ inventoryService: inventoryService.service, queueSource })

      const summary = await runRumCompare(deps)

      expect(summary.outcomes.candidate).toBe(1)
      expect(summary.candidates).toEqual({ byTarget: { '1.0': 1 }, entriesAppended: 0, pushed: false, prUrl: null })
      // No material change → no commit, no push, no PR.
      expect(inventoryService.push).not.toHaveBeenCalled()
      expect(ensurePullRequest).not.toHaveBeenCalled()
      expect(queueSource.deleted).toEqual(['msg-1'])
    })

    it('records an inventory-pass script an authorised entry identifies, without touching the inventory', async () => {
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [inventoryEntry(NOVEL_PATTERN)])])
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage())]])
      const { deps, alertMock, ensurePullRequest } = makeDeps({ inventoryService: inventoryService.service, queueSource })

      const summary = await runRumCompare(deps)

      expect(alertMock).not.toHaveBeenCalled()
      expect(summary.outcomes.recorded).toBe(1)
      expect(summary.outcomes.candidate).toBe(0)
      expect(summary.candidates).toEqual({ byTarget: {}, entriesAppended: 0, pushed: false, prUrl: null })
      expect(inventoryService.push).not.toHaveBeenCalled()
      expect(ensurePullRequest).not.toHaveBeenCalled()
    })

    it('surfaces the PR URL in the summary when the coordinator opens one', async () => {
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])])
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage())]])
      const { deps, ensurePullRequest } = makeDeps({ inventoryService: inventoryService.service, queueSource })
      ensurePullRequest.mockResolvedValueOnce('https://github.com/org/inventory/pull/7')

      const summary = await runRumCompare(deps)

      expect(summary.candidates.prUrl).toBe('https://github.com/org/inventory/pull/7')
    })

    it('fails the run when PR creation fails, after the summary is preserved', async () => {
      const inventoryService = makeInventoryService([makeInventory('1.0.json', [])], [makeInventory('1.0.json', [])])
      const queueSource = new FakeQueueSource([[entryOf(novelStagingMessage())]])
      const reportDir = await mkdtemp(join(tmpdir(), 'rum-pr-failure-'))
      try {
        const { deps, ensurePullRequest } = makeDeps({ inventoryService: inventoryService.service, queueSource, reportDir })
        ensurePullRequest.mockRejectedValueOnce(new Error('PR creation failed'))

        await expect(runRumCompare(deps)).rejects.toThrow('PR creation failed')

        // The drained messages are already deleted from the queue, so the
        // summary artefact must survive the failure as routing evidence.
        const written = JSON.parse(await readFile(join(reportDir, 'rum-compare', 'rum-summary.json'), 'utf8'))
        expect(written.candidates).toEqual({ byTarget: { '1.0': 1 }, entriesAppended: 1, pushed: true, prUrl: null })
      } finally {
        await rm(reportDir, { recursive: true, force: true })
      }
    })
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
