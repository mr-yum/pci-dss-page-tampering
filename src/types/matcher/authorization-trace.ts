/**
 * Structural record of which matcher nodes an authorisation actually visited.
 *
 * The auditor report has to name the *specific* thing that authorised a script
 * — which OR alternative, which hash in the list — so it can cite a JSON pointer
 * like `/scripts/7/authoriseWith/hashes/2`. `metadataPath` cannot answer that:
 * it carries authorisation descriptions, which are optional on child matchers
 * and absent entirely from hash entries.
 *
 * The trace is purely descriptive. It never influences an authorisation
 * decision, and it is only produced when the caller opts in via
 * {@link AuthorizeOptions}, so the detection hot path allocates nothing.
 *
 * @see ../../utils/provenance.ts for the consumer that walks a trace into a pointer
 */

import type { Matchable, Matcher } from './matcher.interface.js'

/** The discriminator returned by {@link Matcher.getType}. */
export type MatcherKind = ReturnType<Matcher['getType']>

/**
 * One child slot a composite matcher consulted.
 *
 * `index` is positional within the matcher's own children (or its hash list),
 * which is what makes it translatable to a JSON pointer segment.
 */
export type AuthorizationTraceStep = {
  /** `'hashes'` for a HashMatcher's authorized-hash list, `'child'` otherwise. */
  slot: 'child' | 'hashes'
  index: number
  /** Absent for the `'hashes'` slot, which is always terminal. */
  child?: AuthorizationTrace | undefined
}

/**
 * A node in the authorisation trace, rooted at the matcher `authorize()` was
 * called on.
 *
 * `consulted` holds the child slots visited, in evaluation order:
 * - `'or'`: 0 or 1 entries — the first child that identified the resource
 * - `'and'`: 0..N entries — every conjunct evaluated before any short-circuit
 * - `'hash'`: 0 or 1 entries, `slot: 'hashes'`, no nested child
 * - leaf matchers: always empty
 */
export type AuthorizationTrace = {
  /** Mirrors {@link Matcher.getType} at this node. */
  type: MatcherKind
  consulted: readonly AuthorizationTraceStep[]
}

/**
 * Opt-in behaviour for {@link Matcher.authorize}.
 *
 * Tracing is off by default so that existing callers — and the assertions that
 * compare whole `AuthorizationResult` objects — see exactly the shape they
 * always have.
 */
export type AuthorizeOptions = {
  readonly collectTrace?: boolean | undefined
}

/**
 * Synthesise the trace node for a matcher that does not produce one itself.
 *
 * Leaf matchers take no options and have no children, so a composite parent
 * describes them from the outside. Keeping this here means every composite
 * spells an untraced child the same way.
 */
export function leafTrace<T extends Matchable>(matcher: Matcher<T>): AuthorizationTrace {
  return { type: matcher.getType(), consulted: [] }
}
