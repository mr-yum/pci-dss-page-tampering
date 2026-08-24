/**
 * Script capture for the RUM agent: external scripts (US1), inline scripts
 * (US2) and CSP violations (US4). Fingerprinting/hashing of inline sources
 * happens in the idle processor (`agent.ts`), never here.
 *
 * Three complementary capture paths feed the queues:
 *
 * 1. Insertion patch — `Node.prototype.appendChild`/`insertBefore` wrappers
 *    (call-through first, then observe). This is the only path that can
 *    attribute an initiator: at call time `document.currentScript` is still
 *    the script executing the insertion. Inside MutationObserver callbacks it
 *    is already null (they run as microtasks after the inserting script has
 *    finished), so a pure-observer design cannot attribute — hence the patch.
 * 2. MutationObserver (childList+subtree on the document element) — safety
 *    net for anything the patch misses (parser-inserted markup, innerHTML,
 *    Range/adjacent-HTML insertion). Initiator falls back to the document
 *    URL.
 * 3. PerformanceObserver (`type: 'resource'`, `buffered: true`) — safety net
 *    for script fetches with no DOM insertion we saw (e.g. scripts added
 *    before the agent ran, workers of type module are out of scope). No
 *    attribution is possible here, so `initiator` stays unset. External
 *    scripts only — an inline script never fetches.
 *
 * Inline scripts (no `src`, non-whitespace source) go to their own queue as
 * raw source references: callbacks must not pay for slicing or hashing
 * (FR-003), and the element-level WeakSet below keeps the patch and the
 * MutationObserver from enqueueing the same element twice. Whitespace-only
 * scripts are skipped — nothing meaningful was observed (the inventory
 * flow's degenerate-matcher case is a synthetic-side concern).
 *
 * All paths dedupe through the session's seen-set, so double capture is
 * harmless. Callbacks only capture and enqueue (FR-003): no encoding, no
 * network, no storage writes beyond the deferred dedupe persist.
 */

import { getRoute, hasSeen, markSeenIfNew } from './session.js'

/** A raw capture: the cheap facts recorded inside an observer callback. */
export interface ScriptCapture {
  /** Absolute URL of the external script. */
  url: string
  /** URL of the inserting script (or document) when attributable. */
  initiator?: string
  /** SPA route active at capture (pathname only). */
  route: string
  /** Capture timestamp, epoch ms. */
  ts: number
}

/** A raw CSP-violation capture, clamped to the beacon schema's field caps. */
export interface CspViolationCapture {
  /** The effective directive that was violated (≤ 128 chars). */
  directive: string
  /**
   * The blocked URI as the browser reported it (≤ 2048 chars). Not always a
   * URL: the CSP spec uses bare strings like `inline` and `eval` here — they
   * pass through verbatim.
   */
  blockedUri: string
  /** SPA route active at capture (pathname only). */
  route: string
  /** Capture timestamp, epoch ms. */
  ts: number
}

/** A raw inline-script capture: the source is kept by reference only. */
export interface InlineScriptCapture {
  /** The inline script's full source text (fingerprinted later, at idle). */
  source: string
  /** URL of the inserting script (or document) when attributable. */
  initiator?: string
  /** SPA route active at capture (pathname only). */
  route: string
  /** Capture timestamp, epoch ms. */
  ts: number
}

/**
 * Hard cap on unprocessed captures — external and inline COMBINED. Beyond
 * it, captures are counted as dropped rather than growing memory unboundedly
 * — the agent must never degrade the page it monitors (FR-003).
 */
const MAX_PENDING_CAPTURES = 500

/** Matches the beacon schema's `directive` cap (`src/types/beacon.ts`). */
const MAX_CSP_DIRECTIVE_CHARS = 128
/** Matches the beacon schema's `blockedUri` cap (`src/types/beacon.ts`). */
const MAX_CSP_BLOCKED_URI_CHARS = 2048

const queue: ScriptCapture[] = []
const inlineQueue: InlineScriptCapture[] = []
const cspQueue: CspViolationCapture[] = []
/**
 * Elements already enqueued as inline captures: the insertion patch and the
 * MutationObserver both see an appendChild-inserted script, and (unlike
 * external scripts) no cheap URL key exists at capture time to dedupe on.
 */
let capturedInlineElements = new WeakSet<HTMLScriptElement>()
let dropped = 0
let started = false
let insertionPatched = false
let mutationObserver: MutationObserver | null = null
let performanceObserver: { disconnect?: () => void } | null = null

/** Drains and returns all queued captures (consumed by the idle processor). */
export function drainCaptures(): ScriptCapture[] {
  return queue.splice(0, queue.length)
}

/** Drains and returns all queued inline captures (consumed at idle). */
export function drainInlineCaptures(): InlineScriptCapture[] {
  return inlineQueue.splice(0, inlineQueue.length)
}

/** Drains and returns all queued CSP-violation captures (consumed at idle). */
export function drainCspCaptures(): CspViolationCapture[] {
  return cspQueue.splice(0, cspQueue.length)
}

/**
 * Observations discarded under pressure (queue cap) — one input to the
 * agent-health observation's `dropped` count (`agent.ts` adds its own
 * oversize drops on top).
 */
export function getDroppedCount(): number {
  return dropped
}

/** Dedupe key for a script URL regardless of who injected it. */
function urlKey(url: string): string {
  return `ext:${url}`
}

/**
 * Host portion of an initiator URL, `-` when absent or unparseable —
 * mirrors the collector's novelty-key host derivation so agent-side dedupe
 * and server-side novelty agree on what counts as "the same initiator".
 */
export function initiatorHost(initiator: string | undefined): string {
  if (!initiator) return '-'
  try {
    return new URL(initiator).host || '-'
  } catch {
    return '-'
  }
}

/**
 * Dedupe key for a script URL + initiator host — matches the novelty
 * identity (FR-009): a known script re-injected by a NEW initiator is a new
 * observation (supply-chain signal), so the host is part of the key.
 */
function urlWithInitiatorKey(url: string, initiator: string | undefined): string {
  return `ext:${url}|${initiatorHost(initiator)}`
}

/**
 * Capacity check, taken BEFORE any dedupe key is marked seen: a capture
 * dropped at the cap must stay re-capturable once the queue drains —
 * marking first would permanently silence the observation for the session.
 */
function hasCapacity(): boolean {
  if (queue.length + inlineQueue.length + cspQueue.length >= MAX_PENDING_CAPTURES) {
    dropped += 1
    return false
  }
  return true
}

function enqueue(capture: ScriptCapture): void {
  queue.push(capture)
}

/** Resolves a script element's src to an absolute URL; null for inline. */
function resolveSrc(script: HTMLScriptElement): string | null {
  const attribute = script.getAttribute('src')
  if (!attribute) return null
  // The `src` property is already resolved against the document base.
  if (script.src) return script.src
  try {
    return new URL(attribute, document.baseURI).toString()
  } catch {
    return null
  }
}

/**
 * Enqueues an inline script's source for idle-time fingerprinting. The only
 * work done here is a non-whitespace probe (`/\S/` scans to the first real
 * character — no copies, no slicing) and the WeakSet/capacity bookkeeping;
 * everything expensive is deferred (FR-003).
 */
function captureInline(script: HTMLScriptElement, initiator: string): void {
  if (capturedInlineElements.has(script)) return
  const source = script.textContent ?? ''
  // Whitespace-only: nothing meaningful was observed.
  if (!/\S/.test(source)) return
  // Capacity before marking — a capture dropped at the cap must stay
  // re-capturable once the queue drains (same ordering as external capture).
  if (!hasCapacity()) return
  capturedInlineElements.add(script)
  inlineQueue.push({ source, initiator, route: getRoute(), ts: Date.now() })
}

/**
 * Capture from the insertion patch: the only attribution-capable path.
 * Called synchronously from the wrapped appendChild/insertBefore, where
 * `document.currentScript` is still the inserting script. Parser-inserted
 * scripts and inline inserters attribute to the document URL.
 */
function captureFromInsertion(script: HTMLScriptElement): void {
  const url = resolveSrc(script)
  const currentScript = document.currentScript
  const initiator = currentScript instanceof HTMLScriptElement && currentScript.src ? currentScript.src : location.href
  if (!url) {
    captureInline(script, initiator)
    return
  }
  if (hasSeen(urlWithInitiatorKey(url, initiator))) return
  // Capacity before marking: a capture dropped at the cap must not have its
  // dedupe keys burned, or the observation is lost for the whole session.
  if (!hasCapacity()) return
  markSeenIfNew(urlWithInitiatorKey(url, initiator))
  // Also mark the bare URL so the attribution-less safety nets stay silent.
  markSeenIfNew(urlKey(url))
  enqueue({ url, initiator, route: getRoute(), ts: Date.now() })
}

/**
 * Capture from a safety-net path (MutationObserver / PerformanceObserver).
 * Keyed on the bare URL: these paths carry no real attribution, so they add
 * no initiator signal and must not re-capture what the patch already saw.
 */
function captureFromSafetyNet(url: string, initiator: string | undefined): void {
  if (!url) return
  if (hasSeen(urlKey(url))) return
  // Capacity before marking — same reasoning as captureFromInsertion.
  if (!hasCapacity()) return
  markSeenIfNew(urlKey(url))
  markSeenIfNew(urlWithInitiatorKey(url, initiator))
  const capture: ScriptCapture = { url, route: getRoute(), ts: Date.now() }
  if (initiator) capture.initiator = initiator
  enqueue(capture)
}

function patchInsertion(): void {
  if (insertionPatched) return
  insertionPatched = true

  const originalAppendChild = Node.prototype.appendChild
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    const result = originalAppendChild.call(this, node) as T
    try {
      if (node instanceof HTMLScriptElement) captureFromInsertion(node)
    } catch {
      // Monitoring must never break the host page.
    }
    return result
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, reference: Node | null): T {
    const result = originalInsertBefore.call(this, node, reference) as T
    try {
      if (node instanceof HTMLScriptElement) captureFromInsertion(node)
    } catch {
      // Monitoring must never break the host page.
    }
    return result
  }
}

/**
 * Routes a script found by the MutationObserver. document.currentScript is
 * null in observer microtasks — the document URL is the honest fallback
 * attribution on this path, for external and inline scripts alike.
 */
function captureScriptFromSafetyNet(script: HTMLScriptElement): void {
  const url = resolveSrc(script)
  if (url) captureFromSafetyNet(url, location.href)
  else captureInline(script, location.href)
}

function scanAddedNode(node: Node): void {
  if (node instanceof HTMLScriptElement) {
    captureScriptFromSafetyNet(node)
    return
  }
  if (node instanceof Element) {
    // Index-based: NodeList is not iterable under this tsconfig (no
    // DOM.Iterable lib), and older engines agree.
    const scripts = node.querySelectorAll('script')
    for (let i = 0; i < scripts.length; i += 1) {
      const script = scripts[i]
      if (script instanceof HTMLScriptElement) captureScriptFromSafetyNet(script)
    }
  }
}

function startMutationObserver(): void {
  mutationObserver = new MutationObserver((records) => {
    try {
      for (const record of records) {
        const added = record.addedNodes
        for (let i = 0; i < added.length; i += 1) {
          const node = added[i]
          if (node) scanAddedNode(node)
        }
      }
    } catch {
      // Monitoring must never break the host page.
    }
  })
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
}

/**
 * CSP-violation listener (capture-and-enqueue only, FR-003). Fields are
 * clamped to the beacon schema's caps at capture — a clamped value still
 * ships (a truncated blocked URI beats a rejected beacon). Deduped per
 * session on directive + blockedUri through the session seen-set; the route
 * is triage context, never part of the dedupe identity (same philosophy as
 * script novelty). Capacity is checked BEFORE marking, so a violation
 * dropped at the queue cap stays re-capturable once the queue drains.
 */
function onSecurityPolicyViolation(event: Event): void {
  try {
    const violation = event as Partial<SecurityPolicyViolationEvent>
    if (typeof violation.effectiveDirective !== 'string' || violation.effectiveDirective === '') return
    const directive = violation.effectiveDirective.slice(0, MAX_CSP_DIRECTIVE_CHARS)
    // blockedURI is not always a URL: 'inline', 'eval' etc. pass through.
    const blockedUri = (typeof violation.blockedURI === 'string' ? violation.blockedURI : '').slice(0, MAX_CSP_BLOCKED_URI_CHARS)
    const key = `csp:${directive}|${blockedUri}`
    if (hasSeen(key)) return
    if (!hasCapacity()) return
    markSeenIfNew(key)
    cspQueue.push({ directive, blockedUri, route: getRoute(), ts: Date.now() })
  } catch {
    // Monitoring must never break the host page.
  }
}

function startPerformanceObserver(Observer: typeof PerformanceObserver | undefined): void {
  if (!Observer) return
  try {
    const observer = new Observer((list) => {
      try {
        for (const entry of list.getEntries()) {
          if ((entry as PerformanceResourceTiming).initiatorType !== 'script') continue
          captureFromSafetyNet(entry.name, undefined)
        }
      } catch {
        // Monitoring must never break the host page.
      }
    })
    // buffered:true replays resource entries from before the agent started —
    // scripts in the initial HTML are captured even though no observer was
    // live when they loaded.
    observer.observe({ type: 'resource', buffered: true })
    performanceObserver = observer
  } catch {
    // Older engines without type/buffered support: the insertion patch and
    // MutationObserver still cover DOM-visible scripts.
  }
}

export interface CaptureOptions {
  /**
   * Injectable PerformanceObserver constructor (jsdom has none; tests stub
   * it). Defaults to the global when present.
   */
  performanceObserver?: typeof PerformanceObserver
}

/** Installs all capture paths (script insertion, safety nets, CSP events). Idempotent per module instance. */
export function startCapture(options: CaptureOptions = {}): void {
  if (started) return
  started = true
  patchInsertion()
  startMutationObserver()
  startPerformanceObserver(options.performanceObserver ?? (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined))
  // Document-level: securitypolicyviolation bubbles from the violating
  // element up to the document, so one listener sees page-wide violations.
  document.addEventListener('securitypolicyviolation', onSecurityPolicyViolation)
}

/**
 * Test-only reset: clears the queue and counters and disconnects observers.
 * The prototype patch stays installed (it is guarded and dedupe-safe).
 */
export function resetCaptureForTesting(): void {
  queue.length = 0
  inlineQueue.length = 0
  cspQueue.length = 0
  capturedInlineElements = new WeakSet()
  dropped = 0
  started = false
  mutationObserver?.disconnect()
  mutationObserver = null
  performanceObserver?.disconnect?.()
  performanceObserver = null
  // Removed so the next startCapture does not stack a second listener.
  document.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation)
}
