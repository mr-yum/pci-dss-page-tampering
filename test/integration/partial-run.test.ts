/**
 * Partial-run end-to-end test.
 *
 * Drives `main.ts` as a subprocess through a `--mode all` run against a real
 * file:// inventory repository with two checkout variations: one whose
 * workflow cannot even start (a `totp` step whose seed was never supplied, so
 * it fails before navigation) and one that walks a locally served page.
 *
 * The broken variation is listed FIRST, so the run has to continue past a
 * failure to reach the healthy one. Asserts the properties the resilience
 * change exists for: both passes complete, the healthy target is processed in
 * both, the run summary names the failed target with its pass and reason, the
 * auditor report marks the run partial, and the process still exits 2.
 *
 * Needs the Chrome that Puppeteer installs; CI's `npm ci` provides it.
 */

import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'

import { ExitCode } from '../../src/types/cli.js'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const PROJECT_ROOT = path.join(__dirname, '../..')
const TSX_BIN = path.join(PROJECT_ROOT, 'node_modules/.bin/tsx')

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

const alerts = {
  inventory: { newScriptIdentified: { destination: '#pci-inventory' }, newHeaderIdentified: { destination: '#pci-inventory' } },
  detection: { newScriptDetected: { destination: '#pci-alerts' }, scriptMismatchDetected: { destination: '#pci-alerts' }, newHeaderDetected: { destination: '#pci-alerts' } },
  successNotification: { destination: '#pci-success' },
}

/** A payment page with nothing on it: the healthy variation only has to load it. */
const startPageServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><head><title>Checkout</title></head><body><div class="checkout">Pay</div></body></html>')
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const createFixtureRepo = (pageUrl: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-partial-run-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))

  const inventory = {
    target: {
      workflows: [
        {
          // First on purpose: the run must get past this one.
          id: 'broken',
          inventory: { type: 'inventory', name: 'Broken staging', url: pageUrl, workflow: 'broken.json' },
          detection: { type: 'detection', name: 'Broken production', url: pageUrl, workflow: 'broken.json' },
        },
        {
          id: 'healthy',
          inventory: { type: 'inventory', name: 'Healthy staging', url: pageUrl, workflow: 'healthy.json' },
          detection: { type: 'detection', name: 'Healthy production', url: pageUrl, workflow: 'healthy.json' },
        },
      ],
    },
    alerts,
    scripts: [],
    headers: [],
  }
  fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), JSON.stringify(inventory, null, 2))
  fs.writeFileSync(path.join(repoPath, 'workflows/healthy.json'), JSON.stringify({ steps: [] }))
  // A totp step whose seed is never passed via --totp-seed fails before any
  // navigation — the cheapest deterministic target-level failure there is.
  fs.writeFileSync(
    path.join(repoPath, 'workflows/broken.json'),
    JSON.stringify({ steps: [{ description: 'Enter the one-time code', waitFor: [{ type: 'div', identifier: 'checkout' }], action: { type: 'totp', seedRef: 'never-supplied' } }] }),
  )

  const run = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  run(['init', '--initial-branch=main'])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  return repoPath
}

describe('partial run: one failed variation does not cost the run its other targets', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let reportDir: string

  beforeAll(async () => {
    server = await startPageServer()
    const { port } = server.address() as AddressInfo
    repoPath = createFixtureRepo(`http://127.0.0.1:${port}/pay`)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-partial-run-cwd-'))
    reportDir = path.join(workDir, 'reports')
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Asynchronous on purpose: the page server lives in this process, and a
   * blocking spawnSync would freeze the event loop so the child's navigation
   * could never be served.
   *
   * stdout and stderr are merged by the shell (`2>&1`) into one pipe, so the
   * combined output preserves the order the process wrote in — which is what
   * lets the test assert that the run summary went out before the failure.
   */
  const executeCli = (args: string[]): Promise<{ status: number | null; output: string }> =>
    new Promise((resolve, reject) => {
      const command = [TSX_BIN, MAIN_PATH, ...args].map((part) => `'${part.replaceAll("'", String.raw`'\''`)}'`).join(' ')
      const child = spawn('sh', ['-c', `${command} 2>&1`], { env: { ...process.env, NODE_ENV: 'test' }, cwd: workDir })
      let output = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      const timer = setTimeout(() => child.kill('SIGKILL'), 200_000)
      child.on('error', reject)
      child.on('close', (status) => {
        clearTimeout(timer)
        resolve({ status, output })
      })
    })

  it('finishes both passes, summarises what failed, marks the report partial, and exits 2', async () => {
    const result = await executeCli(['--mode', 'all', '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir])

    const { output } = result

    // The exit code is still the failure signal.
    expect(result.status).toBe(ExitCode.ExecutionError)

    // The broken target failed in each pass, and the run kept going.
    expect(output).toContain("Target 'Broken staging' failed during the inventory pass; continuing with the remaining targets.")
    expect(output).toContain("Target 'Broken production' failed during the detection pass; continuing with the remaining targets.")
    expect(output).toContain('Inventory workflow completed with 1 failed target(s)')
    expect(output).toContain('Preparing to run detection workflow.')
    expect(output).toContain('Detection workflow completed with 1 failed target(s).')

    // The run summary went out (console alerter, no --slack-token) and names both sides.
    expect(output).toContain('[Console Alert -> Partial Failure]: Workflow execution completed, but 2 target(s) failed and were not monitored')
    expect(output).toContain('  Targets Processed: Healthy staging, Healthy production')
    expect(output).toContain('  Targets Failed: 2')
    expect(output).toMatch(/ {4}- Broken staging \(inventory\): .*TOTP seed\(s\) that were not provided: never-supplied/)
    expect(output).toMatch(/ {4}- Broken production \(detection\): .*TOTP seed\(s\) that were not provided: never-supplied/)

    // Ordering: the summary goes out after the last pass and before the process fails, and the failure names the targets.
    const summaryAt = output.lastIndexOf('[Console Alert -> Partial Failure]')
    expect(summaryAt).toBeGreaterThan(output.lastIndexOf('Detection workflow completed'))
    expect(summaryAt).toBeLessThan(output.lastIndexOf('[Main]: Application execution failed'))
    expect(output).toContain('2 target run(s) failed: Broken staging (inventory), Broken production (detection)')

    // The auditor report records the gap for each pass.
    for (const pass of ['inventory', 'detection'] as const) {
      const report = JSON.parse(fs.readFileSync(path.join(reportDir, pass, 'report.json'), 'utf8'))
      expect(report.run.status).toBe('partial')
      const statuses = Object.fromEntries(report.targets.map((target: { workflowId: string; status: string }) => [target.workflowId, target.status]))
      expect(statuses).toEqual({ broken: 'failed', healthy: 'completed' })
    }
  })
})
