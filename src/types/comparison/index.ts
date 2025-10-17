/**
 * Comparison Result Types
 *
 * Exports all comparison result classes and the union type for exhaustive type checking.
 *
 * @see specs/001-refactor-script-identification/data-model.md for entity definitions
 * @see specs/001-refactor-script-identification/research.md (R3) for design rationale
 */

// Script comparison results
export { ComparisonResult } from './comparison-result'
export { UnknownScriptFound } from './unknown-script-found'
export { KnownScriptWithUnauthorisedContentFound } from './known-script-unauthorised-content-found'
export { AuthorizedScriptFound } from './authorized-script-found'

// Header comparison results
export { UnknownHeaderFound } from './unknown-header-found'
export { KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header } from './known-header-unauthorised-content-found'
export { AuthorizedHeaderFound } from './authorized-header-found'

// Type imports for union
import type { AuthorizedScriptFound } from './authorized-script-found'
import type { KnownScriptWithUnauthorisedContentFound } from './known-script-unauthorised-content-found'
import type { UnknownScriptFound } from './unknown-script-found'
import type { AuthorizedHeaderFound } from './authorized-header-found'
import type { KnownHeaderWithUnauthorisedContentFound as KnownHeaderWithUnauthorisedContentFound_Header } from './known-header-unauthorised-content-found'
import type { UnknownHeaderFound } from './unknown-header-found'

/**
 * Union type for all possible comparison results.
 * Enables exhaustive type checking in handlers via discriminated union.
 *
 * Example handler pattern:
 *
 * ```typescript
 * function handleResult(result: ComparisonResultType) {
 *   switch (result.type) {
 *     case 'unknown_script_found':
 *       // TypeScript narrows to UnknownScriptFound
 *       sendAlert({ script: result.script, target: result.target });
 *       break;
 *     case 'known_script_unauthorised_content':
 *       // TypeScript narrows to KnownScriptWithUnauthorisedContentFound
 *       sendAlert({
 *         script: result.script,
 *         reason: result.failureReason,
 *         expected: result.authorizationMatcher.getPattern()
 *       });
 *       break;
 *     case 'authorized_script':
 *       // No alert needed
 *       break;
 *   }
 * }
 * ```
 */
export type ComparisonResultType =
  | UnknownScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | AuthorizedScriptFound
  | UnknownHeaderFound
  | KnownHeaderWithUnauthorisedContentFound_Header
  | AuthorizedHeaderFound
