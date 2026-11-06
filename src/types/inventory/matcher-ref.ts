/**
 * Shared matcher definitions and the references target files make to them.
 *
 * An inventory repository may keep named matcher definitions in
 * `shared/matchers.json`; a target entry uses one by writing
 * `{ "matcherRef": "<name>" }` wherever a matcher config is accepted. Refs are
 * expanded into ordinary matcher configs when the inventory is loaded — so
 * validation, comparison, alerts, RUM and the report all see plain matchers —
 * and collapsed back to `{ "matcherRef" }` only when the inventory is written
 * back to Git. See `src/utils/matcher-ref.ts`.
 */

/** One named definition, exactly as written in the shared file. */
export type SharedMatcherDefinition = {
  /** Why the definition exists and what it is evidence of; for reviewers. */
  description: string
  /** Raw matcher config (JSON). Never carries `authorisationInfo` or `matcherRef`. */
  matcher: unknown
}

/** The shared file, as read by one pull. */
export type SharedMatchers = {
  /** Path relative to the inventory repo root, e.g. `shared/matchers.json`. */
  file: string
  /** Exact file contents as read — provenance resolves line numbers against it. */
  text: string
  definitions: Readonly<Record<string, SharedMatcherDefinition>>
}

/** Where a target file referenced a shared definition. */
export type MatcherRefSite = {
  collection: 'scripts' | 'headers'
  /** Index of the entry in its collection — stable, because the tool only appends entries. */
  entryIndex: number
  /** RFC 6901 pointer of the `{ "matcherRef" }` node in the target file. */
  pointer: string
  name: string
}

/** What an inventory needs to cite and to re-collapse its refs. */
export type InventoryMatcherRefs = {
  shared: SharedMatchers
  sites: readonly MatcherRefSite[]
}
