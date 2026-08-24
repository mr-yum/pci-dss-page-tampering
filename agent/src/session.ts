/**
 * Session-scoped state for the RUM agent: session identity, the
 * session-long observation dedupe set, and SPA route tracking.
 *
 * Everything here degrades gracefully — storage failures (quota, disabled,
 * private-mode restrictions) fall back to in-memory state and never throw
 * into the host page.
 */

/** sessionStorage keys are namespaced to avoid colliding with the host app. */
const SESSION_ID_KEY = '__rum.sid'
const SEEN_KEY = '__rum.seen'

/**
 * Cap on the persisted dedupe set so the agent's sessionStorage footprint is
 * bounded. The in-memory mirror keeps growing past the cap (memory for one
 * session is cheap); only persistence across soft reloads is capped.
 */
const MAX_PERSISTED_SEEN = 2000

/** Matches the beacon schema's `route` cap (`src/types/beacon.ts`). */
const MAX_ROUTE_LENGTH = 512

let cachedSessionId: string | null = null
let seen: Set<string> | null = null
let persistScheduled = false
let currentRoute: string | null = null
let routeTrackingInstalled = false

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    // Storage disabled or inaccessible — degrade to in-memory only.
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Quota exceeded or storage disabled — degrade to in-memory only.
  }
}

/** RFC 4122 v4 fallback for engines without `crypto.randomUUID`. */
function fallbackUuidV4(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    // Crypto-less engine: the session id is a random correlation handle, not
    // a security credential, so Math.random keeps the agent alive rather
    // than throwing into the host page.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The session id: minted once per browser session (crypto.randomUUID),
 * persisted in sessionStorage so it survives soft navigations and same-tab
 * reloads. Carries no user identity — it is random and session-scoped.
 */
export function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId
  const stored = storageGet(SESSION_ID_KEY)
  if (stored) {
    cachedSessionId = stored
    return stored
  }
  // Guarded access: `crypto` itself may be absent in older embedders; the
  // agent must mint a (non-crypto) id rather than throw into the host page.
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : fallbackUuidV4()
  cachedSessionId = id
  storageSet(SESSION_ID_KEY, id)
  return id
}

function loadSeen(): Set<string> {
  if (seen) return seen
  seen = new Set()
  const raw = storageGet(SEEN_KEY)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const key of parsed) {
          if (typeof key === 'string') seen.add(key)
        }
      }
    } catch {
      // Corrupted persisted set — start fresh rather than fail.
    }
  }
  return seen
}

/**
 * Persists the dedupe set (capped) to sessionStorage. Exposed so the flush
 * path can persist synchronously at page-hide; marking schedules a deferred
 * persist instead of writing inline, keeping observer callbacks cheap
 * (FR-003: capture-eagerly, persist-lazily).
 */
export function persistSeen(): void {
  if (!seen) return
  const keys: string[] = []
  for (const key of seen) {
    if (keys.length >= MAX_PERSISTED_SEEN) break
    keys.push(key)
  }
  storageSet(SEEN_KEY, JSON.stringify(keys))
}

function schedulePersist(): void {
  if (persistScheduled) return
  persistScheduled = true
  setTimeout(() => {
    persistScheduled = false
    persistSeen()
  }, 0)
}

/** True when the observation key was already seen this session. */
export function hasSeen(key: string): boolean {
  return loadSeen().has(key)
}

/**
 * Marks an observation key as seen. Returns true when the key was new —
 * callers capture only on true, making duplicate delivery across capture
 * paths harmless.
 */
export function markSeenIfNew(key: string): boolean {
  const set = loadSeen()
  if (set.has(key)) return false
  set.add(key)
  schedulePersist()
  return true
}

function updateRoute(): void {
  // Route is location.pathname ONLY — query strings routinely carry tokens,
  // order ids, and other PII, so they must never enter observations. The
  // route is triage context, never identity (spec clarification #1).
  currentRoute = location.pathname.slice(0, MAX_ROUTE_LENGTH)
}

/** The SPA route active right now (pathname only, never query params). */
export function getRoute(): string {
  if (currentRoute === null) updateRoute()
  return currentRoute ?? '/'
}

/**
 * Tracks History-API soft navigations: pushState/replaceState are wrapped
 * (call-through first, then update) and popstate is listened to, so
 * observations are stamped with the route active at capture (research R3).
 */
export function initRouteTracking(): void {
  if (routeTrackingInstalled) return
  routeTrackingInstalled = true
  updateRoute()
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method]
    history[method] = function (this: History, ...args: Parameters<History['pushState']>): void {
      original.apply(this, args)
      updateRoute()
    }
  }
  window.addEventListener('popstate', updateRoute)
}

/**
 * Test-only reset of module state. The history patch and popstate listener
 * stay installed (they are idempotent to re-init and harmless to leave).
 */
export function resetSessionStateForTesting(): void {
  cachedSessionId = null
  seen = null
  persistScheduled = false
  currentRoute = null
}
