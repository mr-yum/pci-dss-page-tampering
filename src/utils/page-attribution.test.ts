/**
 * @jest-environment jsdom
 */

/**
 * The attribution shim itself, evaluated in a DOM.
 *
 * The real-Chrome suites (`test/integration/transitive-trust.test.ts`) cover
 * the shapes a vendor loader actually uses; these cover the insertion paths
 * and timing cases those pages do not reach, against the shim string exactly
 * as it is injected. jsdom runs `<script>` elements inserted through the DOM
 * synchronously with `document.currentScript` set, which is all the shim
 * reads. Each case drives an inline script (the inserter) that inserts more
 * scripts, and reads back what the shim recorded through its public API.
 */

import { resolveInitiatorChains } from '../services/initiator-chain.js'
import type { ScriptInfo } from '../types/script.js'
import { INLINE_SCRIPT_ATTRIBUTION_SCRIPT, type ScriptElementRecord } from './page-attribution.js'

type Api = { describe(el: Element): ScriptElementRecord | null; insertions(): unknown[] }
type Probe = Window & { __pciAttribution: Api; __probe: Record<string, HTMLScriptElement> }

const win = window as unknown as Probe

beforeAll(() => {
  // Indirect eval: run in the global scope, as evaluateOnNewDocument does.
  ;(0, eval)(INLINE_SCRIPT_ATTRIBUTION_SCRIPT)
  win.__probe = {}
})

/** Insert an inline script from test code (no currentScript) and let it run. */
const runInline = (code: string): HTMLScriptElement => {
  const element = document.createElement('script')
  element.text = code
  document.head.appendChild(element)
  return element
}

const record = (element: Element | undefined): ScriptElementRecord => {
  const described = win.__pciAttribution.describe(element as Element)
  if (described === null) throw new Error('not a script element')
  return described
}

/** An inline script observation built from what the shim recorded, as `readPageScripts` builds it. */
const inlineObservation = (element: HTMLScriptElement): ScriptInfo => {
  const described = record(element)
  return {
    source: {
      type: 'inline',
      id: 'inline_script/id_not_found',
      content: element.text,
      ...(described.initiatorUrl !== null ? { url: described.initiatorUrl } : {}),
      instances: [{ token: described.token, kind: described.kind, inserterToken: described.inserterToken }],
    },
    hash: { value: described.token } as ScriptInfo['hash'],
  }
}

describe('attribution shim', () => {
  it('records the inline script that was currentScript as the inserter of a synchronous insertion', () => {
    const boot = runInline(`var s=document.createElement('script'); s.text='/*sync*/'; document.head.appendChild(s); window.__probe.sync=s`)
    expect(record(boot).kind).toBe('none')
    expect(record(win.__probe['sync'])).toEqual(expect.objectContaining({ kind: 'inline', inserterToken: record(boot).token }))
  })

  it.each([
    ['setTimeout', `setTimeout(function(){ var s=document.createElement('script'); s.text='/*late*/'; document.head.appendChild(s); window.__probe.late=s }, 0)`],
    ['a resolved promise', `Promise.resolve().then(function(){ var s=document.createElement('script'); s.text='/*late*/'; document.head.appendChild(s); window.__probe.late=s })`],
  ])('records an insertion made from %s, with no currentScript, as "none" — and the chain reads its first hop as unknown, never the document', async (_label, code) => {
    delete win.__probe['late']
    runInline(code)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const late = win.__probe['late']!
    expect(record(late)).toEqual(expect.objectContaining({ kind: 'none', inserterToken: null }))

    const observation = inlineObservation(late)
    resolveInitiatorChains({ externalScripts: [], inlineScripts: [observation], insertions: [], documentUrls: [location.href] })
    expect(observation.initiatorChain?.[0]?.kind).toBe('unknown')
  })

  it('records the scripts inside an inserted DocumentFragment, which no insertion method saw individually', () => {
    const boot = runInline(`var t=document.createElement('template'); t.innerHTML='<script>/*fragment*/<'+'/script>'; var f=t.content.cloneNode(true); window.__probe.fragment=f.querySelector('script'); document.body.appendChild(f)`)
    // Unrecorded, it would read as parser-inserted: attributed to the document.
    expect(record(win.__probe['fragment'])).toEqual(expect.objectContaining({ kind: 'inline', inserterToken: record(boot).token }))
  })

  it('records insertAdjacentElement and replaceChild insertions', () => {
    const victim = runInline('/*victim*/')
    win.__probe['victim'] = victim
    // One insertion per inserter: jsdom clears currentScript after running a
    // nested script instead of restoring the outer one, as Chrome does.
    const adjacentBoot = runInline(`var a=document.createElement('script'); a.text='/*adjacent*/'; document.body.insertAdjacentElement('beforeend', a); window.__probe.adjacent=a`)
    const replacingBoot = runInline(`var r=document.createElement('script'); r.text='/*replacement*/'; window.__probe.victim.parentNode.replaceChild(r, window.__probe.victim); window.__probe.replacement=r`)
    expect(record(win.__probe['adjacent'])).toEqual(expect.objectContaining({ kind: 'inline', inserterToken: record(adjacentBoot).token }))
    expect(record(win.__probe['replacement'])).toEqual(expect.objectContaining({ kind: 'inline', inserterToken: record(replacingBoot).token }))
  })

  it('never attributes the reference node of insertBefore, or the node replaceChild removes, to the inserter', () => {
    // Markup the parser put there: never passed to an insertion method, so the
    // shim first sees it as insertBefore's reference (the classic loader
    // snippet inserts before the page's first <script>).
    document.body.innerHTML += '<script>/*first*/</script><script>/*old*/</script>'
    const [first, old] = Array.from(document.body.querySelectorAll('script')).slice(-2)
    win.__probe['first'] = first as HTMLScriptElement
    win.__probe['old'] = old as HTMLScriptElement
    runInline(
      `var s=document.createElement('script'); s.text='/*before*/'; window.__probe.first.parentNode.insertBefore(s, window.__probe.first);` +
        `var r=document.createElement('script'); r.text='/*new*/'; window.__probe.old.parentNode.replaceChild(r, window.__probe.old)`,
    )
    expect(record(win.__probe['first']).kind).toBe('parser')
    expect(record(win.__probe['old']).kind).toBe('parser')
  })

  it('reads currentScript through the getter it captured, so a page redefining it later cannot hide the inserter', () => {
    const boot = runInline(
      `Object.defineProperty(Document.prototype, 'currentScript', { configurable: true, get: function () { return null } });` +
        `var s=document.createElement('script'); s.text='/*hidden*/'; document.head.appendChild(s); window.__probe.hidden=s;` +
        `delete Document.prototype.currentScript`,
    )
    expect(record(win.__probe['hidden'])).toEqual(expect.objectContaining({ kind: 'inline', inserterToken: record(boot).token }))
  })
})
