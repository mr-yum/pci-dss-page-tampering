/**
 * jsdom unit tests for script capture: insertion-patch attribution,
 * MutationObserver safety net, PerformanceObserver entries, cross-path
 * dedupe, the queue cap, inline-script capture (source reference +
 * initiator; fingerprinting is agent.ts's concern, not capture's), and
 * CSP-violation events (dedupe + clamping).
 */
import { type CspViolationCapture, drainCaptures, drainCspCaptures, drainInlineCaptures, getDroppedCount, type InlineScriptCapture, resetCaptureForTesting, type ScriptCapture, startCapture } from './capture.js'
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

  it('routes inline scripts (no src) to the inline queue, never the external one', () => {
    const script = document.createElement('script')
    script.textContent = 'void 0'
    document.body.appendChild(script)
    expect(drainCaptures()).toHaveLength(0)
    expect(drainInlineCaptures()).toHaveLength(1)
  })
})

describe('inline scripts', () => {
  function appendInline(source: string): HTMLScriptElement {
    const script = document.createElement('script')
    script.textContent = source
    document.body.appendChild(script)
    return script
  }

  it('captures an appendChild-inserted inline script with source, route and document initiator', () => {
    const before = Date.now()
    appendInline('window.__inline = 1')
    const captures = drainInlineCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as InlineScriptCapture
    expect(capture.source).toBe('window.__inline = 1')
    expect(capture.initiator).toBe(location.href)
    expect(capture.route).toBe('/')
    expect(capture.ts).toBeGreaterThanOrEqual(before)
  })

  it('attributes to document.currentScript.src when a script is executing the insertion', () => {
    const inserter = document.createElement('script')
    inserter.src = 'https://cdn.example.com/loader.js'
    setCurrentScript(inserter)
    appendInline('window.__injected = true')
    const captures = drainInlineCaptures()
    expect(captures).toHaveLength(1)
    expect((captures[0] as InlineScriptCapture).initiator).toBe('https://cdn.example.com/loader.js')
  })

  it('captures parser-path inline scripts (innerHTML) via the MutationObserver with the document URL as initiator', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = '<script>window.__parser = 1</script>'
    await nextTick()
    const captures = drainInlineCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as InlineScriptCapture
    expect(capture.source).toBe('window.__parser = 1')
    expect(capture.initiator).toBe(location.href)
  })

  it('skips whitespace-only content — nothing meaningful was observed', async () => {
    appendInline(' \n\t  ')
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = '<script>  \n </script>'
    await nextTick()
    expect(drainInlineCaptures()).toHaveLength(0)
  })

  it('does not double-capture the same element when the patch and the MutationObserver both see it', async () => {
    appendInline('window.__once = 1')
    await nextTick() // let the MutationObserver deliver its records too
    expect(drainInlineCaptures()).toHaveLength(1)
  })

  it('shares the queue cap with external captures and never burns dedupe state on a dropped capture', () => {
    for (let i = 0; i < 500; i += 1) insertScript(`/fill-${i}.js`)
    const overflow = appendInline('window.__overflow = 1') // at cap: dropped
    expect(getDroppedCount()).toBe(1)
    expect(drainInlineCaptures()).toHaveLength(0)
    drainCaptures()

    // Queue drained: re-inserting the SAME element captures it (it was never
    // marked as captured when it was dropped at the cap).
    document.body.appendChild(overflow)
    const captures = drainInlineCaptures()
    expect(captures).toHaveLength(1)
    expect((captures[0] as InlineScriptCapture).source).toBe('window.__overflow = 1')
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

describe('CSP violations', () => {
  /** jsdom has no SecurityPolicyViolationEvent constructor; a plain Event carrying the same fields exercises the listener identically. */
  function dispatchViolation(effectiveDirective: string, blockedURI: string): void {
    const event = new Event('securitypolicyviolation', { bubbles: true })
    Object.assign(event, { effectiveDirective, blockedURI })
    document.dispatchEvent(event)
  }

  it('captures a violation with directive, blocked URI, route and timestamp', () => {
    const before = Date.now()
    dispatchViolation('script-src', 'https://evil.example/skimmer.js')
    const captures = drainCspCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as CspViolationCapture
    expect(capture.directive).toBe('script-src')
    expect(capture.blockedUri).toBe('https://evil.example/skimmer.js')
    expect(capture.route).toBe('/')
    expect(capture.ts).toBeGreaterThanOrEqual(before)
  })

  it('dedupes per session on directive + blockedUri, but keeps distinct pairs', () => {
    dispatchViolation('script-src', 'https://evil.example/skimmer.js')
    dispatchViolation('script-src', 'https://evil.example/skimmer.js') // duplicate
    dispatchViolation('script-src', 'https://other.example/x.js') // new URI
    dispatchViolation('img-src', 'https://evil.example/skimmer.js') // new directive
    const captures = drainCspCaptures()
    expect(captures.map((capture) => `${capture.directive}|${capture.blockedUri}`)).toEqual(['script-src|https://evil.example/skimmer.js', 'script-src|https://other.example/x.js', 'img-src|https://evil.example/skimmer.js'])

    // Dedupe spans capture rounds — the session seen-set persists.
    dispatchViolation('script-src', 'https://evil.example/skimmer.js')
    expect(drainCspCaptures()).toHaveLength(0)
  })

  it("passes non-URL blockedURI strings ('inline', 'eval') through verbatim", () => {
    dispatchViolation('script-src', 'inline')
    dispatchViolation('script-src', 'eval')
    const captures = drainCspCaptures()
    expect(captures.map((capture) => capture.blockedUri)).toEqual(['inline', 'eval'])
  })

  it('clamps the directive to 128 chars and the blocked URI to 2048 chars', () => {
    dispatchViolation('d'.repeat(200), `https://evil.example/${'a'.repeat(3000)}`)
    const captures = drainCspCaptures()
    expect(captures).toHaveLength(1)
    const capture = captures[0] as CspViolationCapture
    expect(capture.directive).toBe('d'.repeat(128))
    expect(capture.blockedUri).toHaveLength(2048)
    expect(capture.blockedUri.startsWith('https://evil.example/')).toBe(true)
  })

  it('ignores events without an effective directive rather than shipping an empty observation', () => {
    const event = new Event('securitypolicyviolation', { bubbles: true })
    Object.assign(event, { blockedURI: 'https://evil.example/x.js' })
    document.dispatchEvent(event)
    expect(drainCspCaptures()).toHaveLength(0)
  })

  it('shares the queue cap and never burns the dedupe key on a dropped violation', () => {
    for (let i = 0; i < 500; i += 1) insertScript(`/fill-${i}.js`)
    dispatchViolation('script-src', 'https://evil.example/late.js') // at cap: dropped
    expect(getDroppedCount()).toBe(1)
    expect(drainCspCaptures()).toHaveLength(0)
    drainCaptures()

    // Queue drained: the SAME violation is capturable again.
    dispatchViolation('script-src', 'https://evil.example/late.js')
    expect(drainCspCaptures()).toHaveLength(1)
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
