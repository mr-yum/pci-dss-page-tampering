/**
 * Matcher Factory
 *
 * Creates matcher instances from configuration (MatcherConfig from inventory JSON).
 * Abstracts the creation logic and ensures type safety.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for MatcherConfig schema
 */

import type { InventoryAuthorisationInfo, InventoryScriptHashInfo } from '../inventory/model'
import { ContentMatcher } from './content-matcher'
import { HashMatcher } from './hash-matcher'
import { HeaderNameMatcher } from './header-name-matcher'
import type { Matcher } from './matcher.interface'
import { NameMatcher } from './name-matcher'
import { OrMatcher } from './or-matcher'
import { AndMatcher } from './and-matcher'

/**
 * Configuration for creating a matcher instance.
 * Corresponds to inventory JSON schema.
 *
 * Note: This type is duplicated from matcher-config-schema.ts (RawMatcherConfig)
 * to avoid circular dependencies. The Zod schema is the source of truth for validation.
 *
 * Enhanced with composite matcher support (OrMatcher, AndMatcher):
 * - orMatcher: Array of child matchers (any child matches)
 * - andMatcher: Array of child matchers (all children match)
 * - Both support optional authorisationInfo for top-level override
 */
export type MatcherConfig =
  | { nameMatcher: string }
  | { headerNameMatcher: string }
  | { contentMatcher: string }
  | { hashes: InventoryScriptHashInfo[] }
  | { orMatcher: MatcherConfig[]; authorisationInfo?: InventoryAuthorisationInfo }
  | { andMatcher: MatcherConfig[]; authorisationInfo?: InventoryAuthorisationInfo }

/**
 * Factory function for creating matcher instances from configuration.
 *
 * Supports recursive creation of composite matchers (OrMatcher, AndMatcher).
 * Each composite matcher can contain child matchers of any type, including other composites.
 *
 * @param config - Matcher configuration from inventory JSON (validated by Zod schema)
 * @returns Concrete matcher implementation (leaf or composite)
 * @throws Error if config is invalid (should be prevented by Zod schema validation)
 *
 * Example:
 * ```typescript
 * // Leaf matchers
 * const nameMatcher = createMatcher({ nameMatcher: '^https://example.com/.*$' })
 * const headerMatcher = createMatcher({ headerNameMatcher: '^content-type$' })
 * const contentMatcher = createMatcher({ contentMatcher: 'fbq\\(\'init\'' })
 * const hashMatcher = createMatcher({ hashes: [{ value: 'abc123...' }] })
 *
 * // Composite matchers
 * const orMatcher = createMatcher({
 *   orMatcher: [
 *     { contentMatcher: 'pattern1' },
 *     { contentMatcher: 'pattern2' }
 *   ],
 *   authorisationInfo: { description: '...', authorised: true, date: new Date() }
 * })
 *
 * const andMatcher = createMatcher({
 *   andMatcher: [
 *     { contentMatcher: 'required1' },
 *     { contentMatcher: 'required2' }
 *   ]
 * })
 * ```
 */
export function createMatcher(config: MatcherConfig): Matcher {
  // Leaf matchers (existing)
  if ('nameMatcher' in config) {
    return new NameMatcher(config.nameMatcher)
  }

  if ('headerNameMatcher' in config) {
    return new HeaderNameMatcher(config.headerNameMatcher)
  }

  if ('contentMatcher' in config) {
    return new ContentMatcher(config.contentMatcher)
  }

  if ('hashes' in config) {
    return new HashMatcher(config.hashes)
  }

  // Composite matchers (new)
  if ('orMatcher' in config) {
    // Recursively create child matchers
    const children = config.orMatcher.map((childConfig) => createMatcher(childConfig))
    return new OrMatcher(children, config.authorisationInfo)
  }

  if ('andMatcher' in config) {
    // Recursively create child matchers
    const children = config.andMatcher.map((childConfig) => createMatcher(childConfig))
    return new AndMatcher(children, config.authorisationInfo)
  }

  // This should never happen if Zod schema validation is working
  throw new Error(
    'Invalid MatcherConfig: must have nameMatcher, headerNameMatcher, contentMatcher, hashes, orMatcher, or andMatcher',
  )
}
