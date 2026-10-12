/**
 * jsdom unit tests for the RUM agent session layer: session id stability,
 * sessionStorage-backed dedupe (cap + degraded mode), and route tracking.
 */
import { DEVICE_SEEN_TTL_MS, getRoute, getSessionId, hasSeen, initRouteTracking, markDeviceReported, markSeenIfNew, MAX_DEVICE_SEEN_BYTES, persistSeen, resetSessionStateForTesting } from './session.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SEEN_KEY = '__rum.seen'
const SESSION_ID_KEY = '__rum.sid'

/** The unpatched replaceState, for simulating browser-driven URL changes. */
const rawReplaceState = History.prototype.replaceState

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  resetSessionStateForTesting()
  rawReplaceState.call(history, null, '', '/')
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('session id', () => {
  it('mints a UUID v4 and returns the same id on every call', () => {
    const first = getSessionId()
    expect(first).toMatch(UUID_V4)
    expect(getSessionId()).toBe(first)
  })

  it('survives a soft reload via sessionStorage', () => {
    const first = getSessionId()
    // Simulate a reload: in-memory state gone, sessionStorage intact.
    resetSessionStateForTesting()
    expect(getSessionId()).toBe(first)
    expect(window.sessionStorage.getItem(SESSION_ID_KEY)).toBe(first)
  })

  it('still mints a stable UUID-shaped id without throwing when the crypto global is absent', () => {
    const originalCrypto = Reflect.getOwnPropertyDescriptor(globalThis, 'crypto')
    // jsdom exposes crypto as a getter on the global; replace it with
    // undefined to model a crypto-less embedder.
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    try {
      const first = getSessionId()
      expect(first).toMatch(UUID_V4)
      expect(getSessionId()).toBe(first)
    } finally {
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
      else Reflect.deleteProperty(globalThis, 'crypto')
    }
  })

  it('stays stable in-memory when storage is disabled, without throwing', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const first = getSessionId()
    expect(first).toMatch(UUID_V4)
    expect(getSessionId()).toBe(first)
  })
})

describe('dedupe set', () => {
  it('marks a key once and reports it seen afterwards', () => {
    expect(hasSeen('ext:https://cdn.example.com/a.js')).toBe(false)
    expect(markSeenIfNew('ext:https://cdn.example.com/a.js')).toBe(true)
    expect(markSeenIfNew('ext:https://cdn.example.com/a.js')).toBe(false)
    expect(hasSeen('ext:https://cdn.example.com/a.js')).toBe(true)
  })

  it('persists marked keys to sessionStorage (deferred, and on demand)', () => {
    jest.useFakeTimers()
    markSeenIfNew('key-a')
    // Marking schedules a deferred persist rather than writing inline.
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBeNull()
    jest.runOnlyPendingTimers()
    expect(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]')).toContain('key-a')

    // A soft reload restores the persisted set.
    resetSessionStateForTesting()
    expect(hasSeen('key-a')).toBe(true)
  })

  it('caps the persisted set while keeping the in-memory mirror complete', () => {
    for (let i = 0; i < 2100; i += 1) markSeenIfNew(`key-${i}`)
    persistSeen()
    const persisted = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]
    expect(persisted).toHaveLength(2000)
    // In-memory keeps everything for this session.
    expect(hasSeen('key-2099')).toBe(true)
  })

  it('degrades to in-memory only when storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota')
    })
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(markSeenIfNew('key-a')).toBe(true)
    expect(hasSeen('key-a')).toBe(true)
    expect(() => persistSeen()).not.toThrow()
  })

  it('starts fresh when the persisted set is corrupted', () => {
    window.sessionStorage.setItem(SEEN_KEY, '{not json')
    expect(hasSeen('key-a')).toBe(false)
    expect(markSeenIfNew('key-a')).toBe(true)
  })
})

describe('route tracking', () => {
  it('updates the route on pushState and replaceState (call-through preserved)', () => {
    initRouteTracking()
    expect(getRoute()).toBe('/')
    history.pushState({}, '', '/menu')
    expect(getRoute()).toBe('/menu')
    expect(location.pathname).toBe('/menu')
    history.replaceState({}, '', '/checkout')
    expect(getRoute()).toBe('/checkout')
  })

  it('updates the route on popstate', () => {
    initRouteTracking()
    history.pushState({}, '', '/menu')
    // Simulate browser back: URL changes outside the patched methods, then
    // popstate fires.
    rawReplaceState.call(history, null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(getRoute()).toBe('/')
  })

  it('never includes query params in the route (PII stays out)', () => {
    initRouteTracking()
    history.pushState({}, '', '/checkout?email=jane%40example.com&table=12')
    expect(getRoute()).toBe('/checkout')
    expect(getRoute()).not.toContain('?')
    expect(getRoute()).not.toContain('email')
  })

  it('reads the pathname only for the initial route as well', () => {
    rawReplaceState.call(history, null, '', '/menu?promo=abc')
    resetSessionStateForTesting()
    expect(getRoute()).toBe('/menu')
  })
})

describe('device-long dedupe (localStorage)', () => {
  const DEVICE_SEEN_KEY = '__rum.seen.device'

  /** What the flush path does once a transport accepted a beacon carrying these keys. */
  const reported = (...keys: string[]): void => {
    markDeviceReported(keys)
    persistSeen()
  }

  /** A new browser session on the same device: sessionStorage gone, localStorage kept. */
  const newSessionSameDevice = (): void => {
    persistSeen()
    window.sessionStorage.clear()
    resetSessionStateForTesting()
  }

  it('withholds, in a later session, a key this device REPORTED — not one it merely captured', () => {
    expect(markSeenIfNew('ext:https://cdn.example.com/reported.js')).toBe(true)
    expect(markSeenIfNew('ext:https://cdn.example.com/lost.js')).toBe(true)
    reported('ext:https://cdn.example.com/reported.js') // lost.js's beacon never left the device
    newSessionSameDevice()
    expect(hasSeen('ext:https://cdn.example.com/reported.js')).toBe(true)
    expect(markSeenIfNew('ext:https://cdn.example.com/reported.js')).toBe(false)
    // The lost first sighting is re-reported next session, exactly as before the device set.
    expect(markSeenIfNew('ext:https://cdn.example.com/lost.js')).toBe(true)
    // A key the device never saw is new.
    expect(markSeenIfNew('ext:https://cdn.example.com/b.js')).toBe(true)
  })

  it('re-reports once the window has passed, and re-stamps for the next window', () => {
    const t0 = 1_760_000_000_000
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0)
    expect(markSeenIfNew('inline:abc')).toBe(true)
    reported('inline:abc')
    newSessionSameDevice()
    now.mockReturnValue(t0 + DEVICE_SEEN_TTL_MS - 1)
    expect(markSeenIfNew('inline:abc')).toBe(false)
    newSessionSameDevice()
    now.mockReturnValue(t0 + DEVICE_SEEN_TTL_MS)
    expect(markSeenIfNew('inline:abc')).toBe(true)
    reported('inline:abc')
    const stored = JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>
    expect(stored.find(([key]) => key === 'inline:abc')?.[1]).toBe(t0 + DEVICE_SEEN_TTL_MS)
  })

  it('treats a stamp later than now as expired — a forward clock or a planted value cannot suppress a key past the window', () => {
    const t0 = 1_760_000_000_000
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0)
    window.localStorage.setItem(
      DEVICE_SEEN_KEY,
      JSON.stringify([
        ['ext:skewed', t0 + 365 * 86_400_000],
        ['ext:planted', 1e15],
        ['ext:fresh', t0 - 1000],
      ]),
    )
    expect(hasSeen('ext:skewed')).toBe(false)
    expect(hasSeen('ext:planted')).toBe(false)
    expect(hasSeen('ext:fresh')).toBe(true)
    // Nor can such a stamp win the newest-first cap: it is gone on the next write.
    reported('ext:another')
    const stored = JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>
    expect(stored.map(([key]) => key).sort()).toEqual(['ext:another', 'ext:fresh'])
    // A clock corrected backwards after a legitimate stamp reads the same way: expired, re-reportable.
    reported('ext:now')
    now.mockReturnValue(t0 - 60_000)
    newSessionSameDevice()
    expect(markSeenIfNew('ext:now')).toBe(true)
  })

  it('ignores non-numeric and non-finite stamps', () => {
    window.localStorage.setItem(
      DEVICE_SEEN_KEY,
      JSON.stringify([
        ['a', 'yesterday'],
        ['b', null],
        ['c', Number.NaN],
        ['d', Date.now()],
      ]),
    )
    expect(hasSeen('a')).toBe(false)
    expect(hasSeen('b')).toBe(false)
    expect(hasSeen('c')).toBe(false)
    expect(hasSeen('d')).toBe(true)
  })

  it('drops expired entries on load so storage cannot grow without bound', () => {
    window.localStorage.setItem(
      DEVICE_SEEN_KEY,
      JSON.stringify([
        ['old', Date.now() - DEVICE_SEEN_TTL_MS - 1],
        ['fresh', Date.now()],
      ]),
    )
    expect(hasSeen('old')).toBe(false)
    expect(hasSeen('fresh')).toBe(true)
    reported('new')
    const stored = JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>
    expect(stored.map(([key]) => key).sort()).toEqual(['fresh', 'new'])
  })

  it('writes the device set only when a report changed it — session-set persists never touch localStorage', () => {
    window.localStorage.setItem(DEVICE_SEEN_KEY, '[["kept",' + String(Date.now()) + ']]')
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    try {
      markSeenIfNew('session-only')
      persistSeen()
      expect(setItem.mock.calls.map(([key]) => key)).not.toContain(DEVICE_SEEN_KEY)
      reported('reported')
      expect(setItem.mock.calls.map(([key]) => key)).toContain(DEVICE_SEEN_KEY)
    } finally {
      setItem.mockRestore()
    }
  })

  it('merges stamps another tab persisted since this document loaded, instead of overwriting them', () => {
    const t0 = 1_760_000_000_000
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0)
    reported('mine')
    // Another tab of the same origin reports a key and re-stamps one of ours, later.
    now.mockReturnValue(t0 + 5_000)
    window.localStorage.setItem(
      DEVICE_SEEN_KEY,
      JSON.stringify([
        ['theirs', t0 + 5_000],
        ['mine', t0 + 5_000],
      ]),
    )
    now.mockReturnValue(t0 + 10_000)
    reported('mine-too')
    const stored = Object.fromEntries(JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>)
    expect(stored).toEqual({ mine: t0 + 5_000, theirs: t0 + 5_000, 'mine-too': t0 + 10_000 })
  })

  it('caps persisted entries by count, keeping the most recently reported', () => {
    const t0 = 1_760_000_000_000
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0)
    for (let i = 0; i < 2100; i += 1) {
      now.mockReturnValue(t0 + i)
      markDeviceReported([`key-${i}`])
    }
    now.mockReturnValue(t0 + 2100)
    persistSeen()
    const stored = JSON.parse(window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]') as Array<[string, number]>
    expect(stored).toHaveLength(2000)
    expect(stored.map(([key]) => key)).toContain('key-2099')
    expect(stored.map(([key]) => key)).not.toContain('key-0')
  })

  it('caps persisted entries by bytes too, so a page of enormous keys cannot exhaust the host origin quota', () => {
    const t0 = 1_760_000_000_000
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0)
    for (let i = 0; i < 200; i += 1) {
      now.mockReturnValue(t0 + i)
      markDeviceReported([`ext:data:text/javascript,${'x'.repeat(2000)}#${i}`])
    }
    now.mockReturnValue(t0 + 200)
    persistSeen()
    const raw = window.localStorage.getItem(DEVICE_SEEN_KEY) ?? '[]'
    expect(raw.length).toBeLessThanOrEqual(MAX_DEVICE_SEEN_BYTES)
    const stored = JSON.parse(raw) as Array<[string, number]>
    expect(stored.length).toBeLessThan(200)
    expect(stored[0]?.[0].endsWith('#199')).toBe(true) // newest kept
  })

  it('ignores a corrupted persisted set and keeps working', () => {
    window.localStorage.setItem(DEVICE_SEEN_KEY, '{not json')
    expect(markSeenIfNew('key-a')).toBe(true)
    expect(hasSeen('key-a')).toBe(true)
  })

  it('degrades to the session set when localStorage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === DEVICE_SEEN_KEY) throw new Error('SecurityError')
      return null
    })
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === DEVICE_SEEN_KEY) throw new Error('QuotaExceededError')
    })
    try {
      expect(markSeenIfNew('key-a')).toBe(true)
      expect(markSeenIfNew('key-a')).toBe(false)
      reported('key-a')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('consults the device set before any mark in a session', () => {
    window.localStorage.setItem(DEVICE_SEEN_KEY, JSON.stringify([['ext:https://cdn.example.com/a.js', Date.now()]]))
    expect(hasSeen('ext:https://cdn.example.com/a.js')).toBe(true)
  })
})
