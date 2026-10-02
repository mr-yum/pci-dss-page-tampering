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
// Two scripts the run can never read, loaded by the final step so the workflow
// ends with them outstanding: one whose body never finishes arriving, one whose
// response never arrives at all. Chrome surfaces no response for a script until
// its body is complete, so the monitor sees both as requests still unanswered.
const HUNG_BODY = '/hung-body.js'
const HUNG_HEADERS = '/hung-headers.js'

const checkoutPage = `<!doctype html><html><body><script src="/sdk.js"></script><span>Pay now</span>
<button onclick="for (const src of ${JSON.stringify(LATE_SCRIPTS).replaceAll('"', "'")}) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) } location.href = '/shop/confirm'">Pay</button>
</body></html>`
const confirmationPage = `<!doctype html><html><body><span>Confirmed</span>
<button onclick="for (const src of ['${HUNG_BODY}', '${HUNG_HEADERS}']) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) }">Load more</button>
</body></html>`

const startServer = (): Promise<http.Server & { release: () => void }> =>
  new Promise((resolve) => {
    const held: http.ServerResponse[] = []
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
      // Headers now, body never: the read starts and never completes.
      if (url === HUNG_BODY) {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
        response.write('window.__hung = 1;')
        held.push(response)
        return
      }
      // Nothing at all: the request stays unanswered.
      if (url === HUNG_HEADERS) {
        held.push(response)
        return
      }
      return response.writeHead(404).end()
    })
    const release = (): void => {
      for (const response of held) response.destroy()
    }
    server.listen(0, '127.0.0.1', () => resolve(Object.assign(server, { release })))
  })

const createFixtureRepo = (base: string, loadHungScripts: boolean): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-unread-scripts-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  const steps = [
    { description: 'Card entry ready', paymentPage: true, waitFor: [{ type: 'span', identifier: 'Pay now' }], action: { type: 'escape', delay: 300 } },
    { description: 'Pay', waitFor: [{ type: 'button', identifier: 'Pay' }], action: { type: 'click', delay: 100 } },
    { description: 'Confirmation', waitFor: [{ type: 'span', identifier: 'Confirmed' }], action: { type: 'escape', delay: 300 } },
    // The last step issues the two requests the run can never finish, and
    // the workflow ends with them outstanding.
    ...(loadHungScripts ? [{ description: 'Load more', waitFor: [{ type: 'button', identifier: 'Load more' }], action: { type: 'click', delay: 100, postActionDelay: 300 } }] : []),
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
type Unread = { url: string; scope?: string; status: number; reason: string }
type ReportTarget = { workflowId: string; scripts: Row[]; unreadScripts: Unread[] }
type Report = { run: { status: string }; summary: { scriptsUnread: number }; targets: ReportTarget[] }
type Run = { server: http.Server & { release: () => void }; repoPath: string; workDir: string; output: string; status: number | null; report: Report }

const runDetection = async (loadHungScripts: boolean): Promise<Run> => {
  const server = await startServer()
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const repoPath = createFixtureRepo(base, loadHungScripts)
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-unread-scripts-cwd-'))
  const reportDir = path.join(workDir, 'reports')
  let output = ''

  // Asynchronous: the page server lives in this process and must keep serving.
  const status = await new Promise<number | null>((resolve, reject) => {
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

  const report: Report = JSON.parse(fs.readFileSync(path.join(reportDir, 'detection', 'report.json'), 'utf8'))
  return { server, repoPath, workDir, output, status, report }
}

const stop = async (run: Run): Promise<void> => {
  run.server.release()
  await new Promise<void>((resolve) => run.server.close(() => resolve()))
  for (const dir of [run.repoPath, run.workDir]) fs.rmSync(dir, { recursive: true, force: true })
}

const comparedPaths = (target: ReportTarget): string[] => target.scripts.map((row) => `${new URL(row.name).pathname}:${row.scope ?? 'unscoped'}:${row.status}`).sort()

describe('scripts that finish loading as the payment page navigates away', () => {
  jest.setTimeout(240_000)
  let run: Run

  beforeAll(async () => {
    run = await runDetection(false)
  })
  afterAll(() => stop(run))

  it('reads, hashes and compares every script, on the payment page, instead of losing their bodies', () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    expect(comparedPaths(target)).toEqual([...LATE_SCRIPTS, '/sdk.js'].map((script) => `${script}:payment:unknown`).sort())
    expect(target.unreadScripts).toEqual([])
    expect(run.output).not.toContain('Could not read the body of script')
  })

  it('finishes as a complete run that exits 0', () => {
    expect(run.report.run.status).toBe('complete')
    expect(run.report.summary.scriptsUnread).toBe(0)
    expect(run.output).toContain('[Console Alert -> Success]: Workflow execution completed successfully')
    expect(run.status).toBe(ExitCode.Success)
  })
})

// The accounting path, end to end: the workflow ends with one script still
// streaming its body and one whose response never comes. The run waits its
// deadline for both, records each exactly once as an unanswered request, and
// exits 2 naming them, while the scripts it did read are compared as usual.
describe('scripts the run can never read', () => {
  jest.setTimeout(240_000)
  let run: Run

  beforeAll(async () => {
    run = await runDetection(true)
  })
  afterAll(() => stop(run))

  it('records each unread script once, on the payment page, with why it could not be read', () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    const unread = [...target.unreadScripts].sort((a, b) => a.url.localeCompare(b.url))
    expect(unread.map((script) => `${new URL(script.url).pathname}:${script.scope ?? 'unscoped'}`)).toEqual([`${HUNG_BODY}:payment`, `${HUNG_HEADERS}:payment`])
    for (const script of unread) expect(script).toMatchObject({ status: 0, reason: expect.stringContaining('no response had arrived') })
  })

  it('still compares every script it did read', () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    expect(comparedPaths(target)).toEqual([...LATE_SCRIPTS, '/sdk.js'].map((script) => `${script}:payment:unknown`).sort())
  })

  it('names them in the run summary, marks the run partial and exits 2', () => {
    expect(run.report.run.status).toBe('partial')
    expect(run.report.summary.scriptsUnread).toBe(2)
    expect(run.output).toContain('Scripts Not Read')
    expect(run.output).toContain(HUNG_BODY)
    expect(run.output).toContain(HUNG_HEADERS)
    expect(run.status).toBe(ExitCode.ExecutionError)
  })
})
