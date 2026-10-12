/**
 * Session-scoped state for the RUM agent: session identity, the
 * session-long observation dedupe set, the device-long dedupe set that sits
 * behind it, and SPA route tracking.
 *
 * Everything here degrades gracefully — storage failures (quota, disabled,
 * private-mode restrictions) fall back to in-memory state and never throw
 * into the host page.
 */

/** Storage keys are namespaced to avoid colliding with the host app. */
const SESSION_ID_KEY = '__rum.sid'
const SEEN_KEY = '__rum.seen'
/** localStorage: the device-long set (see {@link DEVICE_SEEN_TTL_MS}). */
const DEVICE_SEEN_KEY = '__rum.seen.device'
/** sessionStorage: whether any beacon left this session (gates the heartbeat). */
const SENT_KEY = '__rum.sent'

/**
 * How long a device stays quiet about an observation it has already REPORTED.
 *
 * The session set alone makes writes scale with sessions × scripts; most of
 * those sessions are returning devices re-reporting the same unchanged scripts,
 * each costing the collector a DynamoDB write for a fact it already holds. The
 * device set remembers what this browser handed to transport and when, so an
 * unchanged observation is re-reported once every window, not once every
 * visit. Seven days keeps prevalence meaningful (`sessions` in the novelty
 * store reads as device-weeks) and bounds how long a device's silence can
 * last — well inside the collector's 90-day novelty window.
 *
 * Three properties the bound depends on, each pinned by a test:
 * - A key is stamped only when a beacon carrying it was accepted by a
 *   transport ({@link markDeviceReported}, called from the flush path) —
 *   never at capture. A first sighting whose beacon NO transport accepted is
 *   reported next session if it is seen again (pending observations do not
 *   outlive the document), exactly as before the device set existed. The
 *   agent can know no more than that: the collector answers every outcome
 *   with the same empty 204 (the no-oracle contract), so a beacon the browser
 *   queued and then lost in flight, or that the collector refused (edge-key
 *   skew during a rotation, an origin not yet in the origin map, schema skew)
 *   is stamped and withheld on that device for the window — a cost of the
 *   dedupe that operators avoid by sequencing those changes collector-first.
 * - Page code on the origin can plant live stamps, as it could already
 *   suppress or rewrite beacons outright; the device set adds persistence to
 *   that existing power, not a new one, and the clamp below bounds it to the
 *   window.
 * - A stamp later than `now` (a clock that was ahead and got corrected, or a
 *   value written by page code) is treated as expired, so no stamp can
 *   suppress a key for longer than the window.
 * - Persistence is capped by count and by bytes, newest first, so a page of
 *   enormous keys cannot blow the host origin's localStorage quota and take
 *   every legitimate stamp down with it.
 *
 * Key semantics are those of the session set: new content (inline hash), a
 * new initiator seen by the insertion patch, or a new script is a new key and
 * reports at once. The one nuance the session set already had: the
 * attribution-less safety nets gate on the bare URL key, which the insertion
 * patch also marks, so a known URL that later arrives via markup (no
 * initiator) is not re-reported — for the window, where it used to be for the
 * session.
 */
export const DEVICE_SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Caps on the persisted device set; newest stamps are kept first. */
const MAX_DEVICE_SEEN = 2000
export const MAX_DEVICE_SEEN_BYTES = 128 * 1024

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
/** key → epoch ms of the last report from this device. */
let deviceSeen: Map<string, number> | null = null
/** Set by {@link markDeviceReported}; the device set is written only when it changed. */
let deviceDirty = false
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

function deviceStorageGet(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_SEEN_KEY)
  } catch {
    // localStorage disabled or inaccessible — the device set is in-memory
    // only for this session (which the session set already covers).
    return null
  }
}

function deviceStorageSet(value: string): void {
  try {
    window.localStorage.setItem(DEVICE_SEEN_KEY, value)
  } catch {
    // Quota exceeded or storage disabled — degrade to in-memory only.
  }
}

/**
 * A stamp is live when it is a finite time no later than now and younger
 * than the window. "No later than now" is the clamp that keeps a forward
 * clock, or a planted value, from suppressing a key past the window.
 */
function stampIsLive(stamp: unknown, now: number): stamp is number {
  return typeof stamp === 'number' && Number.isFinite(stamp) && stamp <= now && now - stamp < DEVICE_SEEN_TTL_MS
}

/**
 * Loads the device set, dropping expired, future-dated and malformed entries
 * on the way in so a stale record can neither suppress a report nor outlive
 * the window in storage.
 */
function loadDeviceSeen(now: number): Map<string, number> {
  if (deviceSeen) return deviceSeen
  deviceSeen = new Map()
  const raw = deviceStorageGet()
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && stampIsLive(entry[1], now)) deviceSeen.set(entry[0], entry[1])
        }
      }
    } catch {
      // Corrupted persisted set — start fresh rather than fail.
    }
  }
  return deviceSeen
}

/** True when this device reported the key within the window. */
function deviceHasSeen(key: string, now: number): boolean {
  return stampIsLive(loadDeviceSeen(now).get(key), now)
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
 * Persists both dedupe sets (capped) — the session set to sessionStorage,
 * the device set to localStorage. Exposed so the flush path can persist
 * synchronously at page-hide; marking schedules a deferred persist instead
 * of writing inline, keeping observer callbacks cheap (FR-003:
 * capture-eagerly, persist-lazily).
 */
export function persistSeen(): void {
  if (seen) {
    const keys: string[] = []
    for (const key of seen) {
      if (keys.length >= MAX_PERSISTED_SEEN) break
      keys.push(key)
    }
    storageSet(SEEN_KEY, JSON.stringify(keys))
  }
  if (deviceSeen && deviceDirty) {
    deviceDirty = false
    const now = Date.now()
    // Another tab of this origin may have persisted stamps since this document
    // loaded its copy; a plain overwrite would erase them (last writer wins)
    // and the other tab's reports would repeat next session. Merge, keeping
    // the newer live stamp per key.
    try {
      const parsed: unknown = JSON.parse(deviceStorageGet() ?? '[]')
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && stampIsLive(entry[1], now) && entry[1] > (deviceSeen.get(entry[0]) ?? -Infinity)) deviceSeen.set(entry[0], entry[1])
        }
      }
    } catch {
      // Corrupted persisted set — keep this document's copy.
    }
    // Newest first, so both caps drop the entries least likely to matter. The
    // byte budget keeps one page of enormous keys from exhausting the host
    // origin's localStorage quota, which would silently lose every stamp.
    const entries: Array<[string, number]> = []
    let bytes = 2 // the enclosing "[]"
    for (const entry of [...deviceSeen].sort((a, b) => b[1] - a[1])) {
      if (entries.length >= MAX_DEVICE_SEEN) break
      const size = JSON.stringify(entry).length + 1
      if (bytes + size > MAX_DEVICE_SEEN_BYTES) break
      bytes += size
      entries.push(entry)
    }
    deviceStorageSet(JSON.stringify(entries))
  }
}

function schedulePersist(): void {
  if (persistScheduled) return
  persistScheduled = true
  setTimeout(() => {
    persistScheduled = false
    persistSeen()
  }, 0)
}

/**
 * True when the observation key was already seen this session, or reported
 * by this device within the {@link DEVICE_SEEN_TTL_MS} window.
 */
export function hasSeen(key: string): boolean {
  return loadSeen().has(key) || deviceHasSeen(key, Date.now())
}

/**
 * Marks an observation key as seen this session. Returns true when the key
 * was new to the session AND not reported by this device within the window —
 * callers capture only on true, making duplicate delivery across capture
 * paths harmless. The device set is NOT stamped here: that happens in
 * {@link markDeviceReported} once a beacon carrying the key was accepted by a
 * transport, so a lost first sighting is re-reported next session.
 */
export function markSeenIfNew(key: string): boolean {
  const set = loadSeen()
  if (set.has(key)) return false
  set.add(key)
  schedulePersist()
  return !deviceHasSeen(key, Date.now())
}

/**
 * Stamps keys as reported by this device, now. Called from the flush path
 * with the keys of the observations in a beacon a transport accepted — and
 * only those: an observation dropped before sending, or whose chunk no
 * transport took, is never stamped, so a first sighting the transport refused
 * is reported next session if seen again. The caller persists synchronously afterwards
 * (page-hide may not run a deferred timer).
 */
export function markDeviceReported(keys: Iterable<string>): void {
  const now = Date.now()
  const device = loadDeviceSeen(now)
  for (const key of keys) {
    device.set(key, now)
    deviceDirty = true
  }
}

let sentThisSession: boolean | null = null

/**
 * Whether any beacon left this session (persisted in sessionStorage so a
 * full-page navigation within the session does not reset it). Gates the
 * once-per-session heartbeat: per session, not per document, so a multi-page
 * checkout does not multiply accepted-beacon volume by its page count.
 */
export function hasSentThisSession(): boolean {
  if (sentThisSession === null) sentThisSession = storageGet(SENT_KEY) === '1'
  return sentThisSession
}

export function markSentThisSession(): void {
  sentThisSession = true
  storageSet(SENT_KEY, '1')
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
  deviceSeen = null
  deviceDirty = false
  sentThisSession = null
  persistScheduled = false
  currentRoute = null
}
