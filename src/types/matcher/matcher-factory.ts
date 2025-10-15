/**
 * Matcher Factory
 *
 * Creates matcher instances from configuration (MatcherConfig from inventory JSON).
 * Abstracts the creation logic and ensures type safety.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for MatcherConfig schema
 */

import type { InventoryScriptHashInfo } from '../inventory/model'
import type { Matcher } from './matcher.interface'
import { NameMatcher } from './name-matcher'
import { ContentMatcher } from './content-matcher'
import { HashMatcher } from './hash-matcher'

/**
 * Configuration for creating a matcher instance.
 * Corresponds to inventory JSON schema.
 *
 * Note: This type is duplicated from matcher-config-schema.ts (RawMatcherConfig)
 * to avoid circular dependencies. The Zod schema is the source of truth for validation.
 */
export type MatcherConfig =
  | { nameMatcher: string }
  | { contentMatcher: string }
  | { hashes: InventoryScriptHashInfo[] }

/**
 * Factory function for creating matcher instances from configuration.
 *
 * @param config - Matcher configuration from inventory JSON (validated by Zod schema)
 * @returns Concrete matcher implementation (NameMatcher, ContentMatcher, or HashMatcher)
 * @throws Error if config is invalid (should be prevented by Zod schema validation)
 *
 * Example:
 * ```typescript
 * const nameMatcher = createMatcher({ nameMatcher: '^https://example.com/.*$' })
 * const contentMatcher = createMatcher({ contentMatcher: 'fbq\\(\'init\'' })
 * const hashMatcher = createMatcher({ hashes: [{ value: 'abc123...' }] })
 * ```
 */
export function createMatcher(config: MatcherConfig): Matcher {
  if ('nameMatcher' in config) {
    return new NameMatcher(config.nameMatcher)
  }

  if ('contentMatcher' in config) {
    return new ContentMatcher(config.contentMatcher)
  }

  if ('hashes' in config) {
    return new HashMatcher(config.hashes)
  }

  // This should never happen if Zod schema validation is working
  throw new Error('Invalid MatcherConfig: must have nameMatcher, contentMatcher, or hashes')
}
