/**
 * Inline-Script Attribution Shim
 *
 * Injected via `page.evaluateOnNewDocument` so it runs before any of the
 * page's own scripts. The shim tags every `<script>` element inserted into
 * the DOM with a non-enumerable `__pciInitiatorUrl` property that records the
 * URL of the script that initiated the insertion. `getInlineScriptsFromPage`
 * reads that tag later to attribute inline scripts to the script that
 * injected them (e.g. an inline `<script>` injected by `m.stripe.network`'s
 * loader is tagged with the loader's URL — the inventory can then refuse it
 * via `hostMatcher` / `urlMatcher` like any other Stripe-originated code).
 *
 * Attribution is synchronous: at insertion time `document.currentScript`
 * points at the executing script (browser-native). If that script has a
 * `src`, that URL is the initiator. If `currentScript` is itself a previously
 * tagged inline script (inline-injects-inline), we propagate the parent's
 * URL. Otherwise — top-level insertion before any script ran, or a parser
 * context — we fall back to `location.href`.
 *
 * Known limitations:
 * - Async injections (setTimeout/Promise/postMessage chains) lose the
 *   synchronous context and fall back to `location.href`. Acceptable for
 *   v1; upgrade with CDP async stacks if real-world miss rate is high.
 * - `innerHTML` / `outerHTML` setters are intentionally not patched because
 *   HTML5 specifies the resulting scripts do not execute.
 */

/**
 * Pre-document shim string. Inject via `page.evaluateOnNewDocument`. The
 * IIFE is self-contained and idempotent — it short-circuits if it has
 * already run on this document.
 */
export const INLINE_SCRIPT_ATTRIBUTION_SCRIPT = `
(() => {
  if (window.__pciAttributionInstalled) return
  window.__pciAttributionInstalled = true

  var ATTR = '__pciInitiatorUrl'

  function getInitiatorUrl() {
    try {
      var cs = document.currentScript
      if (cs) {
        if (cs.src) return cs.src
        if (cs[ATTR]) return cs[ATTR]
      }
      return location.href
    } catch (e) {
      return null
    }
  }

  function tagIfScript(node) {
    if (!node || node.nodeType !== 1) return
    if (node.tagName === 'SCRIPT' && !node[ATTR]) {
      var url = getInitiatorUrl()
      if (url) {
        try {
          Object.defineProperty(node, ATTR, { value: url, enumerable: false, configurable: true, writable: false })
        } catch (e) {
          // Some hosts seal the prototype — best effort.
          node[ATTR] = url
        }
      }
    }
    if (node.querySelectorAll) {
      // Fragment insertions can carry script descendants.
      var nested = node.querySelectorAll('script')
      for (var i = 0; i < nested.length; i++) {
        var s = nested[i]
        if (!s[ATTR]) {
          var u = getInitiatorUrl()
          if (u) {
            try {
              Object.defineProperty(s, ATTR, { value: u, enumerable: false, configurable: true, writable: false })
            } catch (e) {
              s[ATTR] = u
            }
          }
        }
      }
    }
  }

  function wrap(proto, name) {
    var orig = proto[name]
    if (typeof orig !== 'function') return
    proto[name] = function () {
      // Inspect each argument that could be a node; tag synchronously
      // before delegating so the original method still observes the tag.
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i]
        if (a && typeof a === 'object') tagIfScript(a)
      }
      return orig.apply(this, arguments)
    }
  }

  wrap(Node.prototype, 'appendChild')
  wrap(Node.prototype, 'insertBefore')
  wrap(Node.prototype, 'replaceChild')
  wrap(Element.prototype, 'append')
  wrap(Element.prototype, 'prepend')
  wrap(Element.prototype, 'before')
  wrap(Element.prototype, 'after')
  wrap(Element.prototype, 'replaceWith')

  var origInsertAdj = Element.prototype.insertAdjacentElement
  if (typeof origInsertAdj === 'function') {
    Element.prototype.insertAdjacentElement = function (pos, el) {
      tagIfScript(el)
      return origInsertAdj.call(this, pos, el)
    }
  }
})()
`
