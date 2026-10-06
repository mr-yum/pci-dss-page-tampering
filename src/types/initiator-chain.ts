/**
 * Initiator chain — who loaded a script, and who loaded that, out to the page.
 *
 * `Matchable.initiator` answers "what inserted this script?" one hop deep.
 * The chain answers it all the way out, so trust can be made transitive
 * through loaders: an inventory entry can identify a script by any host in
 * its ancestry (`initiatorHostMatcher` with `transitive: true`), and an
 * authorised entry can vouch for what it loads (`authorisesLoads`).
 *
 * Shape: immediate inserter first, outward to the root. Each hop says what
 * kind of thing it is, because only a script hop can carry a verdict:
 *
 * - `script` — a script observed in this run. Its `url` is the script's URL, or, for
 *   an inline script, its inline identity (`inline_script/<name>#<instance>`,
 *   never a parseable URL, so host matchers skip it).
 * - `document` — the document itself: the walk reached the page (or a frame
 *   document) and stops.
 * - `unknown` — the URL named as inserter could not be tied to anything
 *   observed (an unread script, a guess such as the document fallback for an
 *   async insertion). The walk ends there and nothing beyond it is assumed;
 *   consumers evaluate only the known prefix before it.
 *
 * Evidence, not a claim: a hop exists only where the monitor saw the
 * insertion. A missing or empty chain means "no evidence", and every consumer
 * fails secure on it.
 */

export type InitiatorHopKind = 'script' | 'document' | 'unknown'

export type InitiatorHop = {
  /** Script URL, inline identity (`inline_script/…#…`), or document URL. Unredacted in memory; every display surface redacts it. */
  url: string
  kind: InitiatorHopKind
}

/** Longest chain recorded and the largest `maxDepth` an inventory may ask for. */
export const INITIATOR_CHAIN_MAX_DEPTH = 8

/**
 * Most alternative paths recorded for one script. A URL observed with several
 * initiators forks the walk; capping the fan-out drops paths, which can only
 * remove ways to match — never add one.
 */
export const INITIATOR_CHAIN_MAX_PATHS = 16

/** Every inline script name starts with this (see `getInlineScriptsFromPage`). */
export const INLINE_SCRIPT_NAME_PREFIX = 'inline_script/'

/** Separator between an inline script's name and its per-element instance token. */
export const INLINE_INSTANCE_SEPARATOR = '#'

/** The hop `url` for one inline script element: its name plus the instance token the attribution shim gave the element. */
export function inlineHopUrl(name: string, instance: string): string {
  return `${name}${INLINE_INSTANCE_SEPARATOR}${instance}`
}

/** The instance token an inline hop names, or null when the hop is not an inline identity. */
export function inlineInstanceOf(hopUrl: string): string | null {
  if (!hopUrl.startsWith(INLINE_SCRIPT_NAME_PREFIX)) return null
  const at = hopUrl.lastIndexOf(INLINE_INSTANCE_SEPARATOR)
  return at === -1 || at === hopUrl.length - 1 ? null : hopUrl.slice(at + 1)
}

/** The hops before the first `unknown` one — the part of a chain a consumer may evaluate. */
export function knownPrefix(chain: readonly InitiatorHop[]): InitiatorHop[] {
  const end = chain.findIndex((hop) => hop.kind === 'unknown')
  return end === -1 ? [...chain] : chain.slice(0, end)
}

/** Every recorded path for a resource: the primary chain first, then any forks. Empty when there is no chain. */
export function chainPaths(resource: { initiatorChain?: readonly InitiatorHop[] | undefined; alternateInitiatorChains?: readonly (readonly InitiatorHop[])[] | undefined }): (readonly InitiatorHop[])[] {
  const paths: (readonly InitiatorHop[])[] = []
  if (resource.initiatorChain !== undefined && resource.initiatorChain.length > 0) paths.push(resource.initiatorChain)
  for (const alternate of resource.alternateInitiatorChains ?? []) if (alternate.length > 0) paths.push(alternate)
  return paths
}

/** The host a hop names, or null for inline identities, unparseable URLs and hostless schemes. Same derivation as `InitiatorHostMatcher`. */
export function hopHost(hop: InitiatorHop): string | null {
  if (hop.url.trim() === '' || hop.url.startsWith(INLINE_SCRIPT_NAME_PREFIX)) return null
  try {
    const host = new URL(hop.url).host
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/**
 * One chain as a human reads it, immediate inserter first:
 * `loaded by a.example ← inline_script/boot#3 ← page pay.example`.
 *
 * `render` turns a hop URL into display text — hosts for matcher reasons,
 * redacted URLs for alerts and reports. It is the caller's job to redact;
 * this only arranges.
 */
export function describeChain(chain: readonly InitiatorHop[], render: (hop: InitiatorHop) => string): string {
  return `loaded by ${chainText(chain, render)}`
}

/** `describeChain` without the leading "loaded by", for a column already headed that way. */
export function chainText(chain: readonly InitiatorHop[], render: (hop: InitiatorHop) => string): string {
  if (chain.length === 0) return '(no initiator evidence)'
  return chain
    .map((hop) => {
      const text = hop.url === '' ? '(unattributed)' : render(hop)
      if (hop.kind === 'document') return `page ${text}`
      if (hop.kind === 'unknown') return `${text} (unverified)`
      return text
    })
    .join(' ← ')
}

/** Render a hop by its host, for matcher reasons; inline identities are shown as-is. */
export function hopHostLabel(hop: InitiatorHop): string {
  if (hop.url.startsWith(INLINE_SCRIPT_NAME_PREFIX)) return hop.url
  return hopHost(hop) ?? '(unparseable)'
}
