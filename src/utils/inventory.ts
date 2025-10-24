import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventory, RawInventoryHeaderInfo } from '../types/inventory/raw'
import { processAuthorizeWith } from '../types/inventory/zod'
import { createMatcher } from '../types/matcher/matcher-factory'
import { inventoryScriptInfoToRawInventoryScriptInfo } from './script'

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
 * Updated for Phase 5 - US3:
 * - Extracts matcher patterns from Matcher instances using getPattern()
 * - Reconstructs identifyWith and authoriseWith config objects
 * - Spreads matcher config alongside authorisationInfo in authoriseWith
 * - Used when pushing inventory updates back to Git
 */
export function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo {
  // Helper function to convert Matcher back to RawMatcherConfig
  function matcherToConfig(matcher: InventoryHeaderInfo['identifyWith']): RawInventoryHeaderInfo['identifyWith'] {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'header-name':
        return { headerNameMatcher: pattern as string }
      case 'name':
        return { nameMatcher: pattern as string }
      case 'content':
        return { contentMatcher: pattern as string }
      case 'hash':
        // pattern is InventoryScriptHashInfo[] - not used for headers but included for completeness
        return { hashes: pattern as import('../types/inventory/model').InventoryScriptHashInfo[] }
      default:
        throw new Error(`Unknown matcher type: ${matcherType}`)
    }
  }

  // Convert matcher to config and spread into authoriseWith alongside authorisationInfo
  const matcherConfig = matcherToConfig(headerInfo.authoriseWith.matcher)

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
