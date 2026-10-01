/**
 * Scripts that finish loading while the payment page navigates away, end to
 * end in real Chrome.
 *
 * The payment page's "Pay" click pulls in a handful of scripts and, in the
 * same handler, navigates on to a confirmation page (the shape of a click that
 * continues to 3-D Secure). The page server holds the confirmation response
 * back, so every script finishes loading while that navigation is under way.
 *
 * That is the window in which Chrome used to discard response bodies: every
 * one of these scripts failed `Network.getResponseBody` with "No resource with
 * given identifier found" (which Puppeteer reports as "Could not load response
 * body for this request. This might happen if the request is a preflight
 * request."), was dropped with a log line, and the run exited 0. With bodies
 * retained (`Network.configureDurableMessages`) every one of them is read,
 * hashed and compared like any other script on the payment page.
 *
 * Drives `main.ts` as a subprocess through a `--mode detection` run against a
 * file:// inventory with no authorised scripts. Needs the Chrome that
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

const LATE_SCRIPTS = ['/late-0.js', '/late-1.js', '/late-2.js', '/late-3.js']

const checkoutPage = `<!doctype html><html><body><script src="/sdk.js"></script><span>Pay now</span>
<button onclick="for (const src of ${JSON.stringify(LATE_SCRIPTS).replaceAll('"', "'")}) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) } location.href = '/shop/confirm'">Pay</button>
</body></html>`
const confirmationPage = '<!doctype html><html><body><span>Confirmed</span></body></html>'

const startServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      if (url === '/sdk.js' || LATE_SCRIPTS.includes(url)) {
        return response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(`window.__loaded=(window.__loaded||[]).concat(${JSON.stringify(url)});`)
      }
      if (url === '/shop/checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(checkoutPage)
      // Held back so the late scripts all finish while the navigation to this
      // page is in flight.
      if (url === '/shop/confirm') {
        setTimeout(() => response.writeHead(200, { 'content-type': 'text/html' }).end(confirmationPage), 500)
        return
      }
      return response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const createFixtureRepo = (base: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-unread-scripts-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  const steps = [
    { description: 'Card entry ready', paymentPage: true, waitFor: [{ type: 'span', identifier: 'Pay now' }], action: { type: 'escape', delay: 300 } },
    { description: 'Pay', waitFor: [{ type: 'button', identifier: 'Pay' }], action: { type: 'click', delay: 100 } },
    { description: 'Confirmation', waitFor: [{ type: 'span', identifier: 'Confirmed' }], action: { type: 'escape', delay: 300 } },
  ]
  fs.writeFileSync(path.join(repoPath, 'workflows/pay.json'), JSON.stringify({ steps }))
  const inventory = {
    target: {
      workflows: [
        {
          id: 'pay',
          inventory: { type: 'inventory', name: 'Shop staging', url: `${base}/shop/checkout`, workflow: 'pay.json' },
          detection: { type: 'detection', name: 'Shop production', url: `${base}/shop/checkout`, workflow: 'pay.json' },
        },
      ],
    },
    alerts: {
      inventory: { newScriptIdentified: { destination: '#i' }, newHeaderIdentified: { destination: '#i' } },
      detection: { newScriptDetected: { destination: '#d' }, scriptMismatchDetected: { destination: '#d' }, newHeaderDetected: { destination: '#d' } },
      successNotification: { destination: '#s' },
    },
    scripts: [],
    headers: [],
  }
  fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), JSON.stringify(inventory, null, 2))
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
  git(['init', '--initial-branch=main'])
  git(['add', '.'])
  git(['commit', '-m', 'fixture'])
  return repoPath
}

type Row = { name: string; scope?: string; status: string }
type Unread = { url: string; scope?: string }
type ReportTarget = { workflowId: string; scripts: Row[]; unreadScripts: Unread[] }

describe('scripts that finish loading as the payment page navigates away', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let output = ''
  let status: number | null = null
  let report: { run: { status: string }; summary: { scriptsUnread: number }; targets: ReportTarget[] }

  beforeAll(async () => {
    server = await startServer()
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    repoPath = createFixtureRepo(base)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-unread-scripts-cwd-'))
    const reportDir = path.join(workDir, 'reports')

    // Asynchronous: the page server lives in this process and must keep serving.
    status = await new Promise<number | null>((resolve, reject) => {
      const args = [TSX_BIN, MAIN_PATH, '--mode', 'detection', '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir]
      const child = spawn('sh', ['-c', `${args.map((part) => `'${part}'`).join(' ')} 2>&1`], { env: { ...process.env, NODE_ENV: 'test' }, cwd: workDir })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      const timer = setTimeout(() => child.kill('SIGKILL'), 200_000)
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    report = JSON.parse(fs.readFileSync(path.join(reportDir, 'detection', 'report.json'), 'utf8'))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads, hashes and compares every script, on the payment page, instead of losing their bodies', () => {
    const target = report.targets.find((candidate) => candidate.workflowId === 'pay')!
    const scripts = target.scripts.map((row) => `${new URL(row.name).pathname}:${row.scope ?? 'unscoped'}:${row.status}`).sort()
    expect(scripts).toEqual([...LATE_SCRIPTS, '/sdk.js'].map((script) => `${script}:payment:unknown`).sort())
    expect(target.unreadScripts).toEqual([])
    expect(output).not.toContain('Could not read the body of script')
  })

  it('finishes as a complete run that exits 0', () => {
    expect(report.run.status).toBe('complete')
    expect(report.summary.scriptsUnread).toBe(0)
    expect(output).toContain('[Console Alert -> Success]: Workflow execution completed successfully')
    expect(status).toBe(ExitCode.Success)
  })
})
