/**
 * Matcher Factory
 *
 * Creates matcher instances from configuration (MatcherConfig from inventory JSON).
 * Abstracts the creation logic and ensures type safety.
 *
 * @see ../../../specs/001-refactor-script-identification/data-model.md for MatcherConfig schema
 */

import type { InventoryScriptHashInfo } from '../inventory/model.js'
import { AndMatcher } from './and-matcher.js'
import { ContentMatcher } from './content-matcher.js'
import { CspDirectiveMatcher } from './csp-directive-matcher.js'
import { HashMatcher } from './hash-matcher.js'
import { HeaderNameMatcher } from './header-name-matcher.js'
import { HostMatcher } from './host-matcher.js'
import type { AuthorisationInfo, Matcher } from './matcher.interface.js'
import { NameMatcher } from './name-matcher.js'
import { OrMatcher } from './or-matcher.js'
import { TargetTypeMatcher } from './target-type-matcher.js'
import { UrlMatcher } from './url-matcher.js'
import { WorkflowMatcher } from './workflow-matcher.js'

/**
 * Raw authorization info as it appears in JSON (with string date).
 * Will be converted to AuthorisationInfo (with Date object) during matcher creation.
 */
type RawAuthorisationInfo = {
  description: string
  authorised: boolean
  date: string
}

/**
 * Converts raw authorization info (with string date) to AuthorisationInfo (with Date object).
 * Handles the date conversion needed during deserialization.
 */
function convertAuthorisationInfo(raw: RawAuthorisationInfo | undefined): AuthorisationInfo | undefined {
  if (!raw) {
    return undefined
  }
  return {
    description: raw.description,
    authorised: raw.authorised,
    date: new Date(raw.date),
  }
}

/**
 * Configuration for creating a matcher instance.
 * Corresponds to inventory JSON schema.
 *
 * Note: This type is duplicated from matcher-config-schema.ts (RawMatcherConfig)
 * to avoid circular dependencies. The Zod schema is the source of truth for validation.
 *
 * Enhanced with AuthorisationMatcher support:
 * - All matchers (except HeaderNameMatcher for identification) can have optional authorisationInfo
 * - Composite matchers (OrMatcher, AndMatcher) support nested authorisationInfo at any level
 * - Authorization metadata is preserved exactly as specified in inventory files
 * - AuthorisationInfo has string dates (from JSON), converted to Date objects in constructors
 */
export type MatcherConfig =
  | { nameMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { headerNameMatcher: string }
  | { contentMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { hostMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { urlMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { workflowMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { targetTypeMatcher: string; authorisationInfo?: RawAuthorisationInfo }
  | { cspDirectiveMatcher: { directive: string; allow: string[] }; authorisationInfo?: RawAuthorisationInfo }
  | { hashes: InventoryScriptHashInfo[]; authorisationInfo?: RawAuthorisationInfo }
  | { orMatcher: MatcherConfig[]; authorisationInfo?: RawAuthorisationInfo }
  | { andMatcher: MatcherConfig[]; authorisationInfo?: RawAuthorisationInfo }

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
  // Leaf matchers
  if ('nameMatcher' in config) {
    return new NameMatcher(config.nameMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('headerNameMatcher' in config) {
    return new HeaderNameMatcher(config.headerNameMatcher)
  }

  if ('contentMatcher' in config) {
    return new ContentMatcher(config.contentMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('hostMatcher' in config) {
    return new HostMatcher(config.hostMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('urlMatcher' in config) {
    return new UrlMatcher(config.urlMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('workflowMatcher' in config) {
    return new WorkflowMatcher(config.workflowMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('targetTypeMatcher' in config) {
    return new TargetTypeMatcher(config.targetTypeMatcher, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('cspDirectiveMatcher' in config) {
    return new CspDirectiveMatcher(config.cspDirectiveMatcher.directive, config.cspDirectiveMatcher.allow, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('hashes' in config) {
    return new HashMatcher(config.hashes, convertAuthorisationInfo(config.authorisationInfo))
  }

  // Composite matchers
  if ('orMatcher' in config) {
    // Recursively create child matchers (they can have their own authorisationInfo)
    const children = config.orMatcher.map((childConfig) => createMatcher(childConfig))
    return new OrMatcher(children, convertAuthorisationInfo(config.authorisationInfo))
  }

  if ('andMatcher' in config) {
    // Recursively create child matchers (they can have their own authorisationInfo)
    const children = config.andMatcher.map((childConfig) => createMatcher(childConfig))
    return new AndMatcher(children, convertAuthorisationInfo(config.authorisationInfo))
  }

  // This should never happen if Zod schema validation is working
  throw new Error(`Invalid MatcherConfig: unknown matcher configuration: ${JSON.stringify(config)}`)
}
