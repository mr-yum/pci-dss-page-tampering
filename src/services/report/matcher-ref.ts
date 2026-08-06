/**
 * Render a live `Matcher` into the report's descriptive form.
 *
 * Deliberately structural rather than a formatted string: an assessor filters
 * on "show me everything authorised by a hash" and needs the pattern itself, so
 * the JSON keeps the regex, the hash list or the child tree intact.
 *
 * @see ../../types/report.ts
 */

import type { InventoryScriptHashInfo } from '../../types/inventory/model.js'
import type { AuthorisationInfo, Matchable, Matcher } from '../../types/matcher/matcher.interface.js'
import type { ReportAuthorisationInfo, ReportMatcherPattern, ReportMatcherRef } from '../../types/report.js'

/**
 * Matchers optionally expose authorisation metadata — `getAuthorisationInfo`
 * lives on `AuthorisationMatcher`, not on the base `Matcher` every call site
 * holds. Same duck-typed access the serialisers already use.
 */
function readAuthorisationInfo(matcher: Matcher<never>): AuthorisationInfo | undefined {
  const accessor = (matcher as { getAuthorisationInfo?: () => AuthorisationInfo | undefined }).getAuthorisationInfo

  return typeof accessor === 'function' ? accessor.call(matcher) : undefined
}

export function toReportAuthorisationInfo(info: { description: string; authorised: boolean; date: Date } | undefined | null): ReportAuthorisationInfo | null {
  return info === undefined || info === null ? null : { description: info.description, authorised: info.authorised, date: info.date.toISOString() }
}

function isMatcherArray(pattern: unknown): pattern is Matcher<never>[] {
  return Array.isArray(pattern) && pattern.every((entry) => typeof entry === 'object' && entry !== null && 'getType' in entry)
}

function isHashArray(pattern: unknown): pattern is InventoryScriptHashInfo[] {
  return Array.isArray(pattern) && pattern.every((entry) => typeof entry === 'object' && entry !== null && 'hash' in entry)
}

function toPattern(matcher: Matcher<never>, depth: number): ReportMatcherPattern {
  const pattern = matcher.getPattern()

  // A CSP directive matcher approves a set, not a regex. Reporting it as one
  // would hide the very thing an assessor reads: which origins are allowed.
  if (matcher.getType() === 'csp-directive') {
    const csp = matcher as unknown as { getDirective(): string; getAllowedSources(): readonly string[] }

    return { kind: 'csp-directive', directive: csp.getDirective(), allow: [...csp.getAllowedSources()] }
  }

  if (isMatcherArray(pattern)) return { kind: 'composite', children: pattern.map((child) => toReportMatcherRef(child, depth + 1)) }

  if (isHashArray(pattern)) {
    return { kind: 'hashes', hashes: pattern.map((entry) => ({ value: entry.hash.value, timestamp: entry.timestamp.toISOString() })) }
  }

  return { kind: 'regex', value: typeof pattern === 'string' ? pattern : String(pattern) }
}

/**
 * Guard against a cyclic matcher tree. Composites are built from JSON so a
 * cycle should be impossible, but the report must not be the thing that hangs a
 * compliance run.
 */
const MAX_MATCHER_DEPTH = 64

export function toReportMatcherRef(matcher: Matcher<never>, depth = 0): ReportMatcherRef {
  const base = {
    type: matcher.getType(),
    description: matcher.getDescription(),
    authorisationInfo: toReportAuthorisationInfo(readAuthorisationInfo(matcher)),
  }

  if (depth >= MAX_MATCHER_DEPTH) return { ...base, pattern: { kind: 'regex', value: '(nesting limit reached)' } }

  return { ...base, pattern: toPattern(matcher, depth) }
}

/** Convenience for the many call sites that hold a possibly-absent matcher. */
export function toReportMatcherRefOrNull(matcher: Matcher<Matchable> | undefined | null): ReportMatcherRef | null {
  return matcher === undefined || matcher === null ? null : toReportMatcherRef(matcher as Matcher<never>)
}
