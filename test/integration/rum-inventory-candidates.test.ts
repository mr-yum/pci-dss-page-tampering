/**
 * Integration tests for the RUM inventory-candidate flow (feature 011, US3 —
 * T032): staging observations feed the EXISTING InventoryService candidate
 * flow end-to-end through the real CLI.
 *
 * Drives `--mode rum-compare` as a subprocess against a real file:// inventory
 * repository (built in a temp dir the way the other CLI integration tests do)
 * and a file:// queue directory, then inspects the inventory branch of the
 * fixture repository itself — the actual Git evidence a reviewer would see.
 *
 * Covered:
 * - a novel staging external script becomes a pending (`authorised: false`)
 *   entry committed to the inventory branch; `main` is untouched;
 * - re-delivering the same observation in a later run appends nothing and
 *   produces no new commit (idempotency across runs);
 * - a targetTypeMatcher-scoped entry authorises the script for the inventory
 *   pass only: the same URL arriving with `target_type: detection` still
 *   alerts `rum_uninventoried_script_detected` (staging-only trust never
 *   leaks to production);
 * - the automated system never sets `authorised: true` anywhere;
 * - the pushed inventory still passes `--mode validate` (the generated entry
 *   deserialises through the full Zod + createMatcher pipeline).
 */

import { execFileSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const PROJECT_ROOT = path.join(__dirname, '../..')
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules/.bin/tsx')

const NOVEL_URL = 'https://sandbox.newpay.example/pay-sdk.js'
const SCOPED_URL = 'https://sandbox.provider.example/sdk.js'

/**
 * Runs the CLI in its own working directory: the tool hard-codes its clone
 * target to `./pulled_repo`, so a per-run cwd keeps runs from stomping on each
 * other's clone state.
 */
const executeCli = (args: string[], cwd: string) =>
  spawnSync(TSX_BIN, [MAIN_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    cwd,
    // Bound a stalled CLI so a hang surfaces as a failed run, not a suite timeout.
    timeout: 180_000,
  })

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

const git = (repoPath: string, args: string[]): string => execFileSync('git', args, { cwd: repoPath, env: gitEnv, encoding: 'utf8' }).trim()

const authorisationInfo = (authorised: boolean) => ({
  description: authorised ? 'Fixture entry' : 'NO_DESCRIPTION',
  authorised,
  date: '2026-08-01T00:00:00.000Z',
})

/**
 * Fixture inventory for target 1.0. Contains one hash-pinned CDN entry and one
 * staging-only entry: the scoped entry identifies (and authorises) SCOPED_URL
 * for the inventory pass only, via targetTypeMatcher — the exact pattern
 * AGENTS.md documents for trusting a sandbox origin without trusting it on
 * the production payment page.
 */
const inventoryPayload = {
  target: {
    inventory: { type: 'inventory', url: 'https://staging.example.com/checkout', workflow: 'checkout.json' },
    detection: { type: 'detection', url: 'https://pay.example.com/checkout', workflow: 'checkout.json' },
  },
  alerts: {
    inventory: {
      newScriptIdentified: { destination: '#pci-inventory' },
      newHeaderIdentified: { destination: '#pci-inventory' },
    },
    detection: {
      newScriptDetected: { destination: '#pci-alerts' },
      scriptMismatchDetected: { destination: '#pci-alerts' },
      newHeaderDetected: { destination: '#pci-alerts' },
    },
    successNotification: { destination: '#pci-success' },
  },
  scripts: [
    {
      identifyWith: { nameMatcher: '^https://cdn\\.example\\.net/sdk\\.js$' },
      authoriseWith: {
        hashes: [{ timestamp: '2026-08-01T00:00:00.000Z', hash: { value: 'a'.repeat(64) } }],
        authorisationInfo: authorisationInfo(true),
      },
    },
    {
      identifyWith: { andMatcher: [{ targetTypeMatcher: '^inventory$' }, { nameMatcher: '^https://sandbox\\.provider\\.example/sdk\\.js$' }] },
      authoriseWith: {
        nameMatcher: '^https://sandbox\\.provider\\.example/sdk\\.js$',
        authorisationInfo: authorisationInfo(true),
      },
    },
  ],
  headers: [],
}

/** Builds the fixture inventory repository with a single commit on `main`. */
const createFixtureRepo = (): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-rum-candidates-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  fs.writeFileSync(path.join(repoPath, 'targets/1.0.json'), JSON.stringify(inventoryPayload, null, 2))
  fs.writeFileSync(path.join(repoPath, 'workflows/checkout.json'), JSON.stringify({ steps: [] }))

  const run = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  run(['init', '--initial-branch=main'])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  return repoPath
}

type ObservationOverrides = { url: string; targetType: 'inventory' | 'detection' }

/** One novel-observation queue message, as the collector would enqueue it. */
const queueMessage = ({ url, targetType }: ObservationOverrides) => ({
  v: 1,
  target_id: '1.0',
  target_type: targetType,
  observation: {
    kind: 'external-script',
    ts: 1755600000000,
    route: '/checkout',
    url,
    initiator: targetType === 'inventory' ? 'https://staging.example.com/checkout' : 'https://pay.example.com/checkout',
  },
  novelty: { pk: `1.0#url:${url}#${targetType}`, first_seen: 1755600000123, first_route: '/checkout' },
  received_at: 1755600000500,
  session_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
})

describe('RUM inventory candidates end-to-end (US3): staging observations → pending entries → inventory branch', () => {
  jest.setTimeout(180_000)

  let repoPath: string
  const cleanups: string[] = []

  const tempDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    cleanups.push(dir)
    return dir
  }

  const runRumCompare = (queueDir: string, reportDir: string) =>
    executeCli(['--mode', 'rum-compare', '--rum-queue-url', `file://${queueDir}`, '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir], tempDir('pci-rum-candidates-cwd-'))

  const readSummary = (reportDir: string) => JSON.parse(fs.readFileSync(path.join(reportDir, 'rum-compare', 'rum-summary.json'), 'utf8'))

  const inventoryBranchPayload = () => JSON.parse(git(repoPath, ['show', 'inventory-updates:targets/1.0.json']))

  beforeAll(() => {
    repoPath = createFixtureRepo()
    cleanups.push(repoPath)
  })

  afterAll(() => {
    for (const dir of cleanups) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  let shaAfterFirstRun: string

  it('run 1: a novel staging script lands as a pending entry on the inventory branch; staging-only trust does not leak to the detection pass', () => {
    const queueDir = tempDir('pci-rum-candidates-queue-')
    const reportDir = tempDir('pci-rum-candidates-report-')
    fs.writeFileSync(path.join(queueDir, '01-novel-staging.json'), JSON.stringify(queueMessage({ url: NOVEL_URL, targetType: 'inventory' })))
    fs.writeFileSync(path.join(queueDir, '02-scoped-staging.json'), JSON.stringify(queueMessage({ url: SCOPED_URL, targetType: 'inventory' })))
    fs.writeFileSync(path.join(queueDir, '03-scoped-production.json'), JSON.stringify(queueMessage({ url: SCOPED_URL, targetType: 'detection' })))

    const result = runRumCompare(queueDir, reportDir)

    expect(result.status).toBe(0)

    // Routing outcomes: the novel script is a candidate; the scoped script is
    // recorded on the inventory pass but ALERTS on the detection pass — the
    // targetTypeMatcher-scoped entry never identifies production traffic.
    const summary = readSummary(reportDir)
    expect(summary.processed).toBe(3)
    expect(summary.routed).toBe(3)
    expect(summary.invalid).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.outcomes).toEqual({ alerted: 1, recorded: 1, candidate: 1, duplicateSuppressed: 0 })
    expect(summary.alertedByCategory).toEqual({ rum_uninventoried_script_detected: 1 })
    expect(summary.candidates).toEqual({ byTarget: { '1.0': 1 }, entriesAppended: 1, pushed: true, prUrl: null })
    // Both passes' SHAs are recorded; on run 1 both branches point at the
    // fixture commit (the inventory branch was just created from main).
    expect(summary.inventoryRefs.detection.commitSha).toBe(git(repoPath, ['rev-parse', 'main']))
    expect(summary.inventoryRefs.inventory.commitSha).toBe(git(repoPath, ['rev-parse', 'main']))

    // The production-pass alert reached the (console) alert service.
    expect(result.stdout).toContain('rum_uninventoried_script_detected')
    expect(result.stdout).toContain(SCOPED_URL)

    // Git evidence: the pending entry is committed on the inventory branch...
    shaAfterFirstRun = git(repoPath, ['rev-parse', 'inventory-updates'])
    const pushed = inventoryBranchPayload()
    expect(pushed.scripts).toHaveLength(3)

    const appended = pushed.scripts[2]
    expect(appended.identifyWith).toEqual({ nameMatcher: '^https:\\/\\/sandbox\\.newpay\\.example\\/pay-sdk\\.js$' })
    // External RUM scripts are opaque client-side, so the pending entry makes
    // no integrity claim: exact-name authorisation, for the human to replace.
    expect(appended.authoriseWith.nameMatcher).toBe('^https:\\/\\/sandbox\\.newpay\\.example\\/pay-sdk\\.js$')
    expect(appended.authoriseWith.authorisationInfo.authorised).toBe(false)
    expect(appended.authoriseWith.authorisationInfo.description).toBe('NO_DESCRIPTION')

    // ...the automated system authorised nothing (the two fixture entries are
    // still the only authorised ones)...
    const authorisedCount = (payload: { scripts: { authoriseWith: { authorisationInfo: { authorised: boolean } } }[] }) => payload.scripts.filter((script) => script.authoriseWith.authorisationInfo.authorised).length
    expect(authorisedCount(pushed)).toBe(2)

    // ...and main is untouched — the candidate is a proposal, not a baseline.
    expect(JSON.parse(git(repoPath, ['show', 'main:targets/1.0.json'])).scripts).toHaveLength(2)
    expect(git(repoPath, ['rev-parse', 'main'])).not.toBe(shaAfterFirstRun)
  })

  it('run 2: re-delivering the same observation appends no duplicate entry and produces no new commit', () => {
    const queueDir = tempDir('pci-rum-candidates-queue2-')
    const reportDir = tempDir('pci-rum-candidates-report2-')
    fs.writeFileSync(path.join(queueDir, '01-novel-staging.json'), JSON.stringify(queueMessage({ url: NOVEL_URL, targetType: 'inventory' })))

    const result = runRumCompare(queueDir, reportDir)

    expect(result.status).toBe(0)

    // Routing still classifies the observation as a candidate (pending
    // entries are invisible to identification), but the diff recognises the
    // existing pending entry as covering it — nothing appended, nothing
    // pushed, no PR.
    const summary = readSummary(reportDir)
    expect(summary.outcomes.candidate).toBe(1)
    expect(summary.candidates).toEqual({ byTarget: { '1.0': 1 }, entriesAppended: 0, pushed: false, prUrl: null })
    // This run was judged against the inventory branch commit from run 1.
    expect(summary.inventoryRefs.inventory.commitSha).toBe(shaAfterFirstRun)

    expect(git(repoPath, ['rev-parse', 'inventory-updates'])).toBe(shaAfterFirstRun)
    expect(inventoryBranchPayload().scripts).toHaveLength(3)
  })

  it('run 3: the pushed inventory branch still passes --mode validate (the generated entry deserialises)', () => {
    const result = executeCli(['--mode', 'validate', '--repo', `file://${repoPath}`, '--inventory-branch', 'inventory-updates'], tempDir('pci-rum-candidates-validate-'))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Successfully validated 1 inventory file(s)')
  })
})
