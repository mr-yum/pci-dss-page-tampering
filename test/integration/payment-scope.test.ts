/**
 * Payment page scoping, end to end in real Chrome.
 *
 * Drives `main.ts` as a subprocess through a `--mode detection` run against a
 * file:// inventory with no authorised scripts, so every script observed is
 * an "unknown script" — and the question is only *which* of them the run
 * alerts on. Four variations walk the same fixture site:
 *
 * - `full`: a booking page with a tag manager, a client-side route change
 *   that preloads the payment SDK, then a FULL page load into checkout, whose
 *   card-entry step is marked `paymentPage`, then a "Pay" click that loads a
 *   confirmation page — a page after the payment page, which must stay in
 *   scope.
 * - `soft`: identical, but checkout is reached by a client-side route change —
 *   the regression a scoped monitor must catch, since the tag manager is then
 *   in the payment page's own document.
 * - `plain`: the `full` flow with no marker, which must behave exactly as an
 *   unscoped run always did.
 * - `routed`: the booking page routes client-side *to the checkout path*
 *   before a full load of checkout replaces it — the shape of a failed SPA
 *   render that reload recovery replaces. The booking document rendered the
 *   payment path, so it must stay in scope: this is what route recording
 *   (`Page.navigatedWithinDocument`) exists for.
 *
 * Needs the Chrome that Puppeteer installs; CI's `npm ci` provides it.
 */

import { execFileSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as os from 'os'
import * as path from 'path'

const MAIN_PATH = path.join(__dirname, '../../src/main.ts')
const TSX_BIN = path.join(__dirname, '../../node_modules/.bin/tsx')
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' }

const script = (name: string) => `window.__loaded=(window.__loaded||[]).concat(${JSON.stringify(name)});`

/** Booking page → client-side "upgrades" route (preloads the SDK) → checkout. */
const bookingPage = (variant: string, softCheckout: boolean) => `<!doctype html><html><body>
<script src="/tag-manager.js"></script>
<button onclick="history.pushState({},'','/${variant}/venue/${variant === 'routed' ? 'checkout' : 'upgrades'}');var s=document.createElement('script');s.src='/sdk.js';document.body.appendChild(s);document.getElementById('co').hidden=false">Continue</button>
<button id="co" hidden onclick="${
  softCheckout
    ? `history.pushState({},'','/${variant}/venue/checkout');var c=document.createElement('script');c.src='/checkout.js';document.body.appendChild(c);var p=document.createElement('span');p.textContent='Pay now';document.body.appendChild(p)`
    : `location.href='/${variant}/venue/checkout'`
}">Checkout</button></body></html>`

const checkoutPage = '<!doctype html><html><body><script src="/sdk.js"></script><script src="/checkout.js"></script><span>Pay now</span><button onclick="location.href=\'confirm\'">Pay</button></body></html>'
const confirmationPage = '<!doctype html><html><body><script src="/confirm.js"></script><span>Confirmed</span></body></html>'

const startServer = (): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]!
      const scripts: Record<string, string> = { '/tag-manager.js': 'tag-manager', '/sdk.js': 'sdk', '/checkout.js': 'checkout', '/confirm.js': 'confirm' }
      if (scripts[url] !== undefined) return response.writeHead(200, { 'content-type': 'text/javascript' }).end(script(scripts[url]))
      const booking = url.match(/^\/(full|soft|plain|routed)\/venue$/u)
      if (booking) return response.writeHead(200, { 'content-type': 'text/html' }).end(bookingPage(booking[1]!, booking[1] === 'soft'))
      if (/^\/(full|soft|plain|routed)\/venue\/checkout$/u.test(url)) return response.writeHead(200, { 'content-type': 'text/html' }).end(checkoutPage)
      if (/^\/(full|soft|plain|routed)\/venue\/confirm$/u.test(url)) return response.writeHead(200, { 'content-type': 'text/html' }).end(confirmationPage)
      return response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const steps = (marked: boolean, payAfter: boolean) => [
  { description: 'Continue', waitFor: [{ type: 'button', identifier: 'Continue' }], action: { type: 'click', delay: 300 } },
  { description: 'Checkout', waitFor: [{ type: 'button', identifier: 'Checkout' }], action: { type: 'click', delay: 300 } },
  { description: 'Card entry ready', ...(marked ? { paymentPage: true } : {}), waitFor: [{ type: 'span', identifier: 'Pay now' }], action: { type: 'escape', delay: 800 } },
  ...(payAfter
    ? [
        { description: 'Pay', waitFor: [{ type: 'button', identifier: 'Pay' }], action: { type: 'click', delay: 300 } },
        { description: 'Confirmation', waitFor: [{ type: 'span', identifier: 'Confirmed' }], action: { type: 'escape', delay: 800 } },
      ]
    : []),
]

const createFixtureRepo = (base: string): string => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-payment-scope-repo-'))
  fs.mkdirSync(path.join(repoPath, 'targets'))
  fs.mkdirSync(path.join(repoPath, 'workflows'))
  const variation = (id: string, name: string, marked: boolean, payAfter = false) => {
    fs.writeFileSync(path.join(repoPath, `workflows/${id}.json`), JSON.stringify({ steps: steps(marked, payAfter) }))
    return {
      id,
      inventory: { type: 'inventory', name: `${name} staging`, url: `${base}/${id}/venue`, workflow: `${id}.json` },
      detection: { type: 'detection', name, url: `${base}/${id}/venue`, workflow: `${id}.json` },
    }
  }
  const inventory = {
    target: { workflows: [variation('full', 'Full load', true, true), variation('soft', 'Soft checkout', true), variation('plain', 'Unmarked', false), variation('routed', 'Routed to checkout', true)] },
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
type Target = { workflowId: string; scripts: Row[]; paymentScope?: { documents: { url: string; paymentPage: boolean; scope: string }[] } }

describe('payment page scoping in real Chrome', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let output = ''
  let targets: Record<string, Target> = {}

  beforeAll(async () => {
    server = await startServer()
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    repoPath = createFixtureRepo(base)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-payment-scope-cwd-'))
    const reportDir = path.join(workDir, 'reports')

    // Asynchronous: the page server lives in this process and must keep serving.
    await new Promise<void>((resolve, reject) => {
      const args = [TSX_BIN, MAIN_PATH, '--mode', 'detection', '--repo', `file://${repoPath}`, '--git-token', 'dummy-token', '--report-dir', reportDir]
      const child = spawn('sh', ['-c', `${args.map((part) => `'${part}'`).join(' ')} 2>&1`], { env: { ...process.env, NODE_ENV: 'test' }, cwd: workDir })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
      const timer = setTimeout(() => child.kill('SIGKILL'), 200_000)
      child.on('error', reject)
      child.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'detection', 'report.json'), 'utf8'))
    targets = Object.fromEntries(report.targets.map((target: Target) => [target.workflowId, target]))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const dir of [repoPath, workDir]) fs.rmSync(dir, { recursive: true, force: true })
  })

  const scopes = (workflowId: string) => targets[workflowId]!.scripts.map((row) => `${new URL(row.name).pathname}:${row.scope ?? 'unscoped'}`).sort()

  /**
   * The script list of the "Unknown scripts detected" alert for one target.
   * Keyed on the alert's own header line and read up to the blank line that
   * ends it: other targets' log lines interleave into the output and mention
   * their own URLs, so matching on a URL anywhere in a chunk picks the wrong alert.
   */
  const alerted = (pathPrefix: string): string[] => {
    const lines = output.split('\n')
    const start = lines.findIndex((line) => line.includes('[Console Alert -> Script]: Unknown scripts detected for target:') && line.trimEnd().endsWith(`/${pathPrefix}/venue`))
    if (start === -1) return []
    const end = lines.findIndex((line, index) => index > start && line.trim() === '')
    return lines
      .slice(start + 1, end === -1 ? undefined : end)
      .map((line) => line.match(/^\s+\d+\. (\S+)$/u)?.[1])
      .filter((url): url is string => url !== undefined)
      .map((url) => new URL(url).pathname)
      .sort()
  }

  // The confirmation page is loaded after the payment page by a full
  // navigation: like a 3-D Secure redirect or a reload of the card form, it
  // must stay in scope. Only pages loaded *before* the payment page leave it.
  it('alerts on the payment page and every page after it, but not on pages loaded before it', () => {
    expect(alerted('full')).toEqual(['/checkout.js', '/confirm.js', '/sdk.js'])
    expect(scopes('full')).toEqual(['/checkout.js:payment', '/confirm.js:payment', '/sdk.js:outside_payment', '/sdk.js:payment', '/tag-manager.js:outside_payment'])
    expect(targets['full']!.paymentScope!.documents.map((d) => `${new URL(d.url).pathname}:${d.scope}${d.paymentPage ? ':marked' : ''}`)).toEqual([
      '/full/venue:outside_payment',
      '/full/venue/checkout:payment:marked',
      '/full/venue/confirm:payment',
    ])
  })

  it('alerts on the tag manager once checkout is reached client-side, because it is then in the payment page', () => {
    expect(alerted('soft')).toEqual(['/checkout.js', '/sdk.js', '/tag-manager.js'])
    expect(scopes('soft')).toEqual(['/checkout.js:payment', '/sdk.js:payment', '/tag-manager.js:payment'])
  })

  it('keeps an earlier page that routed to the checkout path in scope, so its tag manager is alerted', () => {
    expect(alerted('routed')).toEqual(['/checkout.js', '/sdk.js', '/tag-manager.js'])
    expect(scopes('routed')).toEqual(['/checkout.js:payment', '/sdk.js:payment', '/tag-manager.js:payment'])
    expect(targets['routed']!.paymentScope!.documents.map((d) => `${new URL(d.url).pathname}:${d.scope}`)).toEqual(['/routed/venue:payment', '/routed/venue/checkout:payment'])
  })

  it('leaves an unmarked workflow exactly as before: everything alerted, each script once, no scope', () => {
    expect(alerted('plain')).toEqual(['/checkout.js', '/sdk.js', '/tag-manager.js'])
    expect(scopes('plain')).toEqual(['/checkout.js:unscoped', '/sdk.js:unscoped', '/tag-manager.js:unscoped'])
    expect(targets['plain']!.paymentScope).toBeUndefined()
  })

  it('never logs an earlier page’s script as a bare finding', () => {
    const tagManagerLines = output.split('\n').filter((line) => line.includes('[detection:Full load]') && line.includes('/tag-manager.js') && line.includes('not identified'))
    expect(tagManagerLines.length).toBeGreaterThan(0)
    expect(tagManagerLines.every((line) => line.includes('[outside payment page]'))).toBe(true)
  })
})
