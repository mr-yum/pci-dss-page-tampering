/**
 * Matcher Module Exports
 *
 * Central export point for all matcher-related types and implementations.
 */

export type { Matcher, DetectedScript } from './matcher.interface'
export type { AuthorizationResult } from './authorization-result'
export type { MatcherConfig } from './matcher-factory'

export { NameMatcher } from './name-matcher'
export { ContentMatcher } from './content-matcher'
export { HashMatcher } from './hash-matcher'
export { createMatcher } from './matcher-factory'
