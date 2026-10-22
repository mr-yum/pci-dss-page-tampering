/**
 * Browser side of framed-step-search.test.ts, run with tsx: Puppeteer is
 * ESM-only, so Jest cannot load it in-process. Prints one JSON line with what
 * each scenario observed. Usage: framed-step-search-driver.ts <page origin>
 */

import puppeteer, { type ElementHandle, type Frame, type Page } from 'puppeteer'

import { DetectionService, frameSessionOf } from '../../../src/services/detection.js'
import type { PuppeteerLocatorAction } from '../../../src/types/puppeteer.js'

type Internals = {
  waitForActionTarget(page: Page, step: PuppeteerLocatorAction, timeout?: number): Promise<{ context: Page | Frame; element?: ElementHandle<Element>; querySelector?: string }>
  directSelectorStateIn(frame: Frame, selector: string): Promise<string>
}

export const FRAME_URL = '^http://localhost:\\d+/frame/card(?:[?#]|$)'
const origin = process.argv[2]!
const step = (querySelector: string): PuppeteerLocatorAction => ({ description: 'Find a split card field', querySelector, frameUrl: FRAME_URL, action: { type: 'input', value: '1229' }, delay: 0 })
const service = new DetectionService() as unknown as Internals

// Same flags as main.ts: CI's container has no usable Chrome sandbox.
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

// A page whose three card frames have loaded, optionally with every frame's
// CPU throttled on its own DevTools session.
async function checkout(query: string, cpuThrottle?: number): Promise<{ page: Page; frames: number }> {
  const page = await (await browser.createBrowserContext()).newPage()
  await page.goto(`${origin}/checkout${query}`, { waitUntil: 'load' })
  const frames = page.frames().filter((frame) => new RegExp(FRAME_URL).test(frame.url()))
  if (cpuThrottle !== undefined) {
    for (const frame of frames) {
      // Fail loudly: without the throttle the old round robin passes too, and
      // the test would stop proving anything.
      const session = frameSessionOf(frame)
      if (session === undefined) throw new Error('Puppeteer no longer exposes a frame’s DevTools session; cannot throttle the card frames')
      await session.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
    }
  }
  return { page, frames: frames.length }
}

try {
  const busy = await checkout('?busy', 40)
  const started = Date.now()
  const found = await service.waitForActionTarget(busy.page, step('input[name="expiry"]'), 60_000).then(
    async (target) => ({
      frameField: new URLSearchParams(new URL((target.context as Frame).url()).hash.slice(1)).get('field'),
      inputName: await target.element!.evaluate((input) => (input as HTMLInputElement).name),
      elapsedMs: Date.now() - started,
    }),
    (error: Error) => ({ error: `${error.name}: ${error.message}`, elapsedMs: Date.now() - started }),
  )
  await busy.page.browserContext().close()

  const idle = await checkout('')
  const timedOut = await service.waitForActionTarget(idle.page, step('input[name="postcode"]'), 1_000).then(
    () => ({ name: 'resolved', message: '' }),
    (error: Error) => ({ name: error.name, message: error.message }),
  )
  // The direct check Chrome answers, run for real against a live cross-site
  // card frame (the CVC one, which also holds a hidden input).
  const cvcFrame = idle.page.frames().find((frame) => new RegExp(FRAME_URL).test(frame.url()) && frame.url().endsWith('#field=cvc'))!
  const direct: Record<string, string> = {}
  for (const [label, selector] of [
    ['visible', 'input[name="cvc"]'],
    ['hidden', 'input[name="postcode"]'],
    ['invisible', 'input[name="ghost"]'],
    ['absent', 'input[name="expiry"]'],
    ['unsupported', 'button ::-p-text(Pay)'],
  ] as const)
    direct[label] = await service.directSelectorStateIn(cvcFrame, selector)
  // A step whose own chain only ever matches an element that is present but
  // `visibility: hidden`, with a visible alternative: it must resolve to the
  // alternative, in the frame that holds it.
  const alternative = await service.waitForActionTarget(idle.page, { ...step('input[name="ghost"]'), alternativeQuerySelectors: ['input[name="cvc"]'] }, 10_000).then(
    (target) => ({ querySelector: target.querySelector ?? null, frameField: new URLSearchParams(new URL((target.context as Frame).url()).hash.slice(1)).get('field') }),
    (error: Error) => ({ querySelector: null, frameField: null, error: `${error.name}: ${error.message}` }),
  )
  await idle.page.browserContext().close()

  // Last, since its renderer never recovers: one card frame that stops
  // answering 1.5 s after it loads (its load never completes the page's own,
  // so wait for the frame rather than the page's load event).
  const hungPage = await (await browser.createBrowserContext()).newPage()
  await hungPage.goto(`${origin}/hung-checkout`, { waitUntil: 'domcontentloaded' })
  const frameDeadline = Date.now() + 10_000
  while (Date.now() < frameDeadline && !hungPage.frames().some((frame) => new RegExp(FRAME_URL).test(frame.url()))) await new Promise((resolve) => setTimeout(resolve, 100))
  await new Promise((resolve) => setTimeout(resolve, 2_500))
  const hungFrames = hungPage.frames().filter((frame) => new RegExp(FRAME_URL).test(frame.url())).length
  const hung = await service.waitForActionTarget(hungPage, step('input[name="postcode"]'), 1_000).then(
    () => ({ name: 'resolved', message: '' }),
    (error: Error) => ({ name: error.name, message: error.message }),
  )

  console.log(JSON.stringify({ busy: { frames: busy.frames, ...found }, timeout: { frames: idle.frames, ...timedOut }, direct, alternative, hung: { frames: hungFrames, ...hung } }))
} finally {
  await browser.close()
}
