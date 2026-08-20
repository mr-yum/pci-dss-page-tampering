/**
 * External-script capture for the RUM agent (US1 scope: external scripts
 * only; inline-script fingerprinting arrives in a later task).
 *
 * Three complementary capture paths feed one queue:
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
 *    attribution is possible here, so `initiator` stays unset.
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

/**
 * Hard cap on unprocessed captures. Beyond it, captures are counted as
 * dropped rather than growing memory unboundedly — the agent must never
 * degrade the page it monitors (FR-003).
 */
const MAX_PENDING_CAPTURES = 500

const queue: ScriptCapture[] = []
let dropped = 0
let started = false
let insertionPatched = false
let mutationObserver: MutationObserver | null = null
let performanceObserver: { disconnect?: () => void } | null = null

/** Drains and returns all queued captures (consumed by the idle processor). */
export function drainCaptures(): ScriptCapture[] {
  return queue.splice(0, queue.length)
}

/**
 * Observations discarded under pressure (queue cap). Stub counter for the
 * agent-health observation; emission logic is a later task (T034).
 */
export function getDroppedCount(): number {
  return dropped
}

/** Dedupe key for a script URL regardless of who injected it. */
function urlKey(url: string): string {
  return `ext:${url}`
}

/**
 * Dedupe key for a script URL + initiator host — matches the novelty
 * identity (FR-009): a known script re-injected by a NEW initiator is a new
 * observation (supply-chain signal), so the host is part of the key.
 */
function urlWithInitiatorKey(url: string, initiator: string | undefined): string {
  let host = '-'
  if (initiator) {
    try {
      host = new URL(initiator).host || '-'
    } catch {
      host = '-'
    }
  }
  return `ext:${url}|${host}`
}

/**
 * Capacity check, taken BEFORE any dedupe key is marked seen: a capture
 * dropped at the cap must stay re-capturable once the queue drains —
 * marking first would permanently silence the observation for the session.
 */
function hasCapacity(): boolean {
  if (queue.length >= MAX_PENDING_CAPTURES) {
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
 * Capture from the insertion patch: the only attribution-capable path.
 * Called synchronously from the wrapped appendChild/insertBefore, where
 * `document.currentScript` is still the inserting script. Parser-inserted
 * scripts and inline inserters attribute to the document URL.
 */
function captureFromInsertion(script: HTMLScriptElement): void {
  const url = resolveSrc(script)
  if (!url) return
  const currentScript = document.currentScript
  const initiator = currentScript instanceof HTMLScriptElement && currentScript.src ? currentScript.src : location.href
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

function scanAddedNode(node: Node): void {
  if (node instanceof HTMLScriptElement) {
    const url = resolveSrc(node)
    // document.currentScript is null in observer microtasks — the document
    // URL is the honest fallback attribution here.
    if (url) captureFromSafetyNet(url, location.href)
    return
  }
  if (node instanceof Element) {
    // Index-based: NodeList is not iterable under this tsconfig (no
    // DOM.Iterable lib), and older engines agree.
    const scripts = node.querySelectorAll('script[src]')
    for (let i = 0; i < scripts.length; i += 1) {
      const script = scripts[i]
      if (!(script instanceof HTMLScriptElement)) continue
      const url = resolveSrc(script)
      if (url) captureFromSafetyNet(url, location.href)
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

/** Installs all three capture paths. Idempotent per module instance. */
export function startCapture(options: CaptureOptions = {}): void {
  if (started) return
  started = true
  patchInsertion()
  startMutationObserver()
  startPerformanceObserver(options.performanceObserver ?? (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined))
}

/**
 * Test-only reset: clears the queue and counters and disconnects observers.
 * The prototype patch stays installed (it is guarded and dedupe-safe).
 */
export function resetCaptureForTesting(): void {
  queue.length = 0
  dropped = 0
  started = false
  mutationObserver?.disconnect()
  mutationObserver = null
  performanceObserver?.disconnect?.()
  performanceObserver = null
}
