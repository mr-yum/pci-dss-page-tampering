/**
 * jsdom unit tests for external-script capture: insertion-patch attribution,
 * MutationObserver safety net, PerformanceObserver entries, cross-path
 * dedupe, and the queue cap.
 */
import { drainCaptures, getDroppedCount, resetCaptureForTesting, type ScriptCapture, startCapture } from './capture.js'
import { resetSessionStateForTesting } from './session.js'

type ResourceEntryLike = { name: string; initiatorType: string }

/** Minimal PerformanceObserver stand-in (jsdom has none). */
class StubPerformanceObserver {
  static last: StubPerformanceObserver | null = null
  static lastObserveOptions: unknown = null
  private readonly callback: PerformanceObserverCallback

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback
    StubPerformanceObserver.last = this
  }

  observe(options: unknown): void {
    StubPerformanceObserver.lastObserveOptions = options
  }

  disconnect(): void {
    // Nothing to tear down in the stub.
  }

  emit(entries: ResourceEntryLike[]): void {
    this.callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, this as unknown as PerformanceObserver)
  }
}

const stubObserverClass = StubPerformanceObserver as unknown as typeof PerformanceObserver

function insertScript(src: string): HTMLScriptElement {
  const script = document.createElement('script')
  script.src = src
  document.body.appendChild(script)
  return script
}

/** Waits for MutationObserver microtask delivery. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function setCurrentScript(script: HTMLScriptElement | null): void {
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: () => script,
  })
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetSessionStateForTesting()
  resetCaptureForTesting()
  StubPerformanceObserver.last = null
  StubPerformanceObserver.lastObserveOptions = null
  document.body.innerHTML = ''
  startCapture({ performanceObserver: stubObserverClass })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'currentScript')
})

describe('insertion patch', () => {
  it('captures an appendChild-inserted script with the document as initiator', () => {
    const before = Date.now()
    insertScript('/vendor.js')
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as ScriptCapture
    expect(capture.url).toBe('http://localhost/vendor.js')
    // No script is executing in jsdom tests, so attribution falls back to
    // the document URL — the same fallback parser-inserted scripts get.
    expect(capture.initiator).toBe(location.href)
    expect(capture.route).toBe('/')
    expect(capture.ts).toBeGreaterThanOrEqual(before)
  })

  it('attributes to document.currentScript.src when a script is executing', () => {
    const inserter = document.createElement('script')
    inserter.src = 'https://cdn.example.com/loader.js'
    setCurrentScript(inserter)
    insertScript('/loaded-by-cdn.js')
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    expect((captures[0] as ScriptCapture).initiator).toBe('https://cdn.example.com/loader.js')
  })

  it('captures insertBefore-inserted scripts too', () => {
    const reference = document.createElement('div')
    document.body.appendChild(reference)
    const script = document.createElement('script')
    script.src = '/before.js'
    document.body.insertBefore(script, reference)
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    expect((captures[0] as ScriptCapture).url).toBe('http://localhost/before.js')
  })

  it('ignores inline scripts (no src) — a later task owns those', () => {
    const script = document.createElement('script')
    script.textContent = 'void 0'
    document.body.appendChild(script)
    expect(drainCaptures()).toHaveLength(0)
  })
})

describe('MutationObserver safety net', () => {
  it('captures parser-path scripts (innerHTML) with the document URL as initiator', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = '<script src="/parser.js"></script>'
    await nextTick()
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as ScriptCapture
    expect(capture.url).toBe('http://localhost/parser.js')
    expect(capture.initiator).toBe(location.href)
  })
})

describe('PerformanceObserver safety net', () => {
  it('observes buffered resource entries', () => {
    expect(StubPerformanceObserver.lastObserveOptions).toEqual({ type: 'resource', buffered: true })
  })

  it('captures script resource entries without attribution, ignoring other kinds', () => {
    StubPerformanceObserver.last?.emit([
      { name: 'http://localhost/perf.js', initiatorType: 'script' },
      { name: 'http://localhost/styles.css', initiatorType: 'link' },
      { name: 'http://localhost/logo.png', initiatorType: 'img' },
    ])
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as ScriptCapture
    expect(capture.url).toBe('http://localhost/perf.js')
    expect(capture.initiator).toBeUndefined()
  })
})

describe('dedupe across paths', () => {
  it('captures a script once even when every path sees it', async () => {
    insertScript('/dup.js')
    StubPerformanceObserver.last?.emit([{ name: 'http://localhost/dup.js', initiatorType: 'script' }])
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = '<script src="/dup.js"></script>'
    await nextTick()
    expect(drainCaptures()).toHaveLength(1)
  })

  it('re-captures a known URL injected by a NEW initiator (supply-chain signal)', () => {
    insertScript('/shared.js')
    const inserter = document.createElement('script')
    inserter.src = 'https://evil.example/injector.js'
    setCurrentScript(inserter)
    insertScript('/shared.js')
    const captures = drainCaptures()
    expect(captures).toHaveLength(2)
    expect((captures[1] as ScriptCapture).initiator).toBe('https://evil.example/injector.js')
  })
})

describe('queue cap', () => {
  it('drops beyond the pending cap and counts the drops', () => {
    for (let i = 0; i < 505; i += 1) insertScript(`/bulk-${i}.js`)
    expect(getDroppedCount()).toBe(5)
    expect(drainCaptures()).toHaveLength(500)
  })

  it('a capture dropped at the cap stays re-capturable after the queue drains (dedupe keys are not burned)', () => {
    for (let i = 0; i < 500; i += 1) insertScript(`/fill-${i}.js`)
    insertScript('/overflow.js') // at cap: dropped, and must NOT be marked seen
    expect(getDroppedCount()).toBe(1)
    const drained = drainCaptures()
    expect(drained.map((capture) => capture.url)).not.toContain('http://localhost/overflow.js')

    insertScript('/overflow.js') // queue drained: the same script is capturable again
    const captures = drainCaptures()
    expect(captures).toHaveLength(1)
    expect((captures[0] as ScriptCapture).url).toBe('http://localhost/overflow.js')
  })
})
