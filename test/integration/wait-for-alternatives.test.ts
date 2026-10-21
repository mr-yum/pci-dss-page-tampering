/**
 * A workflow step with `waitForAlternatives`, end to end in real Chrome.
 *
 * Apps sometimes serve one of several link shapes for the same step — a route
 * behind a feature flag or experiment — and a workflow written for one shape
 * times out on the other. Here three checkout variations run the SAME
 * workflow: one page serves `/shop/catalogue`, one `/shop/v2/catalogue`, and
 * one serves both, with the first shape hidden in a collapsed menu ahead of
 * the visible second one. That last page is the case a single selector list
 * gets wrong (a list resolves to its first match in document order and waits
 * for that hidden element alone), so each chain is waited for on its own. The
 * next step's alternatives are text selectors (`::-p-text`), which take
 * Puppeteer's own selector engine rather than the browser's.
 *
 * Drives `main.ts` as a subprocess through a `--mode detection` run against a
 * file:// inventory, the way the scheduled run executes. Needs the Chrome that
 * Puppeteer installs; CI's `npm ci` provides it.
 */

import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'

import { ExitCode } from '../../src/types/cli.js'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const TSX_BIN = path.join(__dirname, '../../node_modules/.bin/tsx')
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' }

const alerts = {
  inventory: { newScriptIdentified: { destination: '#pci-inventory' }, newHeaderIdentified: { destination: '#pci-inventory' } },
  detection: { newScriptDetected: { destination: '#pci-alerts' }, scriptMismatchDetected: { destination: '#pci-alerts' }, newHeaderDetected: { destination: '#pci-alerts' } },
  successNotification: { destination: '#pci-success' },
}

const page = (body: string): string => `<!doctype html><html><head><title>Shop</title></head><body>${body}</body></html>`

// Every path the browser asked for, so a test can show a page was never visited.
const requested: string[] = []

const startPageServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      requested.push(url)
      response.writeHead(url in pages ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pages[url] ?? '')
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const catalogue = (button: string) => page(`<div class="catalogue">Catalogue</div>${button}`)
const pages: Record<string, string> = {
  '/current/shop': page('<a href="/current/shop/catalogue">Catalogue</a>'),
  '/current/shop/catalogue': catalogue('<button>Continue</button>'),
  '/flagged/shop': page('<a href="/flagged/shop/v2/catalogue">Catalogue</a>'),
  '/flagged/shop/v2/catalogue': catalogue('<span>Next</span>'),
  // Both shapes, the first one hidden ahead of the visible second one.
  '/mixed/shop': page('<nav style="display:none"><a href="/mixed/shop/catalogue">Catalogue</a></nav><a href="/mixed/shop/v2/catalogue">Catalogue</a>'),
  '/mixed/shop/catalogue': page('<div class="wrong-page">Reached through the hidden link</div>'),
  // The waitFor chain's button exists but is hidden, ahead of the visible alternative.
  '/mixed/shop/v2/catalogue': catalogue('<button style="visibility:hidden">Continue</button><span>Next</span>'),
}

const workflow = {
  steps: [
    {
      description: 'Open the catalogue, whichever route shape the page serves',
      waitFor: [{ type: 'href', identifier: '/shop/catalogue' }],
      waitForAlternatives: [[{ type: 'href', identifier: '/shop/v2/catalogue' }]],
      action: { type: 'navigate', waitForNavigation: true },
    },
    { description: 'The catalogue loaded', waitFor: [{ type: 'div', identifier: 'catalogue' }], action: { type: 'escape' } },
    {
      // Marked as the payment page: the document is read through whichever
      // chain matched, so a page serving only the alternative still resolves.
      description: 'Move on, whichever label the button carries',
      paymentPage: true,
      waitFor: [{ type: 'button', identifier: 'Continue' }],
      waitForAlternatives: [[{ type: 'span', identifier: 'Next' }]],
      action: { type: 'click' },
    },
  ],
}

const createFixtureRepo = (origin: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-wait-for-alternatives-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  const variation = (id: string, route: string) => ({
    id,
    inventory: { type: 'inventory', name: `${id} staging`, url: `${origin}/${route}/shop`, workflow: 'shop.json' },
    detection: { type: 'detection', name: `${id} production`, url: `${origin}/${route}/shop`, workflow: 'shop.json' },
  })
  const inventory = { target: { workflows: [variation('current', 'current'), variation('flagged', 'flagged'), variation('mixed', 'mixed')] }, alerts, scripts: [], headers: [] }
  fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), JSON.stringify(inventory, null, 2))
  fs.writeFileSync(path.join(repoPath, 'workflows/shop.json'), JSON.stringify(workflow, null, 2))
  const run = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  run(['init', '--initial-branch=main'])
  run(['add', '.'])
  run(['commit', '-m', 'fixture'])
  return repoPath
}

describe('waitForAlternatives: one workflow, several link shapes', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let result: { status: number | null; output: string }

  beforeAll(async () => {
    server = await startPageServer()
    const { port } = server.address() as AddressInfo
    repoPath = createFixtureRepo(`http://127.0.0.1:${port}`)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-wait-for-alternatives-cwd-'))

    // Asynchronous on purpose: the page server lives in this process.
    result = await new Promise((resolve, reject) => {
      const args = [MAIN_PATH, '--mode', 'detection', '--repo', `file://${repoPath}`, '--git-token', 'dummy', '--detection-branch', 'main', '--report-dir', path.join(workDir, 'reports')]
      const child = spawn(TSX_BIN, args, { env: { ...process.env, NODE_ENV: 'test' }, cwd: workDir })
      let output = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      const timer = setTimeout(() => child.kill('SIGKILL'), 200_000)
      child.on('error', reject)
      child.on('close', (status) => {
        clearTimeout(timer)
        resolve({ status, output })
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('walks all three pages with the same workflow and exits 0', () => {
    expect(result.output).not.toContain('TIMEOUT ERROR')
    expect(result.output).toContain('Detection workflow completed successfully')
    expect(result.status).toBe(ExitCode.Success)
  })

  it('completes every variation, the one with a hidden first shape included', () => {
    const report = JSON.parse(fs.readFileSync(path.join(workDir, 'reports/detection/report.json'), 'utf8')) as { targets: { targetName: string; status: string }[] }
    expect(report.targets.map(({ targetName, status }) => [targetName, status]).sort()).toEqual([
      ['current production', 'completed'],
      ['flagged production', 'completed'],
      ['mixed production', 'completed'],
    ])
  })

  it('follows the visible link, never the hidden one ahead of it', () => {
    expect(requested).toContain('/mixed/shop/v2/catalogue')
    expect(requested).not.toContain('/mixed/shop/catalogue')
  })

  it('identifies the payment page through whichever chain matched', () => {
    const report = JSON.parse(fs.readFileSync(path.join(workDir, 'reports/detection/report.json'), 'utf8')) as { targets: { targetName: string; paymentScope?: { resolved: boolean } }[] }
    expect(report.targets.map(({ targetName, paymentScope }) => [targetName, paymentScope?.resolved]).sort()).toEqual([
      ['current production', true],
      ['flagged production', true],
      ['mixed production', true],
    ])
  })
})
