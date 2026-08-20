/**
 * jsdom unit tests for the RUM agent session layer: session id stability,
 * sessionStorage-backed dedupe (cap + degraded mode), and route tracking.
 */
import { getRoute, getSessionId, hasSeen, initRouteTracking, markSeenIfNew, persistSeen, resetSessionStateForTesting } from './session.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SEEN_KEY = '__rum.seen'
const SESSION_ID_KEY = '__rum.sid'

/** The unpatched replaceState, for simulating browser-driven URL changes. */
const rawReplaceState = History.prototype.replaceState

beforeEach(() => {
  window.sessionStorage.clear()
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
