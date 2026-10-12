/**
 * jsdom unit tests for the agent entry: config pickup, idle processing,
 * beacon splitting, and transport (sendBeacon with fetch-keepalive fallback).
 *
 * The REAL beacon schema (Zod) is imported here to prove produced beacons
 * round-trip — importing it in tests is fine; the agent runtime itself only
 * ever imports types from it.
 */
import { type AgentHealthObservation, type CspViolationObservation, type ExternalScriptObservation, type InlineScriptObservation, parseBeacon } from '../../src/types/beacon.js'
import {
  AGENT_VERSION,
  flushObservations,
  getOversizeDroppedCount,
  getPendingObservationCount,
  initAgent,
  inlineHashKey,
  inlineWireKey,
  observationKeys,
  processInlineCaptures,
  processPendingCaptures,
  resetAgentCountersForTesting,
  splitObservations,
  stopAgent,
} from './agent.js'
import { cspKey, initiatorHost, resetCaptureForTesting, urlKey, urlWithInitiatorKey } from './capture.js'
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
  window.localStorage.clear()
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
    expect(parsed.beacon.v).toBe(2)
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

  it('ships each script observation with its initiator chain through the real beacon schema', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    const loader = document.createElement('script')
    loader.src = 'https://js.vendor.example/loader.js'
    setCurrentScript(loader)
    insertScript('https://assets.vendor.example/fraud.js')
    appendInline('window.vendorReady = 1')
    processPendingCaptures()
    await processInlineCaptures()
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock))
    if (!parsed.ok) throw new Error(parsed.detail)
    const chains = parsed.beacon.observations.filter((observation) => observation.kind !== 'agent-health').map((observation) => ('initiatorChain' in observation ? observation.initiatorChain : undefined))
    const expected = [
      { url: 'https://js.vendor.example/loader.js', kind: 'script' },
      { url: 'http://localhost/', kind: 'unknown' },
    ]
    expect(chains).toEqual([expected, expected])
  })

  it('sheds an over-cap chain rather than drop the observation it rides on', () => {
    const hop = { url: `https://cdn.example.com/${'a'.repeat(2000)}`, kind: 'script' as const }
    const observation: ExternalScriptObservation = { kind: 'external-script', ts: 1, route: '/', url: 'https://example.com/ok.js', initiatorChain: Array.from({ length: 8 }, () => hop) }
    const { chunks, droppedOversize } = splitObservations([observation], (chunk) => JSON.stringify(chunk).padEnd(chunk.some((o) => 'initiatorChain' in o) ? 40_000 : 0))
    expect(droppedOversize).toBe(0)
    expect(chunks[0]?.observations).toEqual([{ kind: 'external-script', ts: 1, route: '/', url: 'https://example.com/ok.js' }])
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

  it('bounds the hash memo by retained bytes: an over-budget source re-hashes on repeat but never re-emits or double-holds memory', async () => {
    installWebCrypto()
    const digestSpy = jest.spyOn(webcrypto.subtle, 'digest')
    try {
      installCollectorTag()
      initAgent()
      // Three ~400KB sources (each under the 512KB hashing ceiling, so all
      // are hashed): the first two fit the 1MB memo byte budget, the third
      // would exceed it and must NOT be memoised.
      const big = (marker: string) => `window.__pad_${marker} = "${'x'.repeat(400 * 1024)}"; window.__m = '${marker}'`
      appendInline(big('a'))
      appendInline(big('b'))
      appendInline(big('c'))
      await processInlineCaptures()
      expect(getPendingObservationCount()).toBe(3)
      expect(digestSpy).toHaveBeenCalledTimes(3)

      // Repeats: a and b hit the memo (no new digest); c re-hashes because it
      // was never memoised — but its SHA still dedupes emission.
      appendInline(big('a'))
      appendInline(big('c'))
      await processInlineCaptures()
      expect(getPendingObservationCount()).toBe(3) // nothing re-emitted
      expect(digestSpy).toHaveBeenCalledTimes(4) // only c hashed again
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
  it('sends one health-only heartbeat per SESSION when there is nothing new — a later document in the same session sends nothing', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const parsed = parseBeacon(await sentBody(beaconMock))
    if (!parsed.ok) throw new Error(parsed.detail)
    expect(parsed.beacon.observations.map((observation) => observation.kind)).toEqual(['agent-health'])
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    // A full-page navigation within the session: new document, same sessionStorage.
    stopAgent()
    resetCaptureForTesting()
    resetAgentCountersForTesting()
    initAgent()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
  })

  it('does not add a heartbeat to a document that already shipped a beacon', () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('/a.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying the heartbeat until a transport accepts it', () => {
    const beaconMock = mockSendBeacon(false)
    removeFetch()
    installCollectorTag()
    initAgent()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    beaconMock.mockReturnValue(true)
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
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

describe('device-long dedupe is stamped at transport handoff', () => {
  const DEVICE_SEEN_KEY = '__rum.seen.device'
  const deviceKeys = (): string[] => (JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>).map(([key]) => key)

  /** The same device opens a new tab: in-memory and session state gone, localStorage kept. */
  const newSessionSameDevice = (): void => {
    stopAgent()
    window.sessionStorage.clear()
    resetSessionStateForTesting()
    resetCaptureForTesting()
    resetAgentCountersForTesting()
    initAgent()
  }

  it('stamps the keys of what a transport accepted, and withholds exactly those next session', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    insertScript('https://cdn.example.com/a.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    expect(deviceKeys()).toEqual(expect.arrayContaining([urlKey('https://cdn.example.com/a.js'), urlWithInitiatorKey('https://cdn.example.com/a.js', location.href)]))

    newSessionSameDevice()
    insertScript('https://cdn.example.com/a.js')
    insertScript('https://cdn.example.com/b.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    const parsed = parseBeacon(await sentBody(beaconMock, 1))
    if (!parsed.ok) throw new Error(parsed.detail)
    const urls = parsed.beacon.observations.flatMap((observation) => (observation.kind === 'external-script' ? [observation.url] : []))
    expect(urls).toEqual(['https://cdn.example.com/b.js'])
  })

  it('stamps nothing when no transport accepted the beacon, so a lost first sighting is re-reported next session', async () => {
    const beaconMock = mockSendBeacon(false)
    removeFetch()
    installCollectorTag()
    initAgent()
    insertScript('https://cdn.example.com/lost.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    expect(deviceKeys()).toEqual([])

    beaconMock.mockReturnValue(true)
    newSessionSameDevice()
    insertScript('https://cdn.example.com/lost.js')
    processPendingCaptures()
    hidePage()
    const parsed = parseBeacon(await sentBody(beaconMock, 1))
    if (!parsed.ok) throw new Error(parsed.detail)
    expect(parsed.beacon.observations.some((observation) => observation.kind === 'external-script' && observation.url === 'https://cdn.example.com/lost.js')).toBe(true)
  })

  it('maps every observation kind back to the keys the capture layer marked', () => {
    expect(observationKeys({ kind: 'external-script', ts: 1, route: '/', url: 'https://cdn.example.com/a.js', initiator: 'https://js.vendor.example/loader.js' })).toEqual([
      urlKey('https://cdn.example.com/a.js'),
      urlWithInitiatorKey('https://cdn.example.com/a.js', 'https://js.vendor.example/loader.js'),
    ])
    expect(observationKeys({ kind: 'csp-violation', ts: 1, route: '/', directive: 'script-src', blockedUri: 'https://evil.example/x.js' })).toEqual([cspKey('script-src', 'https://evil.example/x.js')])
    const host = initiatorHost('https://pay.example.com/checkout')
    expect(observationKeys({ kind: 'inline-script', ts: 1, route: '/', length: 3, head: 'x()', tail: 'x()', hash: 'a'.repeat(64), initiator: 'https://pay.example.com/checkout' })).toEqual([inlineHashKey(host, 'a'.repeat(64))])
    // An unhashed inline observation's wire key embeds plaintext source excerpts: never persisted.
    expect(observationKeys({ kind: 'inline-script', ts: 1, route: '/', length: 3, head: 'x()', tail: 'x()', initiator: 'https://pay.example.com/checkout' })).toEqual([])
    expect(inlineWireKey(host, { length: 3, head: 'x()', tail: 'x()' })).toContain('x()') // why: the excerpt is in the key
    expect(observationKeys({ kind: 'agent-health', ts: 1, route: '/', p95TaskMs: 1, dropped: 0 })).toEqual([])
  })

  it('stamps the keys the CAPTURE marked even when the wire shape dropped an over-long initiator', () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    const longInitiator = `https://js.vendor.example/${'l'.repeat(2100)}.js`
    const loader = document.createElement('script')
    loader.src = longInitiator
    setCurrentScript(loader)
    insertScript('https://cdn.example.com/sdk.js')
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    // The capture layer gates the insertion path on the host-qualified key built from the FULL initiator.
    expect(deviceKeys()).toEqual(expect.arrayContaining([urlKey('https://cdn.example.com/sdk.js'), urlWithInitiatorKey('https://cdn.example.com/sdk.js', longInitiator)]))
    expect(deviceKeys()).not.toContain(urlWithInitiatorKey('https://cdn.example.com/sdk.js', undefined))
  })

  it('never persists an unhashed inline observation to the device set, so a degraded client re-reports it next session', async () => {
    // No WebCrypto: hashing is unavailable, so the inline script ships hash-absent on the wire fallback.
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    appendInline('window.customerRef = "acct-4242"')
    await processInlineCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const first = parseBeacon(await sentBody(beaconMock, 0))
    if (!first.ok) throw new Error(first.detail)
    expect(first.beacon.observations.some((observation) => observation.kind === 'inline-script' && observation.hash === undefined)).toBe(true)
    expect(window.localStorage.getItem('__rum.seen.device') ?? '').not.toContain('acct-4242')
    expect(deviceKeys().some((key) => key.startsWith('inl-wire:'))).toBe(false)

    newSessionSameDevice()
    appendInline('window.customerRef = "acct-4242"')
    await processInlineCaptures()
    hidePage()
    const second = parseBeacon(await sentBody(beaconMock, 1))
    if (!second.ok) throw new Error(second.detail)
    expect(second.beacon.observations.some((observation) => observation.kind === 'inline-script')).toBe(true)
  })

  it('withholds an inline script and a CSP violation this device already reported, next session', async () => {
    installWebCrypto()
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    appendInline('window.vendorReady = 1')
    await processInlineCaptures()
    const violation = new Event('securitypolicyviolation')
    Object.assign(violation, { effectiveDirective: 'script-src', blockedURI: 'https://evil.example/x.js' })
    document.dispatchEvent(violation)
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const first = parseBeacon(await sentBody(beaconMock, 0))
    if (!first.ok) throw new Error(first.detail)
    expect(first.beacon.observations.map((observation) => observation.kind).sort()).toEqual(['agent-health', 'csp-violation', 'inline-script'])

    newSessionSameDevice()
    appendInline('window.vendorReady = 1')
    await processInlineCaptures()
    document.dispatchEvent(violation)
    processPendingCaptures()
    hidePage()
    // Only the per-session heartbeat leaves: the inline script and the violation were reported within the window.
    expect(beaconMock).toHaveBeenCalledTimes(2)
    const second = parseBeacon(await sentBody(beaconMock, 1))
    if (!second.ok) throw new Error(second.detail)
    expect(second.beacon.observations.map((observation) => observation.kind)).toEqual(['agent-health'])
  })
})
