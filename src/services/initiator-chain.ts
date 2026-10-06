/**
 * Resolve every observed script's initiator chain after a synthetic run.
 *
 * Each observation carries only its first hop's evidence — the CDP request
 * initiator for an external script, the attribution shim's record for an
 * inline one. The rest of the chain is a walk over what the run observed:
 * from a script to the script that inserted it, and on, until the walk
 * reaches a document, or a URL it cannot tie to anything it saw.
 *
 * The rules, each chosen so that a gap in the evidence can only remove trust:
 *
 * - **Hop kinds.** A hop is `script` only when it names a script this run
 *   observed (an external script by URL, an inline script by the shim's
 *   per-element token); `document` when it names a document the run loaded
 *   (a top-level commit URL or route, or a frame document's response — and
 *   always for a parser-initiated request, whose inserter is the document);
 *   and
 *   `unknown` otherwise — including every fallback guess (an async insertion
 *   the shim saw with no `currentScript`, an initiator type that names no
 *   script). The walk ends at the first non-`script` hop.
 * - **Depth and cycles.** At most `INITIATOR_CHAIN_MAX_DEPTH` hops; a hop that
 *   would revisit a script already on the path ends that path there.
 * - **Forks.** An ancestor URL observed more than once with different
 *   initiators forks the walk above it; every path is kept (up to
 *   `INITIATOR_CHAIN_MAX_PATHS`). The first hop is the observation's own
 *   evidence, so it is the same on every path.
 * - **Anonymous network initiators.** Chrome reports no URL for the top frame
 *   of a dynamically inserted inline script (or `eval`), and the document URL
 *   for inline code parsed from the document — neither names the inserting
 *   script. For those only, the shim's insertion log is consulted: if it
 *   recorded, unambiguously, which inline script (or which external script)
 *   inserted an element with this `src`, that is the first hop. Otherwise the
 *   hop is the document (document-URL frame) or `unknown` (anonymous frame).
 *   A script URL in the top frame is never overridden by the shim's log.
 *
 * Neither source is unforgeable by code already running on the page: the
 * shim lives in the page's world, and a call frame's URL is whatever the
 * script was named, which `//# sourceURL` lets `eval`'d code choose. Chains
 * are evidence for display, for identification and for following a grant —
 * never, on their own, a reason to authorise: a load grant also requires the
 * loaded script's own URL to pass the grant's `loadsMatching` guard, and an
 * inline script never grants.
 */

import type { DocumentId } from '../types/document.js'
import { INITIATOR_CHAIN_MAX_DEPTH, INITIATOR_CHAIN_MAX_PATHS, type InitiatorHop, inlineHopUrl, inlineInstanceOf } from '../types/initiator-chain.js'
import type { InitiatorEvidence, ScriptInfo, UnansweredScriptRequest } from '../types/script.js'
import type { ScriptInsertionRecord } from '../utils/page-attribution.js'

/** A shim insertion record, tagged with the document whose scan returned it (undefined when the scan straddled a navigation). */
export type AttributedInsertion = ScriptInsertionRecord & { document?: DocumentId }

export type ChainResolutionInput = {
  externalScripts: readonly ScriptInfo[]
  inlineScripts: readonly ScriptInfo[]
  insertions: readonly AttributedInsertion[]
  /** Every document URL the run loaded: top-level commits and routes, and frame document responses. */
  documentUrls: Iterable<string>
  unansweredRequests?: readonly UnansweredScriptRequest[]
}

/** A URL without its fragment: the CDP stack and the ledger disagree about fragments, never about documents. */
function withoutFragment(url: string): string {
  const at = url.indexOf('#')
  return at === -1 ? url : url.slice(0, at)
}

/** The identity an inline script has as a hop. Undefined without a shim record. */
export function inlineIdentityOf(script: ScriptInfo): string | undefined {
  if (script.source.type !== 'inline') return undefined
  const primary = script.source.instances?.[0]
  return primary === undefined ? undefined : inlineHopUrl(script.source.id, primary.token)
}

/**
 * Attach `initiatorChain` (and `alternateInitiatorChains` where the walk
 * forks) to every script and unanswered request, in place.
 */
export function resolveInitiatorChains(input: ChainResolutionInput): void {
  const documents = new Set<string>()
  for (const url of input.documentUrls) if (url !== '') documents.add(withoutFragment(url))
  const isDocument = (url: string): boolean => documents.has(withoutFragment(url))

  const externalByUrl = new Map<string, ScriptInfo[]>()
  for (const script of input.externalScripts) {
    if (script.source.type !== 'external') continue
    externalByUrl.set(script.source.url, [...(externalByUrl.get(script.source.url) ?? []), script])
  }
  const inlineByToken = new Map<string, ScriptInfo>()
  const inlineByIdentity = new Map<string, ScriptInfo>()
  for (const script of input.inlineScripts) {
    if (script.source.type !== 'inline') continue
    for (const instance of script.source.instances ?? []) if (!inlineByToken.has(instance.token)) inlineByToken.set(instance.token, script)
    const identity = inlineIdentityOf(script)
    if (identity !== undefined) inlineByIdentity.set(identity, script)
  }

  const classify = (url: string | null | undefined): InitiatorHop => {
    if (url === null || url === undefined || url === '') return { url: '', kind: 'unknown' }
    if (externalByUrl.has(url)) return { url, kind: 'script' }
    if (isDocument(url)) return { url, kind: 'document' }
    return { url, kind: 'unknown' }
  }

  const inlineHop = (token: string | null): InitiatorHop => {
    const target = token === null ? undefined : inlineByToken.get(token)
    // Only an element's own observation stands for it: a duplicate collapsed
    // into another observation was never judged on its own.
    const identity = target === undefined || target.source.type !== 'inline' || target.source.instances?.[0]?.token !== token ? undefined : inlineIdentityOf(target)
    // An inserter the monitor never read (removed from the DOM before the
    // scan, or in a scan that failed) is named but cannot be judged.
    return identity === undefined ? { url: `inline_script/(not read)#${token ?? ''}`, kind: 'unknown' } : { url: identity, kind: 'script' }
  }

  /** The shim's record of who inserted an element with this src — only when every record agrees. */
  const insertionFor = (src: string, document: DocumentId | undefined): AttributedInsertion | undefined => {
    const records = input.insertions.filter((record) => record.src === src && (document === undefined || record.document === undefined || record.document === document))
    if (records.length === 0) return undefined
    const first = records[0]!
    const agree = records.every((record) => record.kind === first.kind && record.inserterToken === first.inserterToken && record.url === first.url)
    return agree ? first : undefined
  }

  /** First hop of a network-loaded script from its CDP initiator and, where that names no script, the shim's log. */
  const networkHop = (url: string, evidence: InitiatorEvidence | undefined, fallbackInitiator: string | undefined, document: DocumentId | undefined): InitiatorHop | undefined => {
    if (evidence === undefined) return fallbackInitiator === undefined ? undefined : classify(fallbackInitiator)
    switch (evidence.type) {
      case 'parser':
        // The parser's inserter is the document, whatever the URL also names.
        return { url: evidence.url, kind: 'document' }
      case 'other':
        // Not a script-issued request (preload, a fallback to the frame URL):
        // nothing names an inserter.
        return evidence.url === null ? undefined : { url: evidence.url, kind: 'unknown' }
      case 'stack': {
        const top = evidence.topFrameUrl
        if (top !== '' && (externalByUrl.has(top) || !isDocument(top))) return classify(top)
        const record = insertionFor(url, document)
        if (record?.kind === 'inline') return inlineHop(record.inserterToken)
        if (record?.kind === 'script' && record.url !== null) return classify(record.url)
        // The document's own inline code (or an event handler) with no record of which: the document.
        if (top !== '') return { url: top, kind: 'document' }
        return { url: fallbackInitiator ?? '', kind: 'unknown' }
      }
    }
  }

  const firstHop = (script: ScriptInfo): InitiatorHop | undefined => {
    const source = script.source
    if (source.type === 'external') return networkHop(source.url, source.initiatorEvidence, source.initiator, script.document)
    const instance = source.instances?.[0]
    if (instance === undefined) return source.url === undefined ? undefined : { url: source.url, kind: 'unknown' }
    switch (instance.kind) {
      case 'inline':
        return inlineHop(instance.inserterToken)
      case 'script':
        return classify(source.url)
      case 'parser':
        return source.url === undefined ? undefined : { url: source.url, kind: 'document' }
      case 'none':
        return { url: source.url ?? '', kind: 'unknown' }
    }
  }

  /** The distinct first hops of every observation a script hop could stand for. */
  const parentsOf = (hop: InitiatorHop): InitiatorHop[] => {
    const inline = inlineInstanceOf(hop.url) === null ? undefined : inlineByIdentity.get(hop.url)
    const scripts = inline !== undefined ? [inline] : (externalByUrl.get(hop.url) ?? [])
    const seen = new Set<string>()
    const parents: InitiatorHop[] = []
    for (const script of scripts) {
      const parent = firstHop(script)
      if (parent === undefined) continue
      const key = `${parent.kind}\u0000${parent.url}`
      if (seen.has(key)) continue
      seen.add(key)
      parents.push(parent)
    }
    return parents
  }

  const walk = (first: InitiatorHop, self: string | undefined): InitiatorHop[][] => {
    const paths: InitiatorHop[][] = []
    const extend = (path: InitiatorHop[], visited: ReadonlySet<string>): void => {
      if (paths.length >= INITIATOR_CHAIN_MAX_PATHS) return
      const last = path[path.length - 1]!
      if (last.kind !== 'script' || path.length >= INITIATOR_CHAIN_MAX_DEPTH) {
        paths.push(path)
        return
      }
      const parents = parentsOf(last)
      // A script hop with no evidence of its own inserter: the walk cannot go
      // on, and nothing beyond it is assumed.
      if (parents.length === 0) {
        paths.push([...path, { url: '', kind: 'unknown' }])
        return
      }
      for (const parent of parents) {
        if (parent.kind === 'script' && visited.has(parent.url)) {
          paths.push(path)
          continue
        }
        extend([...path, parent], parent.kind === 'script' ? new Set([...visited, parent.url]) : visited)
      }
    }
    const visited = new Set<string>(self === undefined ? [] : [self])
    if (first.kind === 'script' && first.url === self) return [[]]
    extend([first], first.kind === 'script' ? new Set([...visited, first.url]) : visited)
    return paths
  }

  const assign = (target: { initiatorChain?: InitiatorHop[]; alternateInitiatorChains?: InitiatorHop[][] }, first: InitiatorHop | undefined, self: string | undefined, keepAlternates: boolean): void => {
    if (first === undefined) return
    const [primary, ...alternates] = walk(first, self).filter((path) => path.length > 0)
    if (primary === undefined) return
    target.initiatorChain = primary
    if (keepAlternates && alternates.length > 0) target.alternateInitiatorChains = alternates
  }

  for (const script of input.externalScripts) {
    if (script.source.type !== 'external') continue
    assign(script, firstHop(script), script.source.url, true)
  }
  for (const script of input.inlineScripts) assign(script, firstHop(script), inlineIdentityOf(script), true)
  for (const request of input.unansweredRequests ?? []) {
    assign(request, networkHop(request.url, request.initiatorEvidence, undefined, request.document), undefined, false)
  }
}
