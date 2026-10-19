/**
 * Finding a framed workflow step's target among several same-URL frames whose
 * renderer is busy, in real Chrome.
 *
 * Card providers' split fields put the number, expiry and CVC inputs each in
 * a cross-site frame of its own, all three at the same URL (the field is
 * chosen by the fragment). Right after a complete card number goes in, the
 * provider's frames are busy, and on a contended CI runner every DevTools
 * round trip into them is slow. The monitor used to search those frames one
 * after another, 100 ms each: once every round trip outlasted the slice, every
 * attempt was cut off and an expiry field that was visible the whole time was
 * never found — a 120 s timeout on both attempts, failing the target.
 *
 * This reproduces that: the frames' shared renderer runs back-to-back long
 * tasks and every frame's CPU is throttled. Waiting in every frame at once,
 * each wait lasting the whole deadline, finds the field; the old round robin
 * did not find it at all within the same deadline.
 *
 * 127.0.0.1 serves the page and localhost the frames: different sites, so
 * under site isolation the frames get a renderer — and DevTools sessions — of
 * their own. (Different ports alone are the same site.) The browser is driven
 * from a tsx child process (`__fixtures__/framed-step-search-driver.ts`)
 * because Puppeteer is ESM-only; this process serves the pages.
 */

import { spawn } from 'child_process'
import * as http from 'http'
import type { AddressInfo } from 'net'
import * as path from 'path'

const TSX_BIN = path.join(__dirname, '../../node_modules/.bin/tsx')
const DRIVER = path.join(__dirname, '__fixtures__/framed-step-search-driver.ts')

// Each frame reads which field it holds from its fragment, so all three share
// one URL as a provider's split fields do. The CVC frame also holds a hidden
// input; with `?busy`, the expiry frame keeps the frames' shared renderer busy
// with back-to-back long tasks.
const cardFrame = `<!doctype html><html><body><script>
const field = new URLSearchParams(location.hash.slice(1)).get('field')
const input = document.createElement('input'); input.name = field; document.body.appendChild(input)
if (field === 'cvc') { const hidden = document.createElement('input'); hidden.name = 'postcode'; hidden.hidden = true; document.body.appendChild(hidden) }
if (field === 'expiry' && location.search.includes('busy')) (function spin() { const t = performance.now(); while (performance.now() - t < 100) {} setTimeout(spin, 0) })()
</script></body></html>`

const checkoutPage = (frameOrigin: string, query: string): string =>
  `<!doctype html><html><body>${['number', 'expiry', 'cvc'].map((field) => `<iframe src="${frameOrigin}/frame/card${query}#field=${field}"></iframe>`).join('')}</body></html>`

type DriverResult = {
  busy: { frames: number; frameField?: string; inputName?: string; elapsedMs: number; error?: string }
  timeout: { frames: number; name: string; message: string }
}

describe('framed step search across busy same-URL frames', () => {
  jest.setTimeout(120_000)

  let server: http.Server
  let frameUrl: string
  let result: DriverResult

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const frameOrigin = `http://localhost:${(server.address() as AddressInfo).port}`
      if (url.pathname === '/checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(checkoutPage(frameOrigin, url.search))
      if (url.pathname === '/frame/card') return response.writeHead(200, { 'content-type': 'text/html' }).end(cardFrame)
      return response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    frameUrl = `http://localhost:${port}/frame/card`

    const output = await new Promise<string>((resolve, reject) => {
      let stdout = ''
      const child = spawn(TSX_BIN, [DRIVER, `http://127.0.0.1:${port}`], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'pipe', 'inherit'] })
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`browser driver exited ${code}: ${stdout}`))))
    })
    result = JSON.parse(output.trim().split('\n').at(-1)!) as DriverResult
  })

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve))
  })

  it('finds the expiry field in its own frame while the frames are busy and throttled', () => {
    expect(result.busy).toMatchObject({ frames: 3, frameField: 'expiry', inputName: 'expiry' })
    // Found well inside the 30 s deadline, not at its edge.
    expect(result.busy.elapsedMs).toBeLessThan(20_000)
  })

  it('says, frame by frame, what each same-URL frame held when the field never appears', () => {
    expect(result.timeout.frames).toBe(3)
    expect(result.timeout.name).toBe('TimeoutError')
    expect(result.timeout.message).toContain(`Matching frames: 3 (#1 ${frameUrl}: selector absent; #2 ${frameUrl}: selector absent; #3 ${frameUrl}: selector present but not visible).`)
    expect(result.timeout.message).toContain(`${frameUrl} (×3)`)
  })
})
