/**
 * jsdom unit tests for the agent entry: config pickup, idle processing,
 * beacon splitting, and transport (sendBeacon with fetch-keepalive fallback).
 *
 * The REAL beacon schema (Zod) is imported here to prove produced beacons
 * round-trip — importing it in tests is fine; the agent runtime itself only
 * ever imports types from it.
 */
import { type AgentHealthObservation, type CspViolationObservation, type ExternalScriptObservation, type InlineScriptObservation, parseBeacon } from '../../src/types/beacon.js'
import { AGENT_VERSION, flushObservations, getOversizeDroppedCount, getPendingObservationCount, initAgent, processInlineCaptures, processPendingCaptures, resetAgentCountersForTesting, splitObservations, stopAgent } from './agent.js'
import { resetCaptureForTesting } from './capture.js'
import { INLINE_HASH_CEILING_BYTES } from './fingerprint.js'
import { resetSessionStateForTesting } from './session.js'

const COLLECTOR_URL = 'https://collector.example/beacon'
const MAX_BEACON_BYTES = 32768

// jsdom provides no TextEncoder; parseBeacon needs one for its byte cap.
// Minimal UTF-8 encoder — enough for byte-length checks in tests.
class TestTextEncoder {
  encode(value: string): Uint8Array {
    const bytes: number[] = []
    for (const character of value) {
      const codePoint = character.codePointAt(0) as number
      if (codePoint < 0x80) bytes.push(codePoint)
      else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 63))
      else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63))
      else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 63), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63))
    }
    return Uint8Array.from(bytes)
  }
}
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder?: unknown }).TextEncoder = TestTextEncoder
}

function installCollectorTag(url: string = COLLECTOR_URL): HTMLScriptElement {
  const script = document.createElement('script')
  script.setAttribute('data-collector', url)
  document.head.appendChild(script)
  return script
}

function mockSendBeacon(result = true): jest.Mock {
  const beaconMock = jest.fn().mockReturnValue(result)
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beaconMock })
  return beaconMock
}

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn().mockReturnValue(Promise.resolve())
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock })
  return fetchMock
}

function removeFetch(): void {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: undefined })
}

function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}

function insertScript(src: string): void {
  const script = document.createElement('script')
  script.src = src
  document.body.appendChild(script)
}

function appendInline(source: string): void {
  const script = document.createElement('script')
  script.textContent = source
  document.body.appendChild(script)
}

function setCurrentScript(script: HTMLScriptElement | null): void {
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get: () => script,
  })
}

// Node's WebCrypto via jest.requireActual: the agent tsconfig deliberately
// has no Node types, so a static `import from 'node:crypto'` must not appear.
const { webcrypto } = jest.requireActual('node:crypto') as { webcrypto: Crypto }

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

/** jsdom ships no crypto.subtle; Node's WebCrypto provides the real SHA-256 path. */
function installWebCrypto(): void {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
}

function restoreCrypto(): void {
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  else Reflect.deleteProperty(globalThis, 'crypto')
}

/** Reads a Blob's text via FileReader (jsdom's Blob lacks .text()). */
function blobText(blob: Blob): Promise<string> {
  const withText = blob as Blob & { text?: () => Promise<string> }
  if (typeof withText.text === 'function') return withText.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsText(blob)
  })
}

function sentBody(beaconMock: jest.Mock, call = 0): Promise<string> {
  const args = beaconMock.mock.calls[call] as [string, Blob]
  expect(args[1]).toBeInstanceOf(Blob)
  expect(args[1].type).toBe('text/plain')
  return blobText(args[1])
}

beforeEach(() => {
  window.sessionStorage.clear()
  resetSessionStateForTesting()
  resetCaptureForTesting()
  resetAgentCountersForTesting()
  document.body.innerHTML = ''
  for (const tag of Array.from(document.head.querySelectorAll('script[data-collector]'))) tag.remove()
})

afterEach(() => {
  stopAgent()
  jest.useRealTimers()
  Reflect.deleteProperty(navigator, 'sendBeacon')
  Reflect.deleteProperty(document, 'visibilityState')
  Reflect.deleteProperty(document, 'currentScript')
  restoreCrypto()
  removeFetch()
})

describe('configuration', () => {
  it('picks the collector URL up from the [data-collector] script tag', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag('https://collector.example/v1/ingest')
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    expect(beaconMock.mock.calls[0]?.[0]).toBe('https://collector.example/v1/ingest')
    expect(parseBeacon(await sentBody(beaconMock)).ok).toBe(true)
  })

  it('stays inert without a data-collector tag (module import already survived one)', () => {
    const beaconMock = mockSendBeacon()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    expect(getPendingObservationCount()).toBe(0)
    expect(beaconMock).not.toHaveBeenCalled()
  })
})

describe('idle processing', () => {
  it('converts queued captures to observations on the setTimeout fallback (no requestIdleCallback in jsdom)', () => {
    jest.useFakeTimers()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    expect(getPendingObservationCount()).toBe(0)
    jest.advanceTimersByTime(200)
    expect(getPendingObservationCount()).toBe(1)
  })

  it('produces schema-shaped observations and never duplicates them', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    processPendingCaptures() // dedupe check: a second pass adds nothing
    expect(getPendingObservationCount()).toBe(1)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    expect(parsed.beacon.v).toBe(1)
    expect(parsed.beacon.session.agentVersion).toBe(AGENT_VERSION)
    expect(parsed.beacon.page.url).toBe(location.origin + location.pathname)
    // The flushed script plus the per-flush-cycle agent-health observation.
    expect(parsed.beacon.observations).toHaveLength(2)
    expect(parsed.beacon.observations[1]?.kind).toBe('agent-health')
    const observation = parsed.beacon.observations[0] as ExternalScriptObservation
    expect(observation.kind).toBe('external-script')
    expect(observation.url).toBe('http://localhost/vendor.js')
    expect(observation.initiator).toBe(location.href)
    expect(observation.route).toBe('/')
  })

  it('drops captures whose URL exceeds the schema cap and counts them', () => {
    installCollectorTag()
    initAgent()
    insertScript(`http://localhost/${'a'.repeat(3000)}.js`)
    processPendingCaptures()
    expect(getPendingObservationCount()).toBe(0)
    expect(getOversizeDroppedCount()).toBe(1)
  })
})

describe('inline scripts', () => {
  const SOURCE = "window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');"

  it('fingerprints, hashes and ships an inline script end-to-end through the real schema', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    appendInline(SOURCE)
    await processInlineCaptures()
    expect(getPendingObservationCount()).toBe(1)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const observation = parsed.beacon.observations[0] as InlineScriptObservation
    expect(observation.kind).toBe('inline-script')
    // Pinned to the shared fixture (test/fixtures/beacons/inline-valid.json).
    expect(observation.hash).toBe('e6fd3e32432da11443aadf6bd83d5464588956cec02521e635d56f11f7bfcffb')
    expect(observation.length).toBe(139)
    expect(observation.head).toHaveLength(128)
    expect(observation.tail).toHaveLength(128)
    expect(SOURCE.startsWith(observation.head)).toBe(true)
    expect(SOURCE.endsWith(observation.tail)).toBe(true)
    expect(observation.oversize).toBeUndefined()
    expect(observation.initiator).toBe(location.href)
    expect(observation.route).toBe('/')
  })

  it('dedupes the same script within a session and hashes it exactly once', async () => {
    installWebCrypto()
    const digestSpy = jest.spyOn(webcrypto.subtle, 'digest')
    try {
      installCollectorTag()
      initAgent()
      appendInline('window.__dup = 1')
      appendInline('window.__dup = 1') // second element, identical content
      await processInlineCaptures()
      appendInline('window.__dup = 1') // later capture round, same session
      await processInlineCaptures()
      expect(getPendingObservationCount()).toBe(1)
      expect(digestSpy).toHaveBeenCalledTimes(1)
    } finally {
      digestSpy.mockRestore()
    }
  })

  it('emits BOTH of two distinct scripts that share length+first64+last64 but differ mid-body (dedupe must not be coarser than the wire identity)', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    // Same length, identical first 64 and last 64 chars, differing only in
    // the middle — wrapped in a comment so both are valid JS for jsdom to
    // execute. Each has a distinct source, so each is hashed and emitted.
    const build = (mid: string): string => `/* ${'a'.repeat(80)} ${mid} ${'z'.repeat(80)} */`
    const scriptA = build('AAAA')
    const scriptB = build('BBBB')
    expect(scriptA).toHaveLength(scriptB.length)
    expect(scriptA.slice(0, 64)).toBe(scriptB.slice(0, 64))
    expect(scriptA.slice(-64)).toBe(scriptB.slice(-64))
    appendInline(scriptA)
    appendInline(scriptB)
    await processInlineCaptures()
    // Distinct sources → distinct SHA-256s → distinct collector keys, so both
    // survive; the dedupe must never be coarser than that wire identity.
    expect(getPendingObservationCount()).toBe(2)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    if (!parsed.ok) throw new Error(parsed.detail)
    const inline = parsed.beacon.observations.filter((observation): observation is InlineScriptObservation => observation.kind === 'inline-script')
    expect(inline).toHaveLength(2)
    expect(new Set(inline.map((observation) => observation.head)).size).toBe(2)
  })

  it('emits BOTH of two distinct scripts that share length+head+tail (128-char windows) but differ beyond them (distinct SHA → distinct collector keys)', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    // Same length, identical first 128 and last 128 chars (so BOTH the cheap
    // fingerprint AND the wire fallback identity collide), differing only in
    // the middle. The hashes differ, so the collector keys them apart on
    // `inline:{hash}` — the agent must not dedupe more coarsely than that.
    const build = (mid: string): string => `/*${'a'.repeat(200)}${mid}${'z'.repeat(200)}*/`
    const scriptA = build('AAAA')
    const scriptB = build('BBBB')
    expect(scriptA).toHaveLength(scriptB.length)
    expect(scriptA.slice(0, 128)).toBe(scriptB.slice(0, 128))
    expect(scriptA.slice(-128)).toBe(scriptB.slice(-128))
    appendInline(scriptA)
    appendInline(scriptB)
    await processInlineCaptures()
    // Before the fix `shaFresh && wireFresh` dropped scriptB (its wire key was
    // already reserved by scriptA); now the hash-present gate is on the SHA
    // alone, so both survive.
    expect(getPendingObservationCount()).toBe(2)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    if (!parsed.ok) throw new Error(parsed.detail)
    const inline = parsed.beacon.observations.filter((observation): observation is InlineScriptObservation => observation.kind === 'inline-script')
    expect(inline).toHaveLength(2)
    expect(new Set(inline.map((observation) => observation.hash)).size).toBe(2)
  })

  it('emits a byte-identical inline duplicate (same SHA) exactly once', async () => {
    installWebCrypto()
    installCollectorTag()
    initAgent()
    const source = `/*${'a'.repeat(200)}SAME${'z'.repeat(200)}*/`
    appendInline(source)
    appendInline(source)
    await processInlineCaptures()
    expect(getPendingObservationCount()).toBe(1)
    hidePage()
  })

  it('dedupes two hash-absent captures that collide on the wire fallback identity', async () => {
    // No web crypto installed: both captures ship hash-absent and are gated on
    // the length/head/tail fallback identity — the collector cannot tell them
    // apart, so the agent must not emit both.
    expect((globalThis.crypto as Crypto | undefined)?.subtle).toBeUndefined()
    installCollectorTag()
    initAgent()
    const source = 'window.__collide = 1'
    appendInline(source)
    appendInline(source)
    await processInlineCaptures()
    expect(getPendingObservationCount()).toBe(1)
    hidePage()
  })

  it('re-captures a known script injected by a NEW initiator (supply-chain signal)', async () => {
    installWebCrypto()
    installCollectorTag()
    initAgent()
    appendInline('window.__shared = 1')
    const injector = document.createElement('script')
    injector.src = 'https://evil.example/injector.js'
    setCurrentScript(injector)
    appendInline('window.__shared = 1')
    setCurrentScript(null)
    await processInlineCaptures()
    expect(getPendingObservationCount()).toBe(2)
    hidePage()
  })

  it('flags oversize content, skips hashing, and still ships the fingerprint', async () => {
    installWebCrypto()
    const digestSpy = jest.spyOn(webcrypto.subtle, 'digest')
    try {
      const beaconMock = mockSendBeacon()
      installCollectorTag()
      initAgent()
      // A single block comment: valid JS (jsdom executes appended inline
      // scripts) whose byte length exceeds the hashing ceiling.
      const oversizeSource = `/*${'a'.repeat(INLINE_HASH_CEILING_BYTES)}*/`
      appendInline(oversizeSource)
      await processInlineCaptures()
      expect(digestSpy).not.toHaveBeenCalled()
      hidePage()
      const parsed = parseBeacon(await sentBody(beaconMock))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.detail)
      const observation = parsed.beacon.observations[0] as InlineScriptObservation
      expect(observation.oversize).toBe(true)
      expect(observation.hash).toBeUndefined()
      expect(observation.length).toBe(oversizeSource.length)
      expect(oversizeSource.startsWith(observation.head)).toBe(true)
      expect(oversizeSource.endsWith(observation.tail)).toBe(true)
    } finally {
      digestSpy.mockRestore()
    }
  })

  it('degrades to a hash-absent (un-flagged) observation when crypto.subtle is unavailable', async () => {
    // Pristine jsdom global: no SubtleCrypto.
    expect((globalThis.crypto as Crypto | undefined)?.subtle).toBeUndefined()
    installCollectorTag()
    initAgent()
    appendInline('window.__degraded = 1')
    await processInlineCaptures()
    expect(getPendingObservationCount()).toBe(1)
    const beaconMock = mockSendBeacon()
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const observation = parsed.beacon.observations[0] as InlineScriptObservation
    expect(observation.hash).toBeUndefined()
    expect(observation.oversize).toBeUndefined() // only the ceiling sets the flag
    expect(observation.head).toBe('window.__degraded = 1')
    expect(observation.tail).toBe('window.__degraded = 1')
  })

  it('converts queued inline captures on the idle fallback scheduler too', async () => {
    jest.useFakeTimers()
    installCollectorTag()
    initAgent()
    appendInline('window.__idle = 1')
    expect(getPendingObservationCount()).toBe(0)
    jest.advanceTimersByTime(200)
    jest.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPendingObservationCount()).toBe(1)
  })

  it('flushes still-queued inline captures at session end hash-absent rather than losing them', async () => {
    installWebCrypto() // hashing IS available — the flush path just cannot await it
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    appendInline('window.__tail = 1')
    hidePage() // no processInlineCaptures round before the hide
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const observation = parsed.beacon.observations[0] as InlineScriptObservation
    expect(observation.kind).toBe('inline-script')
    expect(observation.hash).toBeUndefined()
    expect(observation.head).toBe('window.__tail = 1')
  })

  it('round-trips mixed external + inline observations through the 24-observation split', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    for (let i = 0; i < 20; i += 1) insertScript(`/mixed-${i}.js`)
    for (let i = 0; i < 10; i += 1) appendInline(`window.__mixed${i} = ${i}`)
    processPendingCaptures()
    await processInlineCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    const first = parseBeacon(await sentBody(beaconMock, 0))
    const second = parseBeacon(await sentBody(beaconMock, 1))
    if (!first.ok || !second.ok) throw new Error('beacon failed schema validation')
    expect(first.beacon.observations).toHaveLength(24)
    // 6 remaining scripts + the per-flush-cycle agent-health observation.
    expect(second.beacon.observations).toHaveLength(7)
    const all = [...first.beacon.observations, ...second.beacon.observations]
    expect(all.filter((observation) => observation.kind === 'external-script')).toHaveLength(20)
    expect(all.filter((observation) => observation.kind === 'agent-health')).toHaveLength(1)
    const inline = all.filter((observation): observation is InlineScriptObservation => observation.kind === 'inline-script')
    expect(inline).toHaveLength(10)
    for (const observation of inline) expect(observation.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('flush and splitting', () => {
  it('sends nothing when there are no observations', () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    hidePage()
    expect(beaconMock).not.toHaveBeenCalled()
  })

  it('splits at 24 observations per beacon', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    for (let i = 0; i < 30; i += 1) insertScript(`/bulk-${i}.js`)
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    const first = parseBeacon(await sentBody(beaconMock, 0))
    const second = parseBeacon(await sentBody(beaconMock, 1))
    if (!first.ok || !second.ok) throw new Error('beacon failed schema validation')
    expect(first.beacon.observations).toHaveLength(24)
    // 6 remaining scripts + the per-flush-cycle agent-health observation.
    expect(second.beacon.observations).toHaveLength(7)
    expect(getPendingObservationCount()).toBe(0)
  })

  it('re-splits when a serialised beacon would exceed the byte cap', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    // 24 script observations with ~2000-char URLs serialise to ~49 KB — over
    // the 32 KB cap — so the flush must halve the first chunk to 12; the
    // remaining 12 scripts plus the appended agent-health observation fit in
    // the second beacon.
    for (let i = 0; i < 24; i += 1) insertScript(`https://cdn.example.com/${'a'.repeat(1950)}-${i}.js`)
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      const body = await sentBody(beaconMock, call)
      expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_BEACON_BYTES)
      const parsed = parseBeacon(body)
      if (!parsed.ok) throw new Error(parsed.detail)
      expect(parsed.beacon.observations.filter((observation) => observation.kind === 'external-script')).toHaveLength(12)
    }
  })

  it('drops (and counts) a single observation that alone exceeds the byte cap', () => {
    const oversize: ExternalScriptObservation = {
      kind: 'external-script',
      ts: Date.now(),
      route: '/',
      url: `https://example.com/${'a'.repeat(40000)}.js`,
    }
    const normal: ExternalScriptObservation = {
      kind: 'external-script',
      ts: Date.now(),
      route: '/',
      url: 'https://example.com/ok.js',
    }
    const { chunks, droppedOversize } = splitObservations([oversize, normal], (chunk) => JSON.stringify(chunk))
    expect(droppedOversize).toBe(1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.observations).toEqual([normal])
  })

  it('strips query and fragment from page.url so a pathological query cannot invalidate the beacon (privacy + beacon validity)', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    // A query long enough that location.href alone would blow the schema's
    // 2048-char URL cap and get the whole beacon rejected — plus PII-shaped
    // parameters that must never reach the archive.
    history.replaceState(null, '', `/checkout?order=12345&token=${'a'.repeat(3000)}#fragment`)
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()

    expect(beaconMock).toHaveBeenCalledTimes(1)
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    expect(parsed.beacon.page.url).toBe(`${location.origin}/checkout`)
    expect(parsed.beacon.page.url).not.toContain('?')
    expect(parsed.beacon.page.url).not.toContain('#')
    expect(parsed.beacon.page.url.length).toBeLessThanOrEqual(2048)

    history.replaceState(null, '', '/')
  })

  it('flushes on pagehide as well', () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    window.dispatchEvent(new Event('pagehide'))
    expect(beaconMock).toHaveBeenCalledTimes(1)
  })
})

/** jsdom has no SecurityPolicyViolationEvent constructor; a plain Event carrying the same fields exercises the listener identically. */
function dispatchViolation(effectiveDirective: string, blockedURI: string): void {
  const event = new Event('securitypolicyviolation', { bubbles: true })
  Object.assign(event, { effectiveDirective, blockedURI })
  document.dispatchEvent(event)
}

/**
 * Removes performance.now for the duration of a test (the method lives on
 * Performance.prototype, so deleting the shadowing instance property
 * restores it). Returns the restore function.
 */
function disablePerformanceNow(): () => void {
  const perf = performance as unknown as Record<string, unknown>
  Object.defineProperty(perf, 'now', { configurable: true, writable: true, value: undefined })
  return () => {
    Reflect.deleteProperty(perf, 'now')
  }
}

describe('csp violations', () => {
  it('round-trips a captured violation through the real beacon schema', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    dispatchViolation('script-src', 'https://evil.example/skimmer.js')
    processPendingCaptures()
    expect(getPendingObservationCount()).toBe(1)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const observation = parsed.beacon.observations[0] as CspViolationObservation
    expect(observation.kind).toBe('csp-violation')
    expect(observation.directive).toBe('script-src')
    expect(observation.blockedUri).toBe('https://evil.example/skimmer.js')
    expect(observation.route).toBe('/')
  })

  it("ships non-URL blockedURI values ('inline') through the schema unchanged", async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    dispatchViolation('script-src', 'inline')
    processPendingCaptures()
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    expect((parsed.beacon.observations[0] as CspViolationObservation).blockedUri).toBe('inline')
  })

  it('a clamped violation still yields a schema-valid beacon', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    dispatchViolation('d'.repeat(500), `https://evil.example/${'a'.repeat(5000)}`)
    processPendingCaptures()
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const observation = parsed.beacon.observations[0] as CspViolationObservation
    expect(observation.directive).toHaveLength(128)
    expect(observation.blockedUri).toHaveLength(2048)
  })
})

describe('agent health', () => {
  function healthObservations(observations: readonly { kind: string }[]): AgentHealthObservation[] {
    return observations.filter((observation): observation is AgentHealthObservation => observation.kind === 'agent-health')
  }

  it('appends exactly one agent-health observation per flush cycle, with plausible values', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    processPendingCaptures() // several instrumented tasks feed the reservoir
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const health = healthObservations(parsed.beacon.observations)
    expect(health).toHaveLength(1)
    const observation = health[0] as AgentHealthObservation
    expect(observation.p95TaskMs).toBeGreaterThanOrEqual(0)
    expect(observation.p95TaskMs).toBeLessThan(10_000) // a plausible task span, not a timestamp
    expect(observation.dropped).toBe(0)
    expect(observation.route).toBe('/')
  })

  it('emits ONE health observation per flush cycle even when the flush splits across beacons', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    for (let i = 0; i < 30; i += 1) insertScript(`/health-${i}.js`)
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    const first = parseBeacon(await sentBody(beaconMock, 0))
    const second = parseBeacon(await sentBody(beaconMock, 1))
    if (!first.ok || !second.ok) throw new Error('beacon failed schema validation')
    expect(healthObservations([...first.beacon.observations, ...second.beacon.observations])).toHaveLength(1)
  })

  it('reports oversize drops in the health observation', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('/ok.js')
    insertScript(`http://localhost/${'a'.repeat(3000)}.js`) // dropped: URL over the schema cap
    processPendingCaptures()
    expect(getOversizeDroppedCount()).toBe(1)
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    const health = healthObservations(parsed.beacon.observations)
    expect(health).toHaveLength(1)
    expect((health[0] as AgentHealthObservation).dropped).toBe(1)
  })

  it('skips the health observation entirely when performance.now is unavailable (never lies)', async () => {
    const restore = disablePerformanceNow()
    try {
      const beaconMock = mockSendBeacon()
      installCollectorTag()
      initAgent()
      insertScript('/vendor.js')
      processPendingCaptures()
      hidePage()
      const parsed = parseBeacon(await sentBody(beaconMock))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.detail)
      expect(parsed.beacon.observations).toHaveLength(1)
      expect(healthObservations(parsed.beacon.observations)).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('does not re-pend the health observation when transport fails (a fresh one is appended next flush)', async () => {
    mockSendBeacon(false)
    removeFetch()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    // Only the script observation survives the failed flush.
    expect(getPendingObservationCount()).toBe(1)
    const workingBeacon = mockSendBeacon(true)
    flushObservations()
    const parsed = parseBeacon(await sentBody(workingBeacon))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.detail)
    expect(healthObservations(parsed.beacon.observations)).toHaveLength(1)
    expect(parsed.beacon.observations).toHaveLength(2)
  })
})

describe('transport', () => {
  it('falls back to keepalive fetch when sendBeacon is absent', () => {
    // jsdom has no navigator.sendBeacon by default — assert, then rely on it.
    expect(typeof navigator.sendBeacon).toBe('undefined')
    const fetchMock = mockFetch()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(COLLECTOR_URL)
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'content-type': 'text/plain' } })
    const parsed = parseBeacon(init.body as string)
    expect(parsed.ok).toBe(true)
    expect(getPendingObservationCount()).toBe(0)
  })

  it('falls back to keepalive fetch when sendBeacon refuses the payload', () => {
    const beaconMock = mockSendBeacon(false)
    const fetchMock = mockFetch()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getPendingObservationCount()).toBe(0)
  })

  it('keeps observations pending when no transport accepts them', () => {
    const beaconMock = mockSendBeacon(false)
    removeFetch()
    installCollectorTag()
    initAgent()
    insertScript('/vendor.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    // Failures leave pending intact for a later flush.
    expect(getPendingObservationCount()).toBe(1)
    // A later flush with working transport drains them.
    const workingBeacon = mockSendBeacon(true)
    flushObservations()
    expect(workingBeacon).toHaveBeenCalledTimes(1)
    expect(getPendingObservationCount()).toBe(0)
  })
})
