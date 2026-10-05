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
 * The same holds inside a cross-site iframe — a card provider's hosted
 * fields navigating themselves on to a 3-D Secure challenge — which runs in
 * its own renderer behind its own DevTools session, so it needs the setting
 * on that session too (`frameBodyRetention`).
 *
 * A script request that never gets a response is a different matter: the
 * script never ran, so it is recorded as evidence and the run stays green.
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
// Two scripts that never arrive, requested by the final step so the workflow
// ends with them outstanding: one whose body never finishes arriving, one whose
// response never arrives at all. Chrome surfaces no response for a script until
// its body is complete, so the monitor sees both as requests still unanswered —
// and neither ever ran on the page.
const HUNG_BODY = '/hung-body.js'
const HUNG_HEADERS = '/hung-headers.js'

// Scripts a cross-site card frame pulls in as its own "Pay" handler navigates
// the frame on to its challenge page, which the server holds back so they all
// finish loading while that navigation is under way.
const FRAME_SDK = '/frame/sdk.js'
const FRAME_LATE_SCRIPTS = ['/frame/late-0.js', '/frame/late-1.js', '/frame/late-2.js']

const checkoutPage = `<!doctype html><html><body><script src="/sdk.js"></script><span>Pay now</span>
<button onclick="for (const src of ${JSON.stringify(LATE_SCRIPTS).replaceAll('"', "'")}) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) } location.href = '/shop/confirm'">Pay</button>
</body></html>`
const confirmationPage = `<!doctype html><html><body><span>Confirmed</span>
<button onclick="for (const src of ['${HUNG_BODY}', '${HUNG_HEADERS}']) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) }">Load more</button>
</body></html>`

// The card frame is served by the same server under another host name:
// 127.0.0.1 and localhost are different sites, so under site isolation Chrome
// gives the frame a renderer — and a DevTools session — of its own. (Different
// ports alone are the same site, and the frame would stay in process.)
const cardFrame = `<!doctype html><html><body><span>Card</span><script src="${FRAME_SDK}"></script>
<script>addEventListener('message', () => { for (const src of ${JSON.stringify(FRAME_LATE_SCRIPTS).replaceAll('"', "'")}) { const s = document.createElement('script'); s.src = src; document.body.appendChild(s) } location.href = '/frame/challenge' })</script>
</body></html>`
const framedCheckoutPage = (frameOrigin: string): string => `<!doctype html><html><body>
<iframe id="card" src="${frameOrigin}/frame/card" onload="document.getElementById('ready').textContent = 'Card ready'"></iframe><span id="ready"></span>
<button onclick="document.getElementById('card').contentWindow.postMessage('pay', '*')">Pay</button>
</body></html>`

const script = (response: http.ServerResponse, url: string): void => {
  response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(`window.__loaded=(window.__loaded||[]).concat(${JSON.stringify(url)});`)
}

const startServer = (): Promise<http.Server & { release: () => void }> =>
  new Promise((resolve) => {
    const held: http.ServerResponse[] = []
    const server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      if (url === '/sdk.js' || LATE_SCRIPTS.includes(url) || url === FRAME_SDK || FRAME_LATE_SCRIPTS.includes(url)) return script(response, url)
      if (url === '/shop/checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(checkoutPage)
      if (url === '/shop/framed-checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(framedCheckoutPage(`http://localhost:${(server.address() as AddressInfo).port}`))
      if (url === '/frame/card') return response.writeHead(200, { 'content-type': 'text/html' }).end(cardFrame)
      // Held back so the late scripts all finish while the navigation to this
      // page is in flight.
      if (url === '/shop/confirm') {
        setTimeout(() => response.writeHead(200, { 'content-type': 'text/html' }).end(confirmationPage), 500)
        return
      }
      // The same, for the card frame navigating itself on.
      if (url === '/frame/challenge') {
        setTimeout(() => response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><span>Challenge</span></body></html>'), 500)
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

type Scenario = 'navigation' | 'unanswered' | 'cross-site-frame'

const stepsFor = (scenario: Scenario): object[] => {
  if (scenario === 'cross-site-frame') {
    return [
      { description: 'Card entry ready', paymentPage: true, waitFor: [{ type: 'span', identifier: 'Card ready' }], action: { type: 'escape', delay: 300 } },
      // Hands the "Pay" to the card frame, which loads its late scripts and
      // navigates itself on; the page stays where it is.
      { description: 'Pay', waitFor: [{ type: 'button', identifier: 'Pay' }], action: { type: 'click', delay: 100, postActionDelay: 1500 } },
    ]
  }
  return [
    { description: 'Card entry ready', paymentPage: true, waitFor: [{ type: 'span', identifier: 'Pay now' }], action: { type: 'escape', delay: 300 } },
    { description: 'Pay', waitFor: [{ type: 'button', identifier: 'Pay' }], action: { type: 'click', delay: 100 } },
    { description: 'Confirmation', waitFor: [{ type: 'span', identifier: 'Confirmed' }], action: { type: 'escape', delay: 300 } },
    // The last step issues the two requests that are never answered, and the
    // workflow ends with them outstanding.
    ...(scenario === 'unanswered' ? [{ description: 'Load more', waitFor: [{ type: 'button', identifier: 'Load more' }], action: { type: 'click', delay: 100, postActionDelay: 300 } }] : []),
  ]
}

const createFixtureRepo = (base: string, scenario: Scenario): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-unread-scripts-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  fs.writeFileSync(path.join(repoPath, 'workflows/pay.json'), JSON.stringify({ steps: stepsFor(scenario) }))
  const checkoutUrl = `${base}${scenario === 'cross-site-frame' ? '/shop/framed-checkout' : '/shop/checkout'}`
  const inventory = {
    target: {
      workflows: [
        {
          id: 'pay',
          inventory: { type: 'inventory', name: 'Shop staging', url: checkoutUrl, workflow: 'pay.json' },
          detection: { type: 'detection', name: 'Shop production', url: checkoutUrl, workflow: 'pay.json' },
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
type Unanswered = { url: string; scope?: string; step: number; reason: string }
type ReportTarget = { workflowId: string; scripts: Row[]; unreadScripts: Unread[]; unansweredRequests: Unanswered[] }
type Report = { run: { status: string }; summary: { scriptsUnread: number; requestsUnanswered: number }; targets: ReportTarget[] }
type Run = { server: http.Server & { release: () => void }; repoPath: string; workDir: string; output: string; status: number | null; report: Report }

const runDetection = async (scenario: Scenario): Promise<Run> => {
  const server = await startServer()
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const repoPath = createFixtureRepo(base, scenario)
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
    run = await runDetection('navigation')
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

// Inside a cross-site iframe. Removing the per-frame retention (the
// `retainFrameBodies` calls in `detectAttempt`) makes every late frame script
// fail with the production error — "Could not load response body for this
// request" — and the run exit 2 with each one named under Scripts Not Read.
describe('scripts that finish loading as a cross-site payment frame navigates itself away', () => {
  jest.setTimeout(240_000)
  let run: Run

  beforeAll(async () => {
    run = await runDetection('cross-site-frame')
  })
  afterAll(() => stop(run))

  it("reads, hashes and compares every one of the frame's scripts instead of losing their bodies", () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    expect(comparedPaths(target)).toEqual([...FRAME_LATE_SCRIPTS, FRAME_SDK].map((script) => `${script}:payment:unknown`).sort())
    for (const row of target.scripts) expect(new URL(row.name).hostname).toBe('localhost')
    expect(target.unreadScripts).toEqual([])
    expect(run.output).not.toContain('Could not read the body of script')
  })

  it('finishes as a complete run that exits 0', () => {
    expect(run.report.run.status).toBe('complete')
    expect(run.report.summary.scriptsUnread).toBe(0)
    expect(run.status).toBe(ExitCode.Success)
  })
})

// The workflow ends with one script still streaming its body and one whose
// response never comes. The run waits its deadline for both, then records each
// exactly once as an unanswered request — evidence, not a finding: a script
// whose response never arrived never ran on the page, so nothing went
// unexamined and the run stays green, naming both for a human to look at.
describe('script requests that are never answered', () => {
  jest.setTimeout(240_000)
  let run: Run

  beforeAll(async () => {
    run = await runDetection('unanswered')
  })
  afterAll(() => stop(run))

  it('records each request once, on the payment page, as unanswered rather than unread', () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    const unanswered = [...target.unansweredRequests].sort((a, b) => a.url.localeCompare(b.url))
    expect(unanswered.map((request) => `${new URL(request.url).pathname}:${request.scope ?? 'unscoped'}`)).toEqual([`${HUNG_BODY}:payment`, `${HUNG_HEADERS}:payment`])
    for (const request of unanswered) expect(request).toMatchObject({ step: 4, reason: expect.stringContaining('no response had arrived') })
    expect(target.unreadScripts).toEqual([])
  })

  it('still compares every script it did read', () => {
    const target = run.report.targets.find((candidate) => candidate.workflowId === 'pay')!
    expect(comparedPaths(target)).toEqual([...LATE_SCRIPTS, '/sdk.js'].map((script) => `${script}:payment:unknown`).sort())
  })

  it('names them in the run summary as evidence, keeps the run complete and exits 0', () => {
    expect(run.report.run.status).toBe('complete')
    expect(run.report.summary).toMatchObject({ scriptsUnread: 0, requestsUnanswered: 2 })
    expect(run.output).toContain('[Console Alert -> Success]: Workflow execution completed successfully')
    expect(run.output).toContain('Script Requests Unanswered')
    expect(run.output).toContain(HUNG_BODY)
    expect(run.output).toContain(HUNG_HEADERS)
    expect(run.output).not.toContain('Scripts Not Read')
    expect(run.status).toBe(ExitCode.Success)
  })
})
