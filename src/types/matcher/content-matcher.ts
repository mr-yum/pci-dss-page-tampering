/**
 * ContentMatcher Implementation
 *
 * Matches scripts by content using regex patterns.
 * Used for identifying inline scripts or scripts with specific code snippets.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for design
 */

import type { AuthorizationResult } from './authorization-result.js'
import type { AuthorisationInfo, AuthorisationMatcher, ContentWindowEvidence, DetectedScript } from './matcher.interface.js'

/**
 * Scans a regex source for bare (unescaped, outside character classes)
 * `^` and `$` anchors, and for boundary/lookaround assertions. Patterns come
 * from the inventory schema and are compiled without flags, so `m` never
 * applies — `^`/`$` are absolute string anchors.
 *
 * `hasAssertion` flags word-boundary (`\b`, `\B`) and lookaround (`(?=`,
 * `(?!`, `(?<=`, `(?<!`) constructs. Their truth is evaluated at a position
 * relative to the *string's* start or end, so against a bounded head/tail
 * window they see a boundary the full content does not have — a window match
 * would be unsound. Any pattern carrying one is treated as not
 * window-evaluable (see {@link ContentMatcher.evaluateEvidence}). Escape and
 * character-class scanning is respected: a `\b` inside a class is a backspace
 * literal, not a boundary, and an escaped `\\b` outside a class is a literal.
 */
const scanAnchors = (source: string): { startsWithCaret: boolean; endsWithDollar: boolean; hasBareCaret: boolean; hasBareDollar: boolean; hasAssertion: boolean } => {
  let inClass = false
  let hasBareCaret = false
  let hasBareDollar = false
  let endsWithDollar = false
  let hasAssertion = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === '\\') {
      // `\b`/`\B` outside a character class are word-boundary assertions; the
      // same escape inside a class is a backspace literal (handled below).
      if (!inClass && (source[i + 1] === 'b' || source[i + 1] === 'B')) hasAssertion = true
      i += 1 // The next char is escaped — never an anchor.
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') {
      inClass = true
      continue
    }
    if (char === '(' && source[i + 1] === '?') {
      // Lookahead `(?=` / `(?!` and lookbehind `(?<=` / `(?<!` are assertions;
      // `(?:` (non-capturing) and `(?<name>` (named group) are not.
      const third = source[i + 2]
      if (third === '=' || third === '!') hasAssertion = true
      else if (third === '<' && (source[i + 3] === '=' || source[i + 3] === '!')) hasAssertion = true
    }
    if (char === '^') hasBareCaret = true
    if (char === '$') {
      hasBareDollar = true
      endsWithDollar = i === source.length - 1
    }
  }
  return { startsWithCaret: source.startsWith('^'), endsWithDollar, hasBareCaret, hasBareDollar, hasAssertion }
}

/**
 * Matches scripts by content using regex patterns.
 *
 * Use Cases:
 * - Inline scripts with identifying code snippets: `fbq\('init',`
 * - Scripts with specific structure: `__NEXT_DATA__`
 *
 * Behavior:
 * - identify(): Tests script.content against pattern
 * - authorize(): Tests script.content against pattern (same pattern for both)
 * - Returns false for null/empty content (triggers UnknownScriptFound per clarification Q3)
 * - When content is null but anchored head/tail window evidence is present
 *   (RUM inline scripts, feature 011), evaluates soundly against the windows
 *   and otherwise fails secure — see {@link evaluateEvidence}.
 */
export class ContentMatcher implements AuthorisationMatcher {
  private readonly pattern: RegExp
  private readonly authorisationInfo: AuthorisationInfo | undefined

  /**
   * Creates a new ContentMatcher with the specified regex pattern.
   *
   * @param patternString - Regex pattern string (validated by Zod schema before instantiation)
   * @param authorisationInfo - Optional authorization metadata
   */
  constructor(patternString: string, authorisationInfo: AuthorisationInfo | undefined = undefined) {
    this.pattern = new RegExp(patternString)
    this.authorisationInfo = authorisationInfo
  }

  /**
   * Returns the matcher type discriminator.
   *
   * @returns The string 'content' for type-based dispatch
   */
  getType(): 'content' {
    return 'content'
  }

  /**
   * Returns the regex pattern source for logging and debugging.
   *
   * @returns The regex pattern as a string
   */
  getPattern(): string {
    return this.pattern.source
  }

  /**
   * Returns a human-readable description for logging.
   *
   * @returns Formatted string like "content:/pattern/" with pattern truncated if too long
   */
  getDescription(): string {
    const pattern = this.pattern.source
    const truncated = pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern
    return `content:/${truncated}/`
  }

  /**
   * Returns the authorization metadata for this matcher.
   *
   * @returns Authorization metadata if present, undefined otherwise
   */
  getAuthorisationInfo(): AuthorisationInfo | undefined {
    return this.authorisationInfo
  }

  /**
   * Identifies if a detected script matches this pattern by testing the script content.
   * Fail-secure: returns false for null/empty content.
   *
   * When content is null but anchored window evidence is present (RUM inline
   * scripts), a sound window match identifies; anything else — non-match or
   * not-evaluable pattern — returns false, the existing fail-secure shape.
   *
   * @param script - The detected script to test
   * @returns true if script.content matches the pattern, false otherwise
   */
  identify(script: DetectedScript): boolean {
    if (script.content && script.content.trim() !== '') {
      return this.pattern.test(script.content)
    }
    if (script.contentEvidence !== undefined) {
      return this.evaluateEvidence(script.contentEvidence).authorized
    }
    return false // Cannot match on empty content (fail-secure per research.md R5)
  }

  /**
   * Authorizes a detected script by testing the script content against the pattern.
   *
   * Evidence-aware (feature 011): when content is null but head/tail window
   * evidence is present, defers to {@link evaluateEvidence}. The generic
   * "content is null or empty" reason is reserved for the truly evidence-less
   * case — window evidence that cannot be evaluated gets its own explicit
   * bounded-excerpt reason.
   *
   * @param script - The detected script to authorize
   * @returns AuthorizationResult with authorized=true if content matches, authorized=false with reason otherwise
   */
  authorize(script: DetectedScript): AuthorizationResult {
    if (!script.content || script.content.trim() === '') {
      if (script.contentEvidence !== undefined) {
        const result = this.evaluateEvidence(script.contentEvidence)
        if (this.authorisationInfo) {
          result.metadataPath = [this.authorisationInfo]
        }
        return result
      }
      // Truly evidence-less: the legacy shape, deliberately without a
      // metadataPath (synthetic behaviour unchanged).
      return {
        authorized: false,
        reason: 'content is null or empty',
      }
    }

    const matches = this.pattern.test(script.content)
    const result: AuthorizationResult = matches
      ? { authorized: true }
      : {
          authorized: false,
          reason: `content does not match pattern: ${this.pattern.source}`,
        }

    // Include authorisationInfo in metadataPath if present
    if (this.authorisationInfo) {
      result.metadataPath = [this.authorisationInfo]
    }

    return result
  }

  /**
   * Evaluates the pattern against bounded head/tail window evidence
   * (data-model.md §6: windows are matched independently as anchored windows,
   * never reconstructed).
   *
   * Soundness rules — `head` is a STRICT prefix, `tail` a STRICT suffix of
   * the real content:
   *
   * - A `^`-anchored pattern with no bare `$` is evaluated against the head.
   *   Inside the head, `^` asserts the true content start, and with no `$` the
   *   pattern makes no end-of-content claim, so a MATCH inside the window IS a
   *   match on the full content — a sound accept. (A bare `$` anywhere would
   *   let the pattern assert "end of content" at the window's cut point,
   *   which is not the content's end — so `$` disqualifies head evaluation.)
   * - Symmetrically, a pattern ending in a bare `$` with no bare `^` is
   *   evaluated against the tail: the tail's end IS the content's end, so the
   *   `$` assertion is truthful there, and with no `^` the pattern makes no
   *   start-of-content claim.
   * - Everything else — unanchored patterns, `^…$` patterns that assert
   *   about the entire content, and any pattern carrying a boundary/lookaround
   *   assertion (`\b`, `\B`, `(?=`, `(?!`, `(?<=`, `(?<!`, flagged by
   *   {@link scanAnchors} as `hasAssertion`) — cannot be soundly decided from
   *   an excerpt and fails secure. A boundary assertion is judged relative to
   *   the string's edge, so inside a strict prefix/suffix window it can see a
   *   boundary the full content does not have, which would make a window match
   *   a false accept. (Whole-source patterns still evaluate exactly: when the
   *   content fits one window, normalisation promotes it to `Matchable.content`
   *   and this method is never reached.)
   *
   * The asymmetry that makes this correct: an anchored MATCH inside its
   * strict prefix/suffix window is authoritative, but a window NON-match is
   * NOT a confident deny — a `^`-anchored pattern's match may extend beyond
   * the excerpt (e.g. `^.*checkout` deciding at char 500), so a non-match
   * fails secure as "not evaluable" rather than pretending the full content
   * was checked. Determining a pattern's guaranteed match length statically
   * would be needed for a sound deny, and that is deliberately not attempted.
   */
  private evaluateEvidence(evidence: ContentWindowEvidence): AuthorizationResult {
    const { startsWithCaret, endsWithDollar, hasBareCaret, hasBareDollar, hasAssertion } = scanAnchors(this.pattern.source)

    // A boundary/lookaround assertion disqualifies BOTH windows: its truth is
    // relative to the string edge, so a window match cannot be trusted.
    const headEvaluable = startsWithCaret && !hasBareDollar && !hasAssertion
    const tailEvaluable = endsWithDollar && !hasBareCaret && !hasAssertion

    if (!headEvaluable && !tailEvaluable) {
      return {
        authorized: false,
        reason: `content evidence is a bounded excerpt (anchored head/tail windows); pattern is not evaluable against it (requires a ^-anchored pattern without $, or a $-anchored pattern without ^, and no boundary/lookaround assertion): ${this.pattern.source}`,
      }
    }

    if ((headEvaluable && this.pattern.test(evidence.head)) || (tailEvaluable && this.pattern.test(evidence.tail))) {
      // Sound accept: an anchored match inside a strict prefix/suffix window
      // is a true match on the full content (see soundness rules above).
      return { authorized: true }
    }

    return {
      authorized: false,
      reason: `content evidence is a bounded excerpt (anchored head/tail windows); the anchored pattern did not match within its window and a match beyond the excerpt cannot be ruled out — failing secure: ${this.pattern.source}`,
    }
  }
}
