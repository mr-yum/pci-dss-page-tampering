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
// input and one laid out but `visibility: hidden`; with `?busy`, the expiry frame keeps the frames' shared renderer busy
// with back-to-back long tasks; with `?hung`, the renderer stops answering for
// good 1.5 s after the frame loads.
const cardFrame = `<!doctype html><html><body><script>
const field = new URLSearchParams(location.hash.slice(1)).get('field')
// In the CVC frame the \`visibility: hidden\` input comes FIRST in document order,
// ahead of the visible field: one selector list naming both would resolve to it.
if (field === 'cvc') { const ghost = document.createElement('input'); ghost.name = 'ghost'; ghost.style.visibility = 'hidden'; document.body.appendChild(ghost) }
const input = document.createElement('input'); input.name = field; document.body.appendChild(input)
if (field === 'cvc') { const hidden = document.createElement('input'); hidden.name = 'postcode'; hidden.hidden = true; document.body.appendChild(hidden) }
if (field === 'expiry' && location.search.includes('busy')) (function spin() { const t = performance.now(); while (performance.now() - t < 100) {} setTimeout(spin, 0) })()
if (location.search.includes('hung')) setTimeout(() => { for (;;) {} }, 1500)
</script></body></html>`

const checkoutPage = (frameOrigin: string, query: string): string =>
  `<!doctype html><html><body>${['number', 'expiry', 'cvc'].map((field) => `<iframe src="${frameOrigin}/frame/card${query}#field=${field}"></iframe>`).join('')}</body></html>`

type DriverResult = {
  busy: { frames: number; frameField?: string; inputName?: string; elapsedMs: number; error?: string }
  timeout: { frames: number; name: string; message: string }
  direct: Record<'visible' | 'hidden' | 'invisible' | 'absent' | 'unsupported', string>
  alternative: { querySelector: string | null; frameField: string | null; error?: string }
  hung: { frames: number; name: string; message: string }
}

describe('framed step search across busy same-URL frames', () => {
  jest.setTimeout(180_000)

  let server: http.Server
  let frameUrl: string
  let result: DriverResult

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const frameOrigin = `http://localhost:${(server.address() as AddressInfo).port}`
      if (url.pathname === '/checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(checkoutPage(frameOrigin, url.search))
      if (url.pathname === '/hung-checkout') return response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html><body><iframe src="${frameOrigin}/frame/card?hung#field=expiry"></iframe></body></html>`)
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
    // Found well inside the 60 s deadline, not at its edge. The deadline is
    // generous because this shares the machine with the rest of the suite's
    // Chrome instances; the old round robin starved outright under this
    // throttling rather than running slowly, so the margin costs no power.
    expect(result.busy.elapsedMs).toBeLessThan(45_000)
  })

  it('says, frame by frame, what each same-URL frame held when the field never appears', () => {
    expect(result.timeout.frames).toBe(3)
    expect(result.timeout.name).toBe('TimeoutError')
    expect(result.timeout.message).toContain(`Matching frames: 3 (#1 ${frameUrl}: selector absent; #2 ${frameUrl}: selector absent; #3 ${frameUrl}: selector present but not visible).`)
    expect(result.timeout.message).toContain(`${frameUrl} (×3)`)
  })

  it('gets the selector’s real state from Chrome over a live cross-site frame’s own DevTools session', () => {
    // The frame-alive branch end to end: the isolated world is created on the
    // frame's own session with its own frame id, the expression runs there,
    // and each state maps to its fixed wording.
    expect(result.direct.visible).toMatch(/^selector visible; Chrome answered within the same 2000 ms/)
    expect(result.direct.hidden).toMatch(/^selector present but not visible; Chrome answered/)
    expect(result.direct.invisible).toMatch(/^selector present but not visible; Chrome answered/)
    expect(result.direct.absent).toMatch(/^selector absent; Chrome answered/)
    expect(result.direct.unsupported).toMatch(/^the selector uses Puppeteer-only syntax, so its state was not checked; Chrome answered/)
  })

  it('resolves a step to its visible alternative when its own chain only matches a hidden element', () => {
    expect(result.alternative).toEqual({ querySelector: 'input[name="cvc"]', frameField: 'cvc' })
  })

  it('asks Chrome directly about a frame that stopped answering, and says when its renderer is hung', () => {
    // Puppeteer's probe gets nothing from the hung frame; asking Chrome over
    // the frame's own DevTools session gets nothing either, which is what
    // tells a hung renderer apart from a stuck Puppeteer handle.
    expect(result.hung.frames).toBe(1)
    expect(result.hung.name).toBe('TimeoutError')
    expect(result.hung.message).toContain(`Matching frames: 1 (#1 ${frameUrl}: no answer within 2000 ms; asked directly over DevTools: no answer within 2000 ms either — the frame’s renderer is not responding).`)
  })
})
