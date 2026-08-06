import type { DetectedHeader } from '../types/header.js'
import { CSP_ANY_NONCE } from '../types/matcher/csp-directive-matcher.js'
import type { Matchable } from '../types/matcher/matcher.interface.js'
import type { MatcherConfig } from '../types/matcher/matcher-factory.js'
import type { Target } from '../types/target.js'
import { escapeRegex } from './string.js'

/**
 * Map a detected header onto the `Matchable` shape used for authorisation.
 *
 * Headers do not line up with the interface field-for-field: the header *value*
 * is the content, and there is no hash. Extracted so the auditor report can
 * replay an authorisation through the very same mapping the comparison service
 * used — a second, hand-rolled copy would silently drift and produce a report
 * that disagrees with what the system actually decided.
 *
 * @see ../services/comparison/header.ts for the original call site
 */
export function detectedHeaderToMatchable(header: DetectedHeader, target: Target): Matchable {
  return {
    name: header.name,
    content: header.value,
    workflowId: target.workflowId ?? 'default',
    ...(header.url !== undefined ? { url: header.url } : {}),
    // hash is omitted for headers (optional field in Matchable interface)
  }
}

/** A per-response nonce, which must never be pinned into the inventory. */
const OBSERVED_NONCE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/u

/**
 * Header names whose values are a CSP, and so are a set of directives.
 *
 * Only what `TRACKED_HEADER_NAMES` actually captures belongs here — listing
 * `content-security-policy-report-only` would create a branch no run can reach
 * and imply a coverage the system does not have.
 */
const CSP_HEADER_NAMES = new Set(['content-security-policy'])

/**
 * Choose how to authorise a newly discovered header value.
 *
 * A CSP directive gets a set-based matcher rather than an anchored regex.
 * Directives are order-insensitive by definition, so a literal pattern mints a
 * fresh near-duplicate alternative every time the application reorders its
 * sources or drops one — real entries accumulate a dozen-plus that way. The set
 * form stays strict about *added* sources, which is the direction that matters.
 *
 * Everything else keeps the exact-value regex: for an ordinary header the whole
 * value is the assertion.
 */
export function newHeaderValueMatcherConfig(headerName: string, headerValue: string): MatcherConfig {
  const tokens = headerValue
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== '')
  const directive = tokens[0]

  if (CSP_HEADER_NAMES.has(headerName.toLowerCase()) && directive !== undefined && /^[A-Za-z][A-Za-z0-9-]*$/u.test(directive)) {
    // Collapse the per-response nonce to the wildcard, and de-duplicate: pinning
    // an observed nonce would fail on the very next response.
    const allow = [...new Set(tokens.slice(1).map((token) => (OBSERVED_NONCE.test(token) ? CSP_ANY_NONCE : token)))]

    return { cspDirectiveMatcher: { directive: directive.toLowerCase(), allow } }
  }

  return { contentMatcher: `^${escapeRegex(headerValue)}$` }
}
