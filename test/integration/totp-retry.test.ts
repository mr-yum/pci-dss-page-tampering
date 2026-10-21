/**
 * A `totp` step whose first code is refused, end to end in real Chrome.
 *
 * A sign-in server refuses a TOTP code it has already accepted in the same
 * 30 s window (replay protection). Two monitor runs signing in as one
 * principal inside one window — a push to each of two repositories a few
 * seconds apart — therefore lose one of the two sign-ins, and before the step
 * retried, the losing run timed out on the next step with the code field still
 * on the page. Here the page refuses the first code it is given and keeps the
 * field, as such a server does; it accepts only a DIFFERENT six-digit code
 * typed over the old digits, and then moves on. The step must notice the field
 * still showing, wait for the next window, and type that window's code.
 *
 * Drives `main.ts` as a subprocess through a `--mode detection` run against a
 * file:// inventory, the way the scheduled run executes. It waits out up to one
 * real 30 s TOTP window. Needs the Chrome that Puppeteer installs; CI's
 * `npm ci` provides it.
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
// RFC 4648 test-vector style seed; any valid base32 works for a fixture.
const SEED = 'JBSWY3DPEHPK3PXP'

const alerts = {
  inventory: { newScriptIdentified: { destination: '#pci-inventory' }, newHeaderIdentified: { destination: '#pci-inventory' } },
  detection: { newScriptDetected: { destination: '#pci-alerts' }, scriptMismatchDetected: { destination: '#pci-alerts' }, newHeaderDetected: { destination: '#pci-alerts' } },
  successNotification: { destination: '#pci-success' },
}

// The first complete code is refused and left in the field; a different code
// replacing it is accepted. A code appended to the old one would exceed the
// field's six characters and never be accepted.
const signInPage = `<!doctype html><html><body>
<input data-testid="otp-input" maxlength="6" autocomplete="one-time-code"><p id="error"></p>
<script>
let refused = null
const input = document.querySelector('[data-testid="otp-input"]')
input.addEventListener('input', () => {
  if (input.value.length !== 6) return
  if (refused === null) { refused = input.value; document.getElementById('error').textContent = 'That code has already been used'; return }
  if (input.value !== refused) location.href = '/signed-in'
})
</script></body></html>`

const pages: Record<string, string> = {
  '/sign-in': signInPage,
  '/signed-in': '<!doctype html><html><body><div class="checkout">Checkout</div></body></html>',
}

const workflow = {
  steps: [
    { description: 'Enter the one-time code', waitFor: [{ type: 'testid', identifier: 'otp-input' }], action: { type: 'totp', seedRef: 'principal', autoSubmits: true } },
    { description: 'Signed in', waitFor: [{ type: 'div', identifier: 'checkout' }], action: { type: 'escape' } },
  ],
}

describe('totp step: a refused code is retried with the next window', () => {
  jest.setTimeout(240_000)

  let server: http.Server
  let repoPath: string
  let workDir: string
  let result: { status: number | null; output: string }

  beforeAll(async () => {
    server = await new Promise<http.Server>((resolve) => {
      const created = http.createServer((request, response) => {
        const url = (request.url ?? '/').split('?')[0]!
        response.writeHead(url in pages ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(pages[url] ?? '')
      })
      created.listen(0, '127.0.0.1', () => resolve(created))
    })
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-totp-retry-repo-'))
    fs.mkdirSync(path.join(repoPath, 'targets'))
    fs.mkdirSync(path.join(repoPath, 'workflows'))
    const target = { type: 'detection', name: 'sign-in production', url: `${origin}/sign-in`, workflow: 'sign-in.json' }
    const inventory = { target: { workflows: [{ id: 'sign-in', inventory: { ...target, type: 'inventory', name: 'sign-in staging' }, detection: target }] }, alerts, scripts: [], headers: [] }
    fs.writeFileSync(path.join(repoPath, 'targets/shop.json'), JSON.stringify(inventory, null, 2))
    fs.writeFileSync(path.join(repoPath, 'workflows/sign-in.json'), JSON.stringify(workflow, null, 2))
    const git = (args: string[]) => execFileSync('git', args, { cwd: repoPath, env: gitEnv, stdio: 'ignore' })
    git(['init', '--initial-branch=main'])
    git(['add', '.'])
    git(['commit', '-m', 'fixture'])
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pci-totp-retry-cwd-'))

    // Asynchronous on purpose: the page server lives in this process.
    result = await new Promise((resolve, reject) => {
      const args = [MAIN_PATH, '--mode', 'detection', '--repo', `file://${repoPath}`, '--git-token', 'dummy', '--detection-branch', 'main', '--totp-seed', `principal=${SEED}`]
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

  it('notices the refused code and types the next window’s', () => {
    expect(result.output).toContain("One-time code not accepted within 10 s (the code field is still showing; most likely this window's code was already used). Typing the next window's code")
  })

  it('signs in with the second code, finishes the workflow and exits 0', () => {
    expect(result.output).not.toContain('TIMEOUT ERROR')
    expect(result.output).toContain('Detection workflow completed successfully')
    expect(result.status).toBe(ExitCode.Success)
  })

  it('never puts the seed in the output', () => {
    expect(result.output).not.toContain(SEED)
  })
})
