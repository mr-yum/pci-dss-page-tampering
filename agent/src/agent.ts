/**
 * RUM agent entry point.
 *
 * Wires the session layer and capture paths together, converts raw captures
 * into schema-shaped external-script, inline-script and csp-violation
 * observations during idle time (inline fingerprinting and SHA-256 hashing
 * happen HERE, never in observer callbacks), and flushes them to the
 * collector as beacons at session end (FR-003: observer callbacks only
 * capture; processing is deferred; transmission never blocks navigation).
 * Each flushing cycle also self-reports ONE agent-health observation with
 * the agent's own p95 task time and drop count (FR-003's second half).
 *
 * The agent runtime must stay dependency-free: types are imported from the
 * shared beacon schema module with `import type` only, so the Zod runtime is
 * never bundled into the page.
 */

import type { AgentHealthObservation, Beacon, CspViolationObservation, ExternalScriptObservation, InlineScriptObservation } from '../../src/types/beacon.js'
import { drainCaptures, drainCspCaptures, drainInlineCaptures, getDroppedCount, initiatorHost, type InlineScriptCapture, type ScriptCapture, startCapture } from './capture.js'
import { cheapInlineFingerprint, exceedsHashCeiling, fingerprintInline, hashInline, utf8ByteLength } from './fingerprint.js'
import { getRoute, getSessionId, initRouteTracking, markSeenIfNew, persistSeen } from './session.js'

/** The observation kinds this agent produces. */
type AgentObservation = ExternalScriptObservation | InlineScriptObservation | CspViolationObservation | AgentHealthObservation

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
  pending: AgentObservation[]
  /** Keys of EXTERNAL observations already pending/sent — the idle-processing dedupe check (inline dedupe rides the session seen-set instead). */
  pendingKeys: Set<string>
}

let state: AgentState | null = null

/**
 * Observations dropped because a single serialised observation exceeded the
 * beacon byte cap, or a capture's URL exceeded the schema's URL cap. Summed
 * with the capture layer's queue-cap drops into agent-health's `dropped`.
 */
let droppedOversize = 0

/**
 * Self-telemetry reservoir (FR-003: the agent measures its own overhead).
 * A bounded ring buffer of the most recent {@link MAX_HEALTH_SAMPLES}
 * main-thread task spans in ms (idle processing and flush conversion,
 * measured with performance.now). Kept unsorted — writes are O(1) in
 * observer-adjacent code paths; the one-off sort happens at emission time
 * over ≤ 200 numbers. When `performance.now` is unavailable no spans are
 * recorded and no agent-health observation is ever emitted: better silent
 * than lying.
 */
const MAX_HEALTH_SAMPLES = 200
const healthSamples: number[] = []
let healthOverwriteIndex = 0

function hasPerformanceNow(): boolean {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
}

/** Records one completed task span (duration since `startMs`). */
function recordTaskSpan(startMs: number): void {
  const duration = performance.now() - startMs
  if (healthSamples.length < MAX_HEALTH_SAMPLES) {
    healthSamples.push(duration)
    return
  }
  // Full: overwrite the oldest so the reservoir tracks recent behaviour.
  healthSamples[healthOverwriteIndex] = duration
  healthOverwriteIndex = (healthOverwriteIndex + 1) % MAX_HEALTH_SAMPLES
}

/** Nearest-rank p95 over the reservoir; 0 when no spans were recorded. */
function computeP95TaskMs(): number {
  if (healthSamples.length === 0) return 0
  const sorted = [...healthSamples].sort((a, b) => a - b)
  const value = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
  // Micro-precision floats bloat the beacon for no diagnostic value.
  return Math.round(value * 1000) / 1000
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
 * Idle-time processing: drains the external-script and CSP-violation capture
 * queues and converts captures into schema-shaped observations. The dedupe
 * check here guards the pending buffer itself (the session seen-set already
 * filters at capture time; CSP captures were deduped there and need no
 * second key). Self-timed as one task span for agent-health (FR-003).
 * Exported so tests can drive processing deterministically.
 */
export function processPendingCaptures(): void {
  if (!state) return
  const startedAt = hasPerformanceNow() ? performance.now() : null
  for (const capture of drainCaptures()) {
    const observation = toObservation(capture)
    if (!observation) continue
    const key = `${observation.url}|${observation.initiator ?? ''}`
    if (state.pendingKeys.has(key)) continue
    state.pendingKeys.add(key)
    state.pending.push(observation)
  }
  for (const capture of drainCspCaptures()) {
    state.pending.push({
      kind: 'csp-violation',
      ts: capture.ts,
      route: capture.route,
      directive: capture.directive,
      blockedUri: capture.blockedUri,
    })
  }
  if (startedAt !== null) recordTaskSpan(startedAt)
}

/**
 * Pre-hash reservation key: cheap fingerprint + initiator host. Reserves the
 * SHA-256 work so an inline script is hashed at most once per (cheap
 * fingerprint, initiator) per session. A collision here only skips a redundant
 * re-hash — it NEVER suppresses emission, which is decided by
 * {@link markInlineEmitted} on the true wire identity. Initiator is included
 * so a KNOWN script injected by a NEW initiator is re-hashed and re-emitted
 * (supply-chain signal), mirroring the collector's novelty identity.
 */
function inlineHashedKey(host: string, source: string): string {
  return `inl-hashed:${cheapInlineFingerprint(source)}|${host}`
}

/**
 * The wire fallback identity (length + 128-char head/tail + initiator), the
 * exact identity the collector keys on for a hash-absent inline observation
 * (`collector/src/novelty.ts`).
 */
function inlineWireKey(host: string, fp: { length: number; head: string; tail: string }): string {
  return `inl-wire:${fp.length}:${fp.head}:${fp.tail}|${host}`
}

/** The finest wire identity: the SHA-256 + initiator. */
function inlineHashKey(host: string, hash: string): string {
  return `inl-sha:${hash}|${host}`
}

/**
 * Gates whether this inline observation is emitted this session, on the TRUE
 * wire identity — never the coarser cheap fingerprint (which shares
 * length+prefix+suffix across distinct scripts and would drop a distinct
 * script before it was ever sent). Returns true when the observation is novel
 * and must be emitted.
 *
 * With a hash it gates on the SHA-256 (the finest identity) and also reserves
 * the fallback identity, so a later hash-absent capture of the same script is
 * suppressed too. Without a hash (degraded / oversize / a cheap-key collision
 * that skipped re-hashing) it gates on the fallback identity — matching what
 * the collector can distinguish.
 */
function markInlineEmitted(host: string, fp: { length: number; head: string; tail: string }, hash: string | undefined): boolean {
  if (hash !== undefined) {
    const shaFresh = markSeenIfNew(inlineHashKey(host, hash))
    const wireFresh = markSeenIfNew(inlineWireKey(host, fp))
    return shaFresh && wireFresh
  }
  return markSeenIfNew(inlineWireKey(host, fp))
}

/** Builds the wire observation from a capture and its (optional) hash. */
function toInlineObservation(capture: InlineScriptCapture, hash: string | undefined, oversize: boolean): InlineScriptObservation {
  const { length, head, tail } = fingerprintInline(capture.source)
  const observation: InlineScriptObservation = {
    kind: 'inline-script',
    ts: capture.ts,
    route: capture.route,
    length,
    head,
    tail,
  }
  if (hash) observation.hash = hash
  // `oversize` is set exactly when the 512 KB ceiling suppressed hashing —
  // a hash absent merely because crypto.subtle is unavailable stays unflagged.
  if (oversize) observation.oversize = true
  if (capture.initiator && capture.initiator.length <= MAX_URL_LENGTH) {
    observation.initiator = capture.initiator
  }
  return observation
}

/**
 * Idle-time inline processing. The CHEAP fingerprint reserves SHA-256 work
 * (hash at most once per cheap fingerprint per session); emission is then
 * gated on the TRUE wire identity by {@link markInlineEmitted}, so a distinct
 * script that merely shares length+prefix+suffix with an already-hashed one is
 * still emitted (hash-absent) rather than silently dropped. Async because
 * crypto.subtle is; exported so tests can await it deterministically.
 */
export async function processInlineCaptures(): Promise<void> {
  if (!state) return
  // The span covers fingerprinting AND awaited hashing: digest time is work
  // the agent caused, so it belongs in the overhead the agent reports.
  const startedAt = hasPerformanceNow() ? performance.now() : null
  for (const capture of drainInlineCaptures()) {
    const host = initiatorHost(capture.initiator)
    const fp = fingerprintInline(capture.source)
    const oversize = exceedsHashCeiling(capture.source)
    // Reserve the (expensive) hash at most once per cheap fingerprint; a
    // cheap-key collision only skips the re-hash, never the emission below.
    const mayHash = !oversize && markSeenIfNew(inlineHashedKey(host, capture.source))
    const hash = mayHash ? await hashInline(capture.source) : undefined
    if (!state) return
    if (!markInlineEmitted(host, fp, hash)) continue
    state.pending.push(toInlineObservation(capture, hash, oversize))
  }
  if (startedAt !== null) recordTaskSpan(startedAt)
}

/**
 * Synchronous inline conversion for the flush path: page-hide handlers
 * cannot await crypto.subtle, so captures still queued at session end are
 * shipped hash-absent (the collector's length+windows fallback identity
 * covers them — FR-004's degraded path) rather than lost. Only `oversize`
 * (a sync byte-length check) is still computed.
 */
function processInlineCapturesForFlush(): void {
  if (!state) return
  const startedAt = hasPerformanceNow() ? performance.now() : null
  for (const capture of drainInlineCaptures()) {
    // Sync path cannot hash: gate emission on the wire fallback identity
    // (length + 128-char head/tail), never the coarser cheap key, so a distinct
    // script is never dropped before it is sent.
    const host = initiatorHost(capture.initiator)
    const fp = fingerprintInline(capture.source)
    if (!markInlineEmitted(host, fp, undefined)) continue
    state.pending.push(toInlineObservation(capture, undefined, exceedsHashCeiling(capture.source)))
  }
  if (startedAt !== null) recordTaskSpan(startedAt)
}

function idleTick(): void {
  if (!state) return
  processPendingCaptures()
  // Fire-and-forget: hashing must never delay the next idle slot, and a
  // failing digest already degrades to hash-absent inside processInlineCaptures.
  void processInlineCaptures()
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

function serialiseBeacon(observations: AgentObservation[]): string {
  const beacon: Beacon = {
    v: 1,
    session: { id: getSessionId(), agentVersion: AGENT_VERSION },
    page: { url: pageUrl() },
    observations,
  }
  return JSON.stringify(beacon)
}

export interface SerialisedChunk {
  observations: AgentObservation[]
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
export function splitObservations(observations: readonly AgentObservation[], serialise: (chunk: AgentObservation[]) => string): { chunks: SerialisedChunk[]; droppedOversize: number } {
  const chunks: SerialisedChunk[] = []
  let dropped = 0
  let index = 0
  while (index < observations.length) {
    let size = Math.min(MAX_OBSERVATIONS_PER_BEACON, observations.length - index)
    let body: string | null = null
    let slice: AgentObservation[] = []
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
 * The per-flush-cycle agent-health observation (FR-003: the agent reports
 * its own overhead). Null when `performance.now` is unavailable — with no
 * timing source there are no spans, and a fabricated p95 would be a lie.
 * `dropped` sums queue-cap drops (capture layer) with oversize drops
 * (URL over the schema cap, single observation over the beacon byte cap).
 */
function buildHealthObservation(): AgentHealthObservation | null {
  if (!hasPerformanceNow()) return null
  return {
    kind: 'agent-health',
    ts: Date.now(),
    route: getRoute(),
    p95TaskMs: computeP95TaskMs(),
    dropped: getDroppedCount() + droppedOversize,
  }
}

/**
 * Flushes pending observations to the collector, splitting across beacons.
 * Called on visibilitychange→hidden and pagehide. Observations whose send
 * was not accepted stay pending for a later flush (e.g. the tab returning
 * to visible and hiding again).
 *
 * Each flush cycle that ships observations appends exactly ONE agent-health
 * observation (per cycle, not per beacon). It is never stored in `pending`:
 * on transport failure the health observation is discarded rather than
 * re-pended, so the next flush appends a single fresh one instead of
 * accumulating stale duplicates. Counters are cumulative per session —
 * a later health observation supersedes an earlier one.
 */
export function flushObservations(): void {
  if (!state) return
  // Convert any captures still sitting in the queues — session end must not
  // lose the tail of the session to idle scheduling.
  processPendingCaptures()
  processInlineCapturesForFlush()
  persistSeen()
  // No health-only beacons: a hide with nothing observed ships nothing.
  // (Drops always coexist with pending observations — the queue cap only
  // trips when converted captures are already waiting.)
  if (state.pending.length === 0) return
  const health = buildHealthObservation()
  const outgoing: AgentObservation[] = health ? [...state.pending, health] : state.pending
  const startedAt = hasPerformanceNow() ? performance.now() : null
  const { chunks, droppedOversize: dropped } = splitObservations(outgoing, serialiseBeacon)
  droppedOversize += dropped
  const unsent: AgentObservation[] = []
  let transportFailed = false
  for (const chunk of chunks) {
    if (transportFailed || !send(state.collectorUrl, chunk.body)) {
      transportFailed = true
      for (const observation of chunk.observations) {
        if (observation.kind !== 'agent-health') unsent.push(observation)
      }
    }
  }
  state.pending = unsent
  // Recorded after emission: this span feeds the NEXT health observation.
  if (startedAt !== null) recordTaskSpan(startedAt)
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

/** Oversize-drop counter (summed into agent-health's `dropped`). */
export function getOversizeDroppedCount(): number {
  return droppedOversize
}

/** Test-only counter/reservoir reset. */
export function resetAgentCountersForTesting(): void {
  droppedOversize = 0
  healthSamples.length = 0
  healthOverwriteIndex = 0
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
