/**
 * Matcher Module Exports
 *
 * Central export point for all matcher-related types and implementations.
 */

export type { Matcher, DetectedScript } from './matcher.interface.js'
export type { AuthorizationResult } from './authorization-result.js'
export type { MatcherConfig } from './matcher-factory.js'

export { NameMatcher } from './name-matcher.js'
export { ContentMatcher } from './content-matcher.js'
export { HashMatcher } from './hash-matcher.js'
export { createMatcher } from './matcher-factory.js'
