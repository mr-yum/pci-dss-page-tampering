import type { InventoryAuthorisationInfo, InventoryScriptInfo } from '../types/inventory/model.js'
import type { RawInventoryScriptInfo } from '../types/inventory/raw.js'
import { processAuthorizeWith } from '../types/inventory/zod.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { ScriptInfo } from '../types/script.js'
import { scriptHashToInventoryHashInfo } from '../utils/hash.js'
import { escapeRegex } from './string.js'

/**
 * Serializes authorization metadata to JSON-compatible format.
 * Converts Date instances to ISO 8601 strings for JSON persistence.
 *
 * @param info - Authorization metadata with Date instance
 * @returns JSON-serializable object with ISO date string
 */
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): { description: string; authorised: boolean; date: string } {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString(),
  }
}

/**
 * Converts a ScriptInfo to InventoryScriptInfo for new script discovery.
 *
 * Updated for Phase 3:
 * - identifyWith: NameMatcher with escaped exact URL/ID match
 * - authoriseWith: AuthorizeWithConfig composite structure (matcher + authorization metadata)
 * - This is used during inventory workflow when discovering new scripts
 */
export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  const scriptSource = getScriptSource(scriptInfo)
  const escapedPattern = `^${escapeRegex(scriptSource)}$`

  return {
    identifyWith: createMatcher({ nameMatcher: escapedPattern }),
    authoriseWith: {
      matcher: createMatcher({ hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)] }),
      authorisationInfo: {
        description: 'NO_DESCRIPTION',
        authorised: false,
        date: date,
      },
    },
  }
}

export function getScriptSource(scriptInfo: ScriptInfo): string {
  let scriptSourceContent: string

  switch (scriptInfo.source.type) {
    case 'external':
      scriptSourceContent = scriptInfo.source.url
      break
    case 'inline':
      scriptSourceContent = scriptInfo.source.id
      break
  }

  return scriptSourceContent
}

/**
 * Converts RawInventoryScriptInfo (from JSON) to InventoryScriptInfo (with Matcher instances).
 *
 * Updated for Phase 3:
 * - Creates Matcher instances from identifyWith and authoriseWith configs using matcher factory
 * - Uses processAuthorizeWith to handle both single matcher and array syntax (FR-006)
 * - Array syntax is automatically converted to OrMatcher
 * - Matchers are validated by Zod schema before this function is called
 * - Replaces old nameMatcher/contentMatcher/hashes field conversion
 */
export function rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScriptInfo: RawInventoryScriptInfo): InventoryScriptInfo {
  return {
    identifyWith: createMatcher(rawInventoryScriptInfo.identifyWith),
    authoriseWith: processAuthorizeWith(rawInventoryScriptInfo.authoriseWith),
  }
}

/**
 * Converts InventoryScriptInfo (with Matcher instances) back to RawInventoryScriptInfo (for JSON serialization).
 *
 * Updated for Phase 3 + Phase 7:
 * - Extracts matcher patterns/hashes from Matcher instances using getPattern()
 * - Reconstructs identifyWith and authoriseWith config objects
 * - Uses array syntax for top-level OrMatcher in authoriseWith (more concise)
 * - Uses orMatcher format for nested OrMatchers (within composites)
 * - Spreads matcher config alongside authorisationInfo in authoriseWith
 * - Used when pushing inventory updates back to Git
 */
export function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo {
  // Helper function to convert Matcher back to RawMatcherConfig
  // isTopLevelAuthoriseWith: true if this is the top-level authoriseWith matcher (use array syntax for OrMatcher)
  function matcherToConfig(matcher: InventoryScriptInfo['identifyWith'], isTopLevelAuthoriseWith = false): any {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'name': {
        const config: any = { nameMatcher: pattern as string }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'content': {
        const config: any = { contentMatcher: pattern as string }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'host': {
        const config: any = { hostMatcher: pattern as string }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'url': {
        const config: any = { urlMatcher: pattern as string }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'hash': {
        // Shallow-clone the hashes array. HashMatcher.getPattern() returns its
        // internal `authorizedHashes` by reference; without the clone, callers
        // that mutate `config.hashes` (e.g. inventory diff appending a new hash)
        // silently corrupt the matcher's internal state and therefore the
        // *old* inventory entry too — leaving `buildInventoryCommitMessage`
        // unable to see any difference between old and new while alerts had
        // already buffered the result as "applied".
        const config: any = { hashes: [...(pattern as import('../types/inventory/model.js').InventoryScriptHashInfo[])] }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'or': {
        const children = pattern as import('../types/matcher/matcher.interface.js').Matcher[]
        const authInfo = (matcher as any).getAuthorisationInfo?.()

        // Top-level OrMatcher in authoriseWith: use array syntax (more concise)
        if (isTopLevelAuthoriseWith) {
          // Return array of child configs, each with its own authorisationInfo
          return children.map((child) => matcherToConfig(child, false))
        }

        // Nested OrMatcher: use orMatcher format
        const config: any = {
          orMatcher: children.map((c) => matcherToConfig(c, false)),
        }
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'and': {
        const children = pattern as import('../types/matcher/matcher.interface.js').Matcher[]
        const config: any = {
          andMatcher: children.map((c) => matcherToConfig(c, false)),
        }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      default:
        throw new Error(`Unknown matcher type: ${matcherType}`)
    }
  }

  // Special handling for top-level OrMatcher in authoriseWith
  if (inventoryScriptInfo.authoriseWith.matcher.getType() === 'or') {
    const topLevelMatcherAuthInfo = (inventoryScriptInfo.authoriseWith.matcher as any).getAuthorisationInfo?.()

    // Use array syntax if the OrMatcher itself doesn't have authorisationInfo
    // Use orMatcher syntax if the OrMatcher has authorisationInfo (needs carrier)
    if (!topLevelMatcherAuthInfo) {
      // Array syntax - no authorisationInfo on the matcher itself
      const arrayConfig = matcherToConfig(inventoryScriptInfo.authoriseWith.matcher, true)
      return {
        identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
        authoriseWith: arrayConfig,
      }
    }
    // Fall through to use orMatcher format (OrMatcher has its own authorisationInfo)
  }

  // For non-OrMatcher top-level matchers (or OrMatcher with its own authInfo), use standard format
  const matcherConfig = matcherToConfig(inventoryScriptInfo.authoriseWith.matcher, false)

  return {
    identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
    authoriseWith: {
      ...matcherConfig,
      authorisationInfo: {
        description: inventoryScriptInfo.authoriseWith.authorisationInfo.description,
        authorised: inventoryScriptInfo.authoriseWith.authorisationInfo.authorised,
        date: inventoryScriptInfo.authoriseWith.authorisationInfo.date.toISOString(),
      },
    },
  }
}
