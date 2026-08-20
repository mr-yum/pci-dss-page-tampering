/**
 * RUM agent entry point.
 *
 * Wires the session layer and capture paths together, converts raw captures
 * into schema-shaped external-script observations during idle time, and
 * flushes them to the collector as beacons at session end (FR-003: observer
 * callbacks only capture; processing is deferred; transmission never blocks
 * navigation).
 *
 * The agent runtime must stay dependency-free: types are imported from the
 * shared beacon schema module with `import type` only, so the Zod runtime is
 * never bundled into the page.
 */

import type { Beacon, ExternalScriptObservation } from '../../src/types/beacon.js'
import { drainCaptures, type ScriptCapture, startCapture } from './capture.js'
import { getSessionId, initRouteTracking, persistSeen } from './session.js'

/**
 * Beacon caps, mirroring `src/types/beacon.ts` (MAX_BEACON_BYTES and the
 * observations array max). Redeclared as literals because importing the
 * values would pull the Zod schema module into the page bundle.
 */
const MAX_OBSERVATIONS_PER_BEACON = 24
const MAX_BEACON_BYTES = 32768

/** Matches the beacon schema's URL cap; longer URLs would invalidate the whole beacon. */
const MAX_URL_LENGTH = 2048

/** setTimeout fallback delay when requestIdleCallback is unavailable. */
const IDLE_FALLBACK_MS = 200

declare const __AGENT_VERSION__: string

/**
 * Injected at release build time (esbuild `--define:__AGENT_VERSION__`).
 * The default must satisfy the beacon schema's strict `\d+.\d+.\d+` semver
 * regex — a suffixed placeholder like "0.0.0-dev" would make every beacon
 * from an unversioned build fail collector validation.
 */
export const AGENT_VERSION = typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : '0.0.0'

interface AgentState {
  collectorUrl: string
  pending: ExternalScriptObservation[]
  /** Keys of observations already pending/sent — the idle-processing dedupe check. */
  pendingKeys: Set<string>
}

let state: AgentState | null = null

/**
 * Observations dropped because a single serialised observation exceeded the
 * beacon byte cap, or a capture's URL exceeded the schema's URL cap. Stub
 * counter for agent-health emission (T034).
 */
let droppedOversize = 0

/** UTF-8 byte length without TextEncoder (absent in some embedders/jsdom). */
function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: 4 bytes for the pair, skip the low surrogate.
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

function readCollectorUrl(): string | null {
  const current = document.currentScript
  const fromCurrent = current?.getAttribute('data-collector')
  if (fromCurrent) return fromCurrent
  // Fallback for deferred/module execution where currentScript is null.
  const tagged = document.querySelector('script[data-collector]')
  return tagged?.getAttribute('data-collector') || null
}

function scheduleIdle(task: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task)
  } else {
    setTimeout(task, IDLE_FALLBACK_MS)
  }
}

function toObservation(capture: ScriptCapture): ExternalScriptObservation | null {
  if (capture.url.length > MAX_URL_LENGTH) {
    // A single over-cap URL (e.g. a giant data: URI) would get the whole
    // beacon rejected by the collector's schema; drop it and count.
    droppedOversize += 1
    return null
  }
  const observation: ExternalScriptObservation = {
    kind: 'external-script',
    ts: capture.ts,
    route: capture.route,
    url: capture.url,
  }
  if (capture.initiator && capture.initiator.length <= MAX_URL_LENGTH) {
    observation.initiator = capture.initiator
  }
  return observation
}

/**
 * Idle-time processing: drains the capture queue and converts captures into
 * schema-shaped observations. The dedupe check here guards the pending
 * buffer itself (the session seen-set already filters at capture time).
 * Exported so tests can drive processing deterministically.
 */
export function processPendingCaptures(): void {
  if (!state) return
  for (const capture of drainCaptures()) {
    const observation = toObservation(capture)
    if (!observation) continue
    const key = `${observation.url}|${observation.initiator ?? ''}`
    if (state.pendingKeys.has(key)) continue
    state.pendingKeys.add(key)
    state.pending.push(observation)
  }
}

function idleTick(): void {
  if (!state) return
  processPendingCaptures()
  scheduleIdle(idleTick)
}

/**
 * The beacon's page URL: origin + pathname ONLY — query string and fragment
 * are stripped by design. Queries routinely carry tokens, order ids, and
 * other PII that must never reach the archive; and a pathological query
 * would push the field past the schema's 2048-char cap, invalidating the
 * whole beacon (silent loss). Clamped to the cap by truncating the pathname
 * tail as a last resort.
 */
function pageUrl(): string {
  const url = location.origin + location.pathname
  return url.length > MAX_URL_LENGTH ? url.slice(0, MAX_URL_LENGTH) : url
}

function serialiseBeacon(observations: ExternalScriptObservation[]): string {
  const beacon: Beacon = {
    v: 1,
    session: { id: getSessionId(), agentVersion: AGENT_VERSION },
    page: { url: pageUrl() },
    observations,
  }
  return JSON.stringify(beacon)
}

export interface SerialisedChunk {
  observations: ExternalScriptObservation[]
  body: string
}

/**
 * Splits observations into serialised beacon bodies: at most 24 observations
 * per beacon, and when a serialised candidate exceeds the 32 KB byte cap the
 * chunk is halved until it fits. A chunk of one observation that still
 * exceeds the cap is dropped and counted — never sent to certain rejection.
 *
 * Pure over its inputs (serialisation is injected) so the split semantics
 * are unit-testable without transport.
 */
export function splitObservations(observations: readonly ExternalScriptObservation[], serialise: (chunk: ExternalScriptObservation[]) => string): { chunks: SerialisedChunk[]; droppedOversize: number } {
  const chunks: SerialisedChunk[] = []
  let dropped = 0
  let index = 0
  while (index < observations.length) {
    let size = Math.min(MAX_OBSERVATIONS_PER_BEACON, observations.length - index)
    let body: string | null = null
    let slice: ExternalScriptObservation[] = []
    while (size >= 1) {
      slice = observations.slice(index, index + size)
      const candidate = serialise(slice)
      if (utf8ByteLength(candidate) <= MAX_BEACON_BYTES) {
        body = candidate
        break
      }
      if (size === 1) break
      size = Math.ceil(size / 2)
    }
    if (body === null) {
      dropped += 1
      index += 1
      continue
    }
    chunks.push({ observations: slice, body })
    index += size
  }
  return { chunks, droppedOversize: dropped }
}

/**
 * Sends one beacon body. Returns true when the payload was handed to the
 * browser for delivery. `text/plain` is CORS-safelisted, so no preflight.
 *
 * sendBeacon returning false (e.g. its in-flight byte budget is exhausted)
 * falls back to keepalive fetch, whose async outcome is unknowable at
 * page-hide — dispatch is treated as handoff. Only when no transport accepts
 * the payload does this return false, leaving observations pending for a
 * later flush.
 */
function send(url: string, body: string): boolean {
  try {
    if (typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return true
    }
  } catch {
    // Fall through to the fetch fallback.
  }
  try {
    if (typeof fetch === 'function') {
      void fetch(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'text/plain' },
        keepalive: true,
      }).catch(() => {
        // Fire-and-forget: a rejected keepalive fetch at page-hide is not
        // recoverable; the volume alarm catches systematic loss.
      })
      return true
    }
  } catch {
    // No usable transport.
  }
  return false
}

/**
 * Flushes pending observations to the collector, splitting across beacons.
 * Called on visibilitychange→hidden and pagehide. Observations whose send
 * was not accepted stay pending for a later flush (e.g. the tab returning
 * to visible and hiding again).
 */
export function flushObservations(): void {
  if (!state) return
  // Convert any captures still sitting in the queue — session end must not
  // lose the tail of the session to idle scheduling.
  processPendingCaptures()
  persistSeen()
  if (state.pending.length === 0) return
  const { chunks, droppedOversize: dropped } = splitObservations(state.pending, serialiseBeacon)
  droppedOversize += dropped
  const unsent: ExternalScriptObservation[] = []
  let transportFailed = false
  for (const chunk of chunks) {
    if (transportFailed || !send(state.collectorUrl, chunk.body)) {
      transportFailed = true
      unsent.push(...chunk.observations)
    }
  }
  state.pending = unsent
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushObservations()
}

function onPageHide(): void {
  flushObservations()
}

/**
 * Starts the agent. The collector endpoint is the agent's ONLY embedding
 * configuration (FR-005): the `data-collector` attribute on the agent's own
 * script tag. Without it the agent stays inert.
 */
export function initAgent(): void {
  if (state) return
  const collectorUrl = readCollectorUrl()
  if (!collectorUrl) return
  state = { collectorUrl, pending: [], pendingKeys: new Set() }
  getSessionId()
  initRouteTracking()
  startCapture()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  scheduleIdle(idleTick)
}

/** Stops the agent and detaches listeners. Test-only in production terms. */
export function stopAgent(): void {
  if (!state) return
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', onPageHide)
  state = null
}

/** Number of observations awaiting flush (test observability). */
export function getPendingObservationCount(): number {
  return state ? state.pending.length : 0
}

/** Oversize-drop stub counter (agent-health emission is T034). */
export function getOversizeDroppedCount(): number {
  return droppedOversize
}

/** Test-only counter reset. */
export function resetAgentCountersForTesting(): void {
  droppedOversize = 0
}

// Self-invoking guard: only start in a real browser context with a
// [data-collector] script tag present, and never throw out of module
// top-level — the agent must be safe to include on any page.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    if (document.currentScript?.getAttribute('data-collector') || document.querySelector('script[data-collector]')) {
      initAgent()
    }
  } catch {
    // A failing monitor must never take the page down with it.
  }
}
