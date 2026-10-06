import { randomUUID } from 'crypto'

/**
 * Script-Insertion Attribution Shim
 *
 * Injected via `page.evaluateOnNewDocument` so it runs before any of the
 * page's own scripts. It patches the DOM insertion methods and, for every
 * `<script>` element inserted, records synchronously — while the inserting
 * code is still on the stack — who inserted it:
 *
 * - **initiator URL** (unchanged semantics, `InlineScriptSource.url`): the
 *   `src` of `document.currentScript` when that is an external script; the
 *   inserting inline script's own initiator URL when it is an inline script
 *   (inline-injects-inline propagates); otherwise `location.href`.
 * - **inserter identity** (for the initiator chain): when the inserter is an
 *   INLINE script, which inline script — by a per-element instance token —
 *   so the chain can pass through an inline bootstrap instead of collapsing
 *   to the page URL there. Every inline element gets a token, assigned at
 *   insertion or, for parser-inserted markup, the first time it is seen
 *   (as an inserter, or when the monitor reads the page).
 *
 * External script insertions are logged too (`insertions()`), so a script
 * whose network initiator is anonymous — the code that requested it was a
 * dynamically inserted inline script, whose V8 stack frames carry no URL —
 * can still be tied to the inline script that inserted its element.
 *
 * NOT tamper-proof, and nothing may rest on it as if it were. The shim runs
 * in the page's own JavaScript world: `document.currentScript` and
 * `HTMLScriptElement#src` are read through getters captured before any page
 * script ran, and the read API is a frozen, non-configurable `window`
 * property — but the records still pass through built-ins (`WeakMap`,
 * `Array.prototype.push`/`map`) that page code can override, `describe()`
 * lets any page code read every element's token, and an inline script can
 * rewrite its own text after it has run. So shim data is evidence a page
 * could forge. That is why an inline script never grants authorisation to
 * what it loads, why an inline load never inherits one, and why every load
 * grant must carry a `loadsMatching` guard on the loaded script's own URL
 * (see the transitive-trust section of AGENTS.md; `test/integration/
 * transitive-trust.test.ts` forges a record by overriding `WeakMap`). A page can also route around the patched methods (e.g. by
 * borrowing a pristine `appendChild` from a fresh iframe) — the element then
 * has no record, which every consumer treats as "no evidence".
 *
 * Known limitations:
 * - Async injections (setTimeout/Promise/postMessage chains) run with no
 *   `currentScript`; the inserter is recorded as `none` (the URL falls back to
 *   `location.href`, as before) and the chain records that hop as `unknown`.
 *   External scripts are not affected: their first hop comes from the CDP
 *   request initiator, which does follow async stacks.
 * - `document.write` and `innerHTML`-built markup are not seen as insertions
 *   (the latter does not execute; the former is parser-inserted), so such
 *   inline scripts read as parser-inserted — attributed to the document.
 * - Only the top-level document is read (`getInlineScriptsFromPage`); frames
 *   carry the shim but their inline scripts are not collected.
 */

/**
 * Pre-document shim string. Inject via `page.evaluateOnNewDocument`. The
 * IIFE is self-contained and idempotent — it short-circuits if it has
 * already run on this document.
 */
export const INLINE_SCRIPT_ATTRIBUTION_SCRIPT = `
(() => {
  if (window.__pciAttribution) return

  // Captured before any page script can redefine them.
  var currentScriptGetter = (function () {
    try { var d = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript'); return d && d.get } catch (e) { return undefined }
  })()
  var srcGetter = (function () {
    try { var d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src'); return d && d.get } catch (e) { return undefined }
  })()
  var Records = WeakMap
  var records = new Records()
  var insertionLog = []
  var MAX_LOG = 5000
  var prefix = Math.random().toString(36).slice(2, 8) || 'p'
  var counter = 0

  function hrefNow() {
    try { return location.href } catch (e) { return null }
  }
  function currentScript() {
    try { return currentScriptGetter ? currentScriptGetter.call(document) : document.currentScript } catch (e) { return null }
  }
  function srcOf(el) {
    try { return (srcGetter ? srcGetter.call(el) : el.src) || '' } catch (e) { return '' }
  }
  function isScript(node) {
    return !!node && node.nodeType === 1 && node.tagName === 'SCRIPT'
  }

  // A parser-inserted inline script is never passed to an insertion method;
  // it gets its record the first time it is seen.
  function recordOf(el) {
    var r = records.get(el)
    if (!r) {
      r = { token: prefix + '-' + (++counter), kind: 'parser', inserterToken: null, url: null }
      records.set(el, r)
    }
    return r
  }

  // Who is inserting right now. The URL keeps the long-standing semantics;
  // the inserter token is new.
  function inserterNow() {
    var cs = currentScript()
    if (!cs) return { kind: 'none', inserterToken: null, url: hrefNow() }
    var src = srcOf(cs)
    if (src) return { kind: 'script', inserterToken: null, url: src }
    var parent = recordOf(cs)
    return { kind: 'inline', inserterToken: parent.token, url: parent.kind === 'parser' ? hrefNow() : parent.url }
  }

  function record(el) {
    if (records.has(el)) return
    var who = inserterNow()
    var r = { token: prefix + '-' + (++counter), kind: who.kind, inserterToken: who.inserterToken, url: who.url }
    records.set(el, r)
    var src = srcOf(el)
    if (src && insertionLog.length < MAX_LOG) insertionLog.push({ token: r.token, src: src, kind: r.kind, inserterToken: r.inserterToken, url: r.url })
  }

  function tagIfScript(node) {
    // Elements, and DocumentFragments (nodeType 11): a fragment built from a
    // template or a parsed range carries script descendants no insertion
    // method ever saw, and inserting the fragment is what runs them.
    if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return
    if (isScript(node)) record(node)
    if (node.querySelectorAll) {
      var nested = node.querySelectorAll('script')
      for (var i = 0; i < nested.length; i++) record(nested[i])
    }
  }

  // insertedArgs: how many leading arguments are nodes being inserted (-1 =
  // all). Only those are recorded: insertBefore's reference node and
  // replaceChild's old child are already in the document, and recording one
  // that was never seen — typically the page's first parser-inserted
  // <script>, which the classic loader snippet passes as the reference —
  // would attribute it to whoever is inserting now.
  function wrap(proto, name, insertedArgs) {
    var orig = proto[name]
    if (typeof orig !== 'function') return
    proto[name] = function () {
      // Record each inserted node synchronously, before delegating, while the
      // inserting script is still document.currentScript.
      var n = insertedArgs < 0 ? arguments.length : Math.min(insertedArgs, arguments.length)
      for (var i = 0; i < n; i++) {
        var a = arguments[i]
        if (a && typeof a === 'object') tagIfScript(a)
      }
      return orig.apply(this, arguments)
    }
  }

  wrap(Node.prototype, 'appendChild', 1)
  wrap(Node.prototype, 'insertBefore', 1)
  wrap(Node.prototype, 'replaceChild', 1)
  wrap(Element.prototype, 'append', -1)
  wrap(Element.prototype, 'prepend', -1)
  wrap(Element.prototype, 'before', -1)
  wrap(Element.prototype, 'after', -1)
  wrap(Element.prototype, 'replaceWith', -1)

  var origInsertAdj = Element.prototype.insertAdjacentElement
  if (typeof origInsertAdj === 'function') {
    Element.prototype.insertAdjacentElement = function (pos, el) {
      tagIfScript(el)
      return origInsertAdj.call(this, pos, el)
    }
  }

  var api = Object.freeze({
    // One element's record, as plain data. A parser-inserted element reports
    // the document URL as its initiator, read now — as it always was.
    describe: function (el) {
      if (!isScript(el)) return null
      var r = recordOf(el)
      return { token: r.token, kind: r.kind, inserterToken: r.inserterToken, initiatorUrl: r.kind === 'parser' ? hrefNow() : r.url }
    },
    // Every script element inserted with a src, in insertion order, even if
    // it has since been removed from the DOM.
    insertions: function () {
      return insertionLog.map(function (e) { return { token: e.token, src: e.src, kind: e.kind, inserterToken: e.inserterToken, url: e.url } })
    },
  })
  try {
    Object.defineProperty(window, '__pciAttribution', { value: api, configurable: false, writable: false, enumerable: false })
  } catch (e) {
    // Already defined (should be impossible: this runs first) — leave it.
  }
})()
`

/**
 * A fresh `sourceURL` for one run's shim. Chrome reports the shim's wrapper as
 * the top frame of every request a DOM insertion triggers; naming the shim
 * lets `deriveInitiatorUrl` take that frame off (see `topCallFrameUrl` in
 * `src/handlers/script.ts`). Random per run so a page cannot predict it.
 */
export function newAttributionShimSourceUrl(): string {
  return `pci-attribution-${randomUUID()}.js`
}

/** The shim, named with `sourceUrl` so its stack frames can be recognised. */
export function attributionShimSource(sourceUrl: string): string {
  return `${INLINE_SCRIPT_ATTRIBUTION_SCRIPT}\n//# sourceURL=${sourceUrl}\n`
}

/** How the inserting code was identified when a script element was inserted. */
export type ScriptInserterKind =
  /** Inserted while an external script was `currentScript`. */
  | 'script'
  /** Inserted while an inline script was `currentScript`; `inserterToken` names it. */
  | 'inline'
  /** Inserted with no `currentScript` (async callback, event handler). */
  | 'none'
  /** Never seen inserted: part of the parsed markup (or `document.write`). */
  | 'parser'

/** `__pciAttribution.describe(el)` — what the shim recorded for one script element. */
export type ScriptElementRecord = {
  /** Per-element instance token, unique within the run. */
  token: string
  kind: ScriptInserterKind
  /** For `kind: 'inline'`, the token of the inline script that inserted this one. */
  inserterToken: string | null
  /** The long-standing initiator URL (see `InlineScriptSource.url`); null when unreadable. */
  initiatorUrl: string | null
}

/** `__pciAttribution.insertions()` — one script element inserted with a `src`. */
export type ScriptInsertionRecord = {
  token: string
  /** The element's resolved `src` at insertion time. */
  src: string
  kind: ScriptInserterKind
  inserterToken: string | null
  /** For `kind: 'script'`, the inserting script's URL. */
  url: string | null
}
