/**
 * jsdom unit tests for the agent entry: config pickup, idle processing,
 * beacon splitting, and transport (sendBeacon with fetch-keepalive fallback).
 *
 * The REAL beacon schema (Zod) is imported here to prove produced beacons
 * round-trip — importing it in tests is fine; the agent runtime itself only
 * ever imports types from it.
 */
import { type ExternalScriptObservation, parseBeacon } from '../../src/types/beacon.js'
import { AGENT_VERSION, flushObservations, getOversizeDroppedCount, getPendingObservationCount, initAgent, processPendingCaptures, resetAgentCountersForTesting, splitObservations, stopAgent } from './agent.js'
import { resetCaptureForTesting } from './capture.js'
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
    expect(parsed.beacon.observations).toHaveLength(1)
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
    expect(second.beacon.observations).toHaveLength(6)
    expect(getPendingObservationCount()).toBe(0)
  })

  it('re-splits when a serialised beacon would exceed the byte cap', async () => {
    const beaconMock = mockSendBeacon()
    installCollectorTag()
    initAgent()
    // 24 observations with ~2000-char URLs serialise to ~49 KB — over the
    // 32 KB cap — so the flush must halve to two 12-observation beacons.
    for (let i = 0; i < 24; i += 1) insertScript(`https://cdn.example.com/${'a'.repeat(1950)}-${i}.js`)
    processPendingCaptures()
    hidePage()
    expect(beaconMock).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      const body = await sentBody(beaconMock, call)
      expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_BEACON_BYTES)
      const parsed = parseBeacon(body)
      if (!parsed.ok) throw new Error(parsed.detail)
      expect(parsed.beacon.observations).toHaveLength(12)
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
