import type { InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventoryScriptInfo } from '../types/inventory/raw'
import { createMatcher } from '../types/matcher/matcher-factory'
import type { ScriptInfo } from '../types/script'
import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { escapeRegex } from './string'

/**
 * Converts a ScriptInfo to InventoryScriptInfo for new script discovery.
 *
 * Updated for Phase 3:
 * - identifyWith: NameMatcher with escaped exact URL/ID match
 * - authoriseWith: HashMatcher with single hash entry
 * - This is used during inventory workflow when discovering new scripts
 */
export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  const scriptSource = getScriptSource(scriptInfo)
  const escapedPattern = `^${escapeRegex(scriptSource)}$`

  return {
    identifyWith: createMatcher({ nameMatcher: escapedPattern }),
    authoriseWith: createMatcher({ hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)] }),
    authorisationInfo: {
      description: 'NO_DESCRIPTION',
      authorised: false,
      date: date,
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
 * - Matchers are validated by Zod schema before this function is called
 * - Replaces old nameMatcher/contentMatcher/hashes field conversion
 */
export function rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScriptInfo: RawInventoryScriptInfo): InventoryScriptInfo {
  return {
    identifyWith: createMatcher(rawInventoryScriptInfo.identifyWith),
    authoriseWith: createMatcher(rawInventoryScriptInfo.authoriseWith),
    authorisationInfo: rawInventoryScriptInfo.authorisationInfo,
  }
}

/**
 * Converts InventoryScriptInfo (with Matcher instances) back to RawInventoryScriptInfo (for JSON serialization).
 *
 * Updated for Phase 3:
 * - Extracts matcher patterns/hashes from Matcher instances using getPattern()
 * - Reconstructs identifyWith and authoriseWith config objects
 * - Used when pushing inventory updates back to Git
 */
export function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo {
  // Helper function to convert Matcher back to RawMatcherConfig
  function matcherToConfig(matcher: InventoryScriptInfo['identifyWith']): RawInventoryScriptInfo['identifyWith'] {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'name':
        return { nameMatcher: pattern as string }
      case 'content':
        return { contentMatcher: pattern as string }
      case 'hash':
        // pattern is InventoryScriptHashInfo[]
        return { hashes: pattern as import('../types/inventory/model').InventoryScriptHashInfo[] }
      default:
        throw new Error(`Unknown matcher type: ${matcherType}`)
    }
  }

  return {
    identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
    authoriseWith: matcherToConfig(inventoryScriptInfo.authoriseWith),
    authorisationInfo: inventoryScriptInfo.authorisationInfo,
  }
}
