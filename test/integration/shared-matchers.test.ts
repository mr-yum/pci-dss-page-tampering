/**
 * Shared matcher refs, end to end in real Chrome.
 *
 * Drives `main.ts` as a subprocess through `--mode inventory` against a
 * file:// inventory repository whose target identifies and authorises a
 * page's inline bootstrap snippet through `{ "matcherRef" }` entries resolved
 * from `shared/matchers.json`. The page also serves one inline script nothing
 * identifies, so the pass has something to add and pushes.
 *
 * Asserts what only a whole run can show: the snippet is authorised through
 * the refs, the pushed target file still says `matcherRef` (the definitions
 * were not inlined by the write-back) next to the new pending entry, the
 * auditor report cites the definition's line in the shared file and the ref
 * site in the target, the shared file is copied and digested with the report,
 * and the pushed branch still validates.
 *
 * Needs the Chrome that Puppeteer installs; CI's `npm ci` provides it.
 */

import { execFileSync, spawn, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'

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

const BOOTSTRAP = '(function(){window.__edgeBootstrap=1})();'
const UNKNOWN = 'window.__somethingNew=1'

const alerts = {
  inventory: { newScriptIdentified: { destination: '#pci-inventory' }, newHeaderIdentified: { destination: '#pci-inventory' } },
  detection: { newScriptDetected: { destination: '#pci-alerts' }, scriptMismatchDetected: { destination: '#pci-alerts' }, newHeaderDetected: { destination: '#pci-alerts' } },
  successNotification: { destination: '#pci-success' },
}

const SHARED_TEXT = `${JSON.stringify(
  {
    matchers: {
      'edge-bootstrap-shape': {
        description: 'The edge bootstrap snippet, loosely, so a changed snippet reads as known-but-changed',
        matcher: { contentMatcher: '^\\(function\\(\\)\\{window\\.__edgeBootstrap' },
      },
      'edge-bootstrap': {
        description: 'The edge bootstrap snippet, exactly',
        matcher: { contentMatcher: '^\\(function\\(\\)\\{window\\.__edgeBootstrap=1\\}\\)\\(\\);$' },
      },
    },
  },
  null,
  2,
)}\n`

const AUTHORISATION = { description: 'Edge bootstrap, approved', authorised: true, date: '2026-11-01T00:00:00.000Z' }

const BOOTSTRAP_ENTRY = {
  identifyWith: { matcherRef: 'edge-bootstrap-shape' },
  authoriseWith: { matcherRef: 'edge-bootstrap', authorisationInfo: AUTHORISATION },
}

const startPageServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>Checkout</title><script>${BOOTSTRAP}</script></head><body><span>Pay</span><script>${UNKNOWN}</script></body></html>`)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const createFixtureRepo = (pageUrl: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-shared-matchers-repo-'))
  for (const dir of ['targets', 'workflows', 'shared']) fs.mkdirSync(path.join(repoPath, dir))

  const inventory = {
    target: {
      inventory: { type: 'inventory', name: 'Shop staging', url: pageUrl, workflow: 'checkout.json' },
      detection: { type: 'detection', name: 'Shop production', url: pageUrl, workflow: 'checkout.json' },
    },
    alerts,
    scripts: [BOOTSTRAP_ENTRY],
    headers: [],
  }
  fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), `${JSON.stringify(inventory, null, 2)}\n`)
  // One step: inline scripts are read as each step runs, so an empty workflow would read none.
  fs.writeFileSync(path.join(repoPath, 'workflows/checkout.json'), JSON.stringify({ steps: [{ description: 'Page ready', waitFor: [{ type: 'span', identifier: 'Pay' }], action: { type: 'escape', delay: 500 } }] }))
  fs.writeFileSync(path.join(repoPath, 'shared/matchers.json'), SHARED_TEXT)

  const run = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  run(['init', '--initial-branch=main'])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  return repoPath
}

type ReportRow = {
  kind: string
  status: string
  observed: { contentExcerpt?: string }
  inventoryEntry: { provenance: { authorisedBy: { file: string; pointer: string; line: number; ref?: { name: string; site: { file: string; pointer: string } } } | null } | null } | null
}

describe('shared matcher refs: a whole inventory pass', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let reportDir: string

  beforeAll(async () => {
    server = await startPageServer()
    const { port } = server.address() as AddressInfo
    repoPath = createFixtureRepo(`http://127.0.0.1:${port}/pay`)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-shared-matchers-cwd-'))
    reportDir = path.join(workDir, 'reports')
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Asynchronous: the page server lives in this process and must keep serving. */
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

  it('authorises through the refs, pushes the refs back unexpanded, and cites the shared file', async () => {
    const result = await executeCli(['--mode', 'inventory', '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir])

    expect(result.output).not.toContain('no longer equals its definition')
    expect(result.status).toBe(0)

    // The pushed target keeps the refs exactly as written, beside the new pending entry.
    const pushed = JSON.parse(execFileSync('git', ['show', 'inventory-updates:targets/shop.json'], { cwd: repoPath, env: gitEnv, encoding: 'utf8' })) as { scripts: object[] }
    expect(pushed.scripts).toHaveLength(2)
    expect(pushed.scripts[0]).toEqual(BOOTSTRAP_ENTRY)
    expect(JSON.stringify(pushed.scripts[1])).not.toContain('matcherRef')
    // The shared file is the maintainers' to edit; the run never rewrites it.
    expect(execFileSync('git', ['show', 'inventory-updates:shared/matchers.json'], { cwd: repoPath, env: gitEnv, encoding: 'utf8' })).toBe(SHARED_TEXT)

    // The report: the snippet is authorised, and its provenance crosses into the shared file.
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'inventory', 'report.json'), 'utf8')) as {
      run: { inventorySources: { file: string; copiedTo: string }[] }
      targets: { scripts: ReportRow[] }[]
    }
    const bootstrap = report.targets[0]!.scripts.find((row) => row.kind === 'inline_script' && row.observed.contentExcerpt?.startsWith('(function(){window.__edgeBootstrap'))!
    expect(bootstrap.status).toBe('authorised')

    const authorisedBy = bootstrap.inventoryEntry!.provenance!.authorisedBy!
    expect(authorisedBy.file).toBe('shared/matchers.json')
    expect(authorisedBy.pointer).toBe('/matchers/edge-bootstrap/matcher')
    expect(SHARED_TEXT.split('\n')[authorisedBy.line - 1]).toContain('"matcher"')
    expect(authorisedBy.ref).toEqual({ name: 'edge-bootstrap', site: expect.objectContaining({ file: 'targets/shop.json', pointer: '/scripts/0/authoriseWith' }) })

    const sharedSource = report.run.inventorySources.find((source) => source.file === 'shared/matchers.json')!
    expect(fs.readFileSync(path.join(reportDir, 'inventory', sharedSource.copiedTo), 'utf8')).toBe(SHARED_TEXT)

    // And the branch the run pushed still validates.
    const validate = spawnSync(TSX_BIN, [MAIN_PATH, '--mode', 'validate', '--repo', `file://${repoPath}`, '--inventory-branch', 'inventory-updates'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pci-shared-matchers-validate-')),
    })
    expect(validate.status).toBe(0)
  })
})
