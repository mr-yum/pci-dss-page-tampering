/**
 * The synthetic chain resolver: from each observation's first-hop evidence to
 * a chain out to the page. Real-Chrome behaviour (what the CDP initiator and
 * the attribution shim actually report) is covered end to end by
 * test/integration/transitive-trust.test.ts; these pin each rule in isolation.
 */

import type { SHA256Hash } from '../types/hash.js'
import type { InitiatorEvidence, InlineScriptInstance, ScriptInfo, UnansweredScriptRequest } from '../types/script.js'
import { type AttributedInsertion, inlineIdentityOf, resolveInitiatorChains } from './initiator-chain.js'

const PAGE = 'https://shop.example/pay'
const LOADER = 'https://js.vendor.example/loader.js'
const ASSET = 'https://assets.vendor.example/a.js'

const external = (url: string, evidence: InitiatorEvidence | undefined, extra: Partial<ScriptInfo> = {}, initiator?: string): ScriptInfo => ({
  source: { type: 'external', url, content: url, ...(evidence !== undefined ? { initiatorEvidence: evidence } : {}), ...(initiator !== undefined ? { initiator } : {}) },
  hash: { value: url } as SHA256Hash,
  ...extra,
})
const stack = (topFrameUrl: string): InitiatorEvidence => ({ type: 'stack', topFrameUrl })
const parser = (url: string): InitiatorEvidence => ({ type: 'parser', url })
const inline = (token: string, instance: Omit<InlineScriptInstance, 'token'>, url: string | undefined, id = 'inline_script/id_not_found'): ScriptInfo => ({
  source: { type: 'inline', id, content: token, ...(url !== undefined ? { url } : {}), instances: [{ token, ...instance }] },
  hash: { value: token } as SHA256Hash,
})
const hops = (script: { initiatorChain?: { url: string; kind: string }[] }): string[] => (script.initiatorChain ?? []).map((hop) => `${hop.kind}:${hop.url}`)

const resolve = (externalScripts: ScriptInfo[], inlineScripts: ScriptInfo[] = [], insertions: AttributedInsertion[] = [], unansweredRequests: UnansweredScriptRequest[] = []) =>
  resolveInitiatorChains({ externalScripts, inlineScripts, insertions, documentUrls: [PAGE], unansweredRequests })

describe('resolveInitiatorChains', () => {
  it('walks from a script to its loader to the page', () => {
    const loader = external(LOADER, parser(PAGE))
    const asset = external(ASSET, stack(LOADER))
    resolve([loader, asset])
    expect(hops(loader)).toEqual([`document:${PAGE}`])
    expect(hops(asset)).toEqual([`script:${LOADER}`, `document:${PAGE}`])
  })

  it('matches a document URL whatever its fragment', () => {
    const loader = external(LOADER, parser(`${PAGE}#step-2`))
    resolve([loader])
    expect(hops(loader)).toEqual([`document:${PAGE}#step-2`])
  })

  it('stops at a URL it cannot tie to an observation, as unknown, assuming nothing beyond', () => {
    const asset = external(ASSET, stack('https://unread.example/x.js'))
    resolve([asset])
    expect(hops(asset)).toEqual(['unknown:https://unread.example/x.js'])
  })

  it('ends a chain at a script with no initiator evidence of its own with an unknown hop', () => {
    const loader = external(LOADER, undefined)
    const asset = external(ASSET, stack(LOADER))
    resolve([loader, asset])
    expect(hops(asset)).toEqual([`script:${LOADER}`, 'unknown:'])
  })

  it('reads a parser initiator as the document even when the URL was also observed as a script', () => {
    const odd = external(PAGE, parser(PAGE))
    const loader = external(LOADER, parser(PAGE))
    resolve([odd, loader])
    expect(hops(loader)).toEqual([`document:${PAGE}`])
  })

  it('treats a non-script initiator type as no inserter', () => {
    const asset = external(ASSET, { type: 'other', url: PAGE })
    resolve([asset])
    expect(hops(asset)).toEqual([`unknown:${PAGE}`])
  })

  it('leaves a script with no evidence at all without a chain', () => {
    const asset = external(ASSET, undefined)
    resolve([asset])
    expect(asset.initiatorChain).toBeUndefined()
  })

  it('caps a chain at 8 hops', () => {
    const urls = Array.from({ length: 12 }, (_, index) => `https://cdn.example/${index}.js`)
    const scripts = urls.map((url, index) => external(url, index === 0 ? parser(PAGE) : stack(urls[index - 1]!)))
    resolve(scripts)
    expect(scripts.at(-1)!.initiatorChain).toHaveLength(8)
  })

  it('ends a path where it would revisit a script already on it', () => {
    const a = external('https://cdn.example/a.js', stack('https://cdn.example/b.js'))
    const b = external('https://cdn.example/b.js', stack('https://cdn.example/a.js'))
    resolve([a, b])
    expect(hops(a)).toEqual(['script:https://cdn.example/b.js'])
  })

  it('forks above an ancestor observed with more than one initiator, keeping the immediate hop on every path', () => {
    const tag = 'https://cdn.example/tag.js'
    const loaderFromPage = external(LOADER, parser(PAGE))
    const loaderFromTag = external(LOADER, stack(tag), { hash: { value: 'v2' } as SHA256Hash })
    const tagScript = external(tag, parser(PAGE))
    const asset = external(ASSET, stack(LOADER))
    resolve([loaderFromPage, loaderFromTag, tagScript, asset])
    expect(hops(asset)).toEqual([`script:${LOADER}`, `document:${PAGE}`])
    expect(asset.alternateInitiatorChains?.map((path) => path.map((hop) => `${hop.kind}:${hop.url}`))).toEqual([[`script:${LOADER}`, `script:${tag}`, `document:${PAGE}`]])
  })

  describe('inline hops', () => {
    it('passes through an inline script by its instance token', () => {
      const boot = inline('t-1', { kind: 'parser', inserterToken: null }, PAGE)
      const loader = external(LOADER, stack(''))
      resolve([loader], [boot], [{ token: 't-9', src: LOADER, kind: 'inline', inserterToken: 't-1', url: PAGE }])
      expect(inlineIdentityOf(boot)).toBe('inline_script/id_not_found#t-1')
      expect(hops(boot)).toEqual([`document:${PAGE}`])
      expect(hops(loader)).toEqual(['script:inline_script/id_not_found#t-1', `document:${PAGE}`])
    })

    it('prefers the shim log over a document-URL top frame (inline code parsed from the page names no script)', () => {
      const boot = inline('t-1', { kind: 'parser', inserterToken: null }, PAGE)
      const loader = external(LOADER, stack(PAGE))
      resolve([loader], [boot], [{ token: 't-9', src: LOADER, kind: 'inline', inserterToken: 't-1', url: PAGE }])
      expect(hops(loader)).toEqual(['script:inline_script/id_not_found#t-1', `document:${PAGE}`])
    })

    it('never lets the shim log override a real script URL in the top frame', () => {
      const boot = inline('t-1', { kind: 'parser', inserterToken: null }, PAGE)
      const loader = external(LOADER, parser(PAGE))
      const asset = external(ASSET, stack(LOADER))
      resolve([loader, asset], [boot], [{ token: 't-9', src: ASSET, kind: 'inline', inserterToken: 't-1', url: PAGE }])
      expect(hops(asset)).toEqual([`script:${LOADER}`, `document:${PAGE}`])
    })

    it('reads a document-URL top frame with no shim record as the document', () => {
      const asset = external(ASSET, stack(PAGE))
      resolve([asset])
      expect(hops(asset)).toEqual([`document:${PAGE}`])
    })

    it('reads an anonymous top frame with no shim record as unknown', () => {
      const asset = external(ASSET, stack(''), {}, PAGE)
      resolve([asset])
      expect(hops(asset)).toEqual([`unknown:${PAGE}`])
    })

    it('trusts no shim record when the records for a src disagree', () => {
      const one = inline('t-1', { kind: 'parser', inserterToken: null }, PAGE)
      const two = inline('t-2', { kind: 'parser', inserterToken: null }, PAGE, 'inline_script/other')
      const asset = external(ASSET, stack(''))
      resolve(
        [asset],
        [one, two],
        [
          { token: 't-8', src: ASSET, kind: 'inline', inserterToken: 't-1', url: PAGE },
          { token: 't-9', src: ASSET, kind: 'inline', inserterToken: 't-2', url: PAGE },
        ],
      )
      expect(hops(asset)).toEqual(['unknown:'])
    })

    it('uses only shim records from the same document', () => {
      const boot = inline('t-1', { kind: 'parser', inserterToken: null }, PAGE)
      const asset = external(ASSET, stack(''), { document: 'L2' })
      resolve([asset], [boot], [{ token: 't-9', src: ASSET, kind: 'inline', inserterToken: 't-1', url: PAGE, document: 'L1' }])
      expect(hops(asset)).toEqual(['unknown:'])
    })

    it('names an inline inserter the monitor never read, as unknown', () => {
      const child = inline('t-2', { kind: 'inline', inserterToken: 't-gone' }, PAGE)
      resolve([], [child])
      expect(hops(child)).toEqual(['unknown:inline_script/(not read)#t-gone'])
    })

    it('chains inline-inserts-inline, then through an external loader', () => {
      const loader = external(LOADER, parser(PAGE))
      const parent = inline('t-1', { kind: 'script', inserterToken: null }, LOADER)
      const child = inline('t-2', { kind: 'inline', inserterToken: 't-1' }, LOADER, 'inline_script/child')
      resolve([loader], [parent, child])
      expect(hops(child)).toEqual(['script:inline_script/id_not_found#t-1', `script:${LOADER}`, `document:${PAGE}`])
    })

    it('records an async insertion (no currentScript) as unknown, and a parser-inserted one as the document', () => {
      const late = inline('t-1', { kind: 'none', inserterToken: null }, PAGE)
      const markup = inline('t-2', { kind: 'parser', inserterToken: null }, PAGE, 'inline_script/markup')
      resolve([], [late, markup])
      expect(hops(late)).toEqual([`unknown:${PAGE}`])
      expect(hops(markup)).toEqual([`document:${PAGE}`])
    })

    it("treats a token that is not an observation's own element as an unknown hop", () => {
      const boot: ScriptInfo = { ...inline('t-1', { kind: 'parser', inserterToken: null }, PAGE) }
      if (boot.source.type === 'inline') boot.source.instances = [...(boot.source.instances ?? []), { token: 't-5', kind: 'parser', inserterToken: null }]
      const loader = external(LOADER, stack(''))
      resolve([loader], [boot], [{ token: 't-9', src: LOADER, kind: 'inline', inserterToken: 't-5', url: PAGE }])
      expect(hops(loader)).toEqual(['unknown:inline_script/(not read)#t-5'])
    })
  })

  it('resolves who asked for a script request that was never answered', () => {
    const loader = external(LOADER, parser(PAGE))
    const request: UnansweredScriptRequest = { url: ASSET, resourceType: 'script', reason: 'unanswered', step: 1, initiatorEvidence: stack(LOADER) }
    resolve([loader], [], [], [request])
    expect(hops(request)).toEqual([`script:${LOADER}`, `document:${PAGE}`])
  })
})
