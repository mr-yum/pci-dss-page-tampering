import type { Inventory, InventoryAuthorisationInfo, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventory, RawInventoryHeaderInfo } from '../types/inventory/raw'
import { processAuthorizeWith } from '../types/inventory/zod'
import { createMatcher } from '../types/matcher/matcher-factory'
import { inventoryScriptInfoToRawInventoryScriptInfo } from './script'

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

export function copyInventory(inventory: Inventory, args?: { newScripts?: InventoryScriptInfo[]; newHeaders?: InventoryHeaderInfo[] }): Inventory {
  return {
    fileName: inventory.fileName,
    target: inventory.target,
    alerts: inventory.alerts,
    scripts: args?.newScripts ?? inventory.scripts,
    headers: args?.newHeaders ?? inventory.headers,
  }
}

export function inventoryToRawInventory(inventory: Inventory): RawInventory {
  return {
    target: {
      inventory: {
        type: inventory.target.inventory.type,
        ...(inventory.target.inventory.name !== undefined && { name: inventory.target.inventory.name }),
        url: inventory.target.inventory.url,
        workflow: inventory.target.inventory.workflow.fileName,
      },
      detection: {
        type: inventory.target.detection.type,
        ...(inventory.target.detection.name !== undefined && { name: inventory.target.detection.name }),
        url: inventory.target.detection.url,
        workflow: inventory.target.detection.workflow.fileName,
      },
    },
    alerts: inventory.alerts,
    scripts: inventory.scripts.map(inventoryScriptInfoToRawInventoryScriptInfo),
    headers: inventory.headers.map(inventoryHeaderInfoToRawInventoryHeaderInfo),
  }
}

/**
 * Converts RawInventoryHeaderInfo (from JSON) to InventoryHeaderInfo (with Matcher instances).
 *
 * Updated for Phase 5 - US3:
 * - Creates Matcher instances from identifyWith and authoriseWith configs using matcher factory
 * - Uses processAuthorizeWith to handle both single matcher and array syntax (FR-006)
 * - Array syntax is automatically converted to OrMatcher
 * - Matchers are validated by Zod schema before this function is called
 * - Replaces old nameMatcher/contentMatcher field conversion
 */
export function rawInventoryHeaderInfoToInventoryHeaderInfo(rawHeaderInfo: RawInventoryHeaderInfo): InventoryHeaderInfo {
  return {
    identifyWith: createMatcher(rawHeaderInfo.identifyWith),
    authoriseWith: processAuthorizeWith(rawHeaderInfo.authoriseWith),
  }
}

/**
 * Converts InventoryHeaderInfo (with Matcher instances) back to RawInventoryHeaderInfo (for JSON serialization).
 *
 * Updated for Phase 5 - US3 + Phase 7:
 * - Extracts matcher patterns from Matcher instances using getPattern()
 * - Reconstructs identifyWith and authoriseWith config objects
 * - Uses array syntax for top-level OrMatcher in authoriseWith (more concise)
 * - Uses orMatcher format for nested OrMatchers (within composites)
 * - Spreads matcher config alongside authorisationInfo in authoriseWith
 * - Used when pushing inventory updates back to Git
 */
export function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo {
  // Helper function to convert Matcher back to RawMatcherConfig
  // isTopLevelAuthoriseWith: true if this is the top-level authoriseWith matcher (use array syntax for OrMatcher)
  function matcherToConfig(matcher: InventoryHeaderInfo['identifyWith'], isTopLevelAuthoriseWith = false): any {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'header-name':
        return { headerNameMatcher: pattern as string }
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
        const config: any = { hashes: pattern as import('../types/inventory/model').InventoryScriptHashInfo[] }
        const authInfo = (matcher as any).getAuthorisationInfo?.()
        if (authInfo) {
          config.authorisationInfo = serializeAuthorisationInfo(authInfo)
        }
        return config
      }
      case 'or': {
        const children = pattern as import('../types/matcher/matcher.interface').Matcher[]
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
        const children = pattern as import('../types/matcher/matcher.interface').Matcher[]
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
  if (headerInfo.authoriseWith.matcher.getType() === 'or') {
    const topLevelMatcherAuthInfo = (headerInfo.authoriseWith.matcher as any).getAuthorisationInfo?.()

    // Use array syntax if the OrMatcher itself doesn't have authorisationInfo
    // Use orMatcher syntax if the OrMatcher has authorisationInfo (needs carrier)
    if (!topLevelMatcherAuthInfo) {
      // Array syntax - no authorisationInfo on the matcher itself
      const arrayConfig = matcherToConfig(headerInfo.authoriseWith.matcher, true)
      return {
        identifyWith: matcherToConfig(headerInfo.identifyWith),
        authoriseWith: arrayConfig,
      }
    }
    // Fall through to use orMatcher format (OrMatcher has its own authorisationInfo)
  }

  // For non-OrMatcher top-level matchers (or OrMatcher with its own authInfo), use standard format
  const matcherConfig = matcherToConfig(headerInfo.authoriseWith.matcher, false)

  return {
    identifyWith: matcherToConfig(headerInfo.identifyWith),
    authoriseWith: {
      ...matcherConfig,
      authorisationInfo: {
        description: headerInfo.authoriseWith.authorisationInfo.description,
        authorised: headerInfo.authoriseWith.authorisationInfo.authorised,
        date: headerInfo.authoriseWith.authorisationInfo.date.toISOString(),
      },
    },
  }
}
