/**
 * What a real-user observation can be judged on when it carries no content.
 *
 * An external script seen in a real user's browser is just a URL (and who
 * inserted it): its body is opaque client-side (research R8), so it was
 * always identification-only — identified meant "recorded", never judged.
 * That stays true for an entry whose authorisation needs content or a hash.
 * But an entry whose authorisation consumes ONLY evidence the observation
 * carries — its own URL, its initiator, its pass — can be evaluated exactly,
 * per the evidence-aware principle: each matcher decides on the evidence it
 * holds. This module decides when that is the case, and uses it to let an
 * ancestor in a RUM observation's initiator chain vouch for its loads.
 */

import type { InheritedAuthorisation } from '../types/comparison/index.js'
import { chainPaths, type InitiatorHop, INLINE_SCRIPT_NAME_PREFIX, ownEvidence } from '../types/initiator-chain.js'
import type { InventoryScriptInfo } from '../types/inventory/model.js'
import type { InitiatorHostMatcher } from '../types/matcher/initiator-host-matcher.js'
import type { Matchable, Matcher } from '../types/matcher/matcher.interface.js'

/**
 * Matcher types whose evidence a URL-only observation carries in full:
 * `name`/`url`/`host` read the script's own URL, `initiator-host` its
 * initiator (or chain), `targetType` the pass the collector stamped.
 * Deliberately excluded: `hash`, `content`, `csp-directive` (evidence a URL
 * cannot supply) and `workflow` (a RUM observation can never prove its
 * checkout variation, so a workflow-scoped authoriser would deny every
 * observation for want of evidence rather than on it). `initiator-host`
 * counts only when the observation's chain starts with a real hop, and never
 * when it considers `document` hops only (`kinds: ["document"]`).
 */
const URL_EVIDENCE_MATCHERS = new Set(['name', 'url', 'host', 'initiator-host', 'targetType'])

/**
 * True when every leaf of the matcher consumes only URL evidence, so
 * `authorize()` on a URL-only observation decides on what the observation
 * actually carries. One leaf that needs content or a hash makes the whole
 * matcher unevaluable — an OR alternative that would have authorised on a
 * hash we lack must not be read as a denial.
 */
export function consumesOnlyUrlEvidence(matcher: Matcher, observation?: Matchable): boolean {
  const type = matcher.getType()
  if (type === 'or' || type === 'and') {
    const children = matcher.getPattern() as Matcher[]
    return children.length > 0 && children.every((child) => consumesOnlyUrlEvidence(child, observation))
  }
  // A transitive matcher limited to `document` hops cannot be satisfied by
  // anything a real user's browser reports: a document hop counts only when
  // bound to the frame the browser loaded the script into, which no beacon
  // carries (and the agent never emits document hops at all). Evaluating it
  // would deny every observation for want of evidence rather than on it, so
  // it leaves the authoriser unevaluable — identification-only — like a hash.
  if (type === 'initiator-host' && !(matcher as Partial<Pick<InitiatorHostMatcher, 'getHopKinds'>>).getHopKinds?.().includes('script')) return false
  // The agent falls back to the document URL as `initiator` whenever no
  // script was executing (async callbacks, safety-net captures), so an
  // initiator is evidence only when the chain's first hop is a real one.
  if (type === 'initiator-host' && observation !== undefined) {
    const first = observation.initiatorChain?.[0]
    return first !== undefined && first.kind !== 'unknown'
  }
  return URL_EVIDENCE_MATCHERS.has(type)
}

export type RumInheritance = { entry: InventoryScriptInfo; inherited: InheritedAuthorisation }

/**
 * Pass 2 for a real-user observation nothing identified: walk its chain and
 * look for an ancestor that vouches for it. Unlike the synthetic lane, the
 * ancestors are not in the same batch — novelty dedupe means a known loader
 * is not re-reported — so each ancestor hop is judged from the hop alone, as
 * a URL-only observation:
 *
 * - only an EXTERNAL observation can inherit — an inline load never does,
 *   on either lane: its name and chain are page-controlled evidence;
 * - an observation ANY entry identifies — a pending or declined one included
 *   (`entries` is the whole inventory, whatever each entry's `authorised`) —
 *   never inherits: that entry's verdict is a reviewer's to give;
 * - an inline hop (`inline_script/rum#<n>`) carries no evidence at all and
 *   ends the walk; so does a `document` or `unknown` hop;
 * - the hop must be identified by an entry whose authoriser consumes only
 *   URL evidence, and authorised by it — an ancestor that could only be
 *   judged on content cannot be shown to be authorised, so it ends the walk;
 * - the first such ancestor whose entry grants (`authorisesLoads`) within
 *   depth, and whose mandatory `loadsMatching` guard accepts this
 *   observation, is the grantor; an authorised non-granting ancestor is
 *   passed through.
 *
 * The same rules as the synthetic lane otherwise (see `inheritAuthorisation`
 * in src/services/comparison/script.ts). Returns null when nothing grants.
 */
export function inheritOnUrlEvidence(observation: Matchable, entries: readonly InventoryScriptInfo[], identify: (matchable: Matchable) => InventoryScriptInfo | undefined): RumInheritance | null {
  if (observation.name.startsWith(INLINE_SCRIPT_NAME_PREFIX)) return null
  if (entries.some((entry) => entry.identifyWith.identify(observation))) return null
  for (const path of chainPaths(observation)) {
    for (const [index, hop] of path.entries()) {
      if (hop.kind !== 'script' || hop.url.startsWith(INLINE_SCRIPT_NAME_PREFIX)) break
      const above = path.slice(index + 1)
      const ancestor = ancestorMatchable(hop, above, observation.targetType)
      const entry = identify(ancestor)
      if (entry === undefined || !entries.includes(entry) || !consumesOnlyUrlEvidence(entry.authoriseWith.matcher, ancestor)) break
      if (!entry.authoriseWith.matcher.authorize(ancestor).authorized) break
      const grant = entry.authorisesLoads
      if (grant !== undefined && index + 1 <= grant.maxDepth && grant.loadsMatching !== undefined && grant.loadsMatching.identify(ownEvidence(observation))) {
        return { entry, inherited: { from: hop.url, via: path.slice(0, index + 1), mode: grant.mode } }
      }
    }
  }
  return null
}

/** An ancestor hop as a URL-only observation: its own URL, and the rest of the chain as its provenance. */
function ancestorMatchable(hop: InitiatorHop, above: InitiatorHop[], targetType: string | undefined): Matchable {
  const inserter = above[0]
  return {
    name: hop.url,
    content: null,
    url: hop.url,
    // Only a hop that names its inserter is evidence of one: an `unknown` hop
    // ends what is known, so it never becomes the ancestor's initiator.
    ...(inserter !== undefined && inserter.kind !== 'unknown' && !inserter.url.startsWith(INLINE_SCRIPT_NAME_PREFIX) && inserter.url !== '' ? { initiator: inserter.url } : {}),
    ...(above.length > 0 ? { initiatorChain: above } : {}),
    ...(targetType !== undefined ? { targetType } : {}),
  }
}
