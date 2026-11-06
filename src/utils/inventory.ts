import type { Inventory, InventoryAuthorisationInfo, InventoryHeaderInfo, InventoryScriptInfo, InventoryWorkflow } from '../types/inventory/model.js'
import type { RawInventory, RawInventoryHeaderInfo, RawInventoryWorkflow } from '../types/inventory/raw.js'
import { processAuthorizeWith } from '../types/inventory/zod.js'
import type { Matcher } from '../types/matcher/matcher.interface.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { inventoryScriptInfoToRawInventoryScriptInfo } from './script.js'

/**
 * Serializes authorization metadata to JSON-compatible format.
 * Converts Date instances to ISO 8601 strings for JSON persistence.
 *
 * @param info - Authorization metadata with Date instance
 * @returns JSON-serializable object with ISO date string
 */
/** Same approval: description, flag and instant. */
function sameAuthorisationInfo(left: InventoryAuthorisationInfo | undefined, right: InventoryAuthorisationInfo): boolean {
  return left !== undefined && left.description === right.description && left.authorised === right.authorised && left.date.getTime() === right.date.getTime()
}

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
    // Carried through explicitly: this function enumerates fields, so a new one
    // is silently dropped unless listed. The auditor report needs the source
    // text to resolve matcher line numbers.
    source: inventory.source,
    // Same reason: push needs it to write `{ "matcherRef" }` back instead of the expansion.
    matcherRefs: inventory.matcherRefs,
  }
}

export function inventoryToRawInventory(inventory: Inventory): RawInventory {
  const workflowToRaw = (workflow: InventoryWorkflow): RawInventoryWorkflow => ({
    id: workflow.id,
    inventory: {
      type: workflow.inventory.type,
      ...(workflow.inventory.name !== undefined && { name: workflow.inventory.name }),
      url: workflow.inventory.url,
      workflow: workflow.inventory.workflow.fileName,
    },
    detection: {
      type: workflow.detection.type,
      ...(workflow.detection.name !== undefined && { name: workflow.detection.name }),
      url: workflow.detection.url,
      workflow: workflow.detection.workflow.fileName,
    },
  })

  const rawTarget: RawInventory['target'] =
    inventory.target.workflows !== undefined
      ? { workflows: inventory.target.workflows.map(workflowToRaw) }
      : (() => {
          const rawWorkflow = workflowToRaw({ id: 'default', inventory: inventory.target.inventory, detection: inventory.target.detection })
          return { inventory: rawWorkflow.inventory, detection: rawWorkflow.detection }
        })()

  return {
    target: rawTarget,
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
    ...(rawHeaderInfo.requiredOn !== undefined ? { requiredOn: rawHeaderInfo.requiredOn } : {}),
  }
}

/**
 * Converts one Matcher back to its raw (JSON) config.
 *
 * `isTopLevelAuthoriseWith`: the matcher is an entry's top-level `authoriseWith`, where an
 * OrMatcher is written in array syntax. Exported so `collapseMatcherRefs` can put a shared
 * definition through exactly the serialiser the entry it is compared with went through.
 */
export function headerMatcherToRawConfig(matcher: Matcher, isTopLevelAuthoriseWith = false): any {
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
    case 'csp-directive': {
      const csp = matcher as unknown as { getDirective(): string; getAllowedSources(): readonly string[] }
      const config: any = { cspDirectiveMatcher: { directive: csp.getDirective(), allow: [...csp.getAllowedSources()] } }
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
    case 'initiator-host': {
      // The transitive form round-trips as its object form; the string form stays a string.
      const options = (matcher as unknown as { getOptions?: () => { transitive: true; maxDepth?: number; kinds?: string[] } | undefined }).getOptions?.()
      const config: any = { initiatorHostMatcher: options === undefined ? (pattern as string) : { host: pattern as string, ...options } }
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
    case 'workflow': {
      const config: any = { workflowMatcher: pattern as string }
      const authInfo = (matcher as any).getAuthorisationInfo?.()
      if (authInfo) config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      return config
    }
    case 'targetType': {
      const config: any = { targetTypeMatcher: pattern as string }
      const authInfo = (matcher as any).getAuthorisationInfo?.()
      if (authInfo) config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      return config
    }
    case 'hash': {
      const config: any = { hashes: pattern as import('../types/inventory/model.js').InventoryScriptHashInfo[] }
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
        return children.map((child) => headerMatcherToRawConfig(child, false))
      }

      // Nested OrMatcher: use orMatcher format
      const config: any = {
        orMatcher: children.map((c) => headerMatcherToRawConfig(c, false)),
      }
      if (authInfo) {
        config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      }
      return config
    }
    case 'and': {
      const children = pattern as import('../types/matcher/matcher.interface.js').Matcher[]
      const config: any = {
        andMatcher: children.map((c) => headerMatcherToRawConfig(c, false)),
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
  // Special handling for top-level OrMatcher in authoriseWith
  if (headerInfo.authoriseWith.matcher.getType() === 'or') {
    const topLevelMatcherAuthInfo = (headerInfo.authoriseWith.matcher as any).getAuthorisationInfo?.()

    // Array syntax only when every alternative carries its own authorisationInfo — the
    // schema requires one on each array element. An authoriseWith written as
    // `{ orMatcher: [...], authorisationInfo }` (or expanded from a matcherRef whose definition
    // is an orMatcher) loads as an OrMatcher whose children carry none, because the
    // entry-level info is lifted off the root; writing that as array syntax would drop the
    // entry's authorisation and produce a file that no longer validates.
    //
    // And only when the entry-level info IS the first alternative's: array syntax
    // loads with element [0]'s info as the entry's, so writing an entry whose own
    // approval differs (`{ orMatcher: [approved, approved], authorisationInfo:
    // pending }`) as an array would silently approve it on the next load.
    const children = headerInfo.authoriseWith.matcher.getPattern() as Matcher[]
    const everyChildCarriesInfo = children.every((child) => (child as any).getAuthorisationInfo?.() !== undefined)
    if (!topLevelMatcherAuthInfo && everyChildCarriesInfo && sameAuthorisationInfo((children[0] as any)?.getAuthorisationInfo?.(), headerInfo.authoriseWith.authorisationInfo)) {
      // Array syntax - no authorisationInfo on the matcher itself
      const arrayConfig = headerMatcherToRawConfig(headerInfo.authoriseWith.matcher, true)
      return {
        identifyWith: headerMatcherToRawConfig(headerInfo.identifyWith),
        authoriseWith: arrayConfig,
        ...(headerInfo.requiredOn !== undefined ? { requiredOn: headerInfo.requiredOn } : {}),
      }
    }
    // Fall through to the orMatcher format, carrying the entry-level authorisationInfo
  }

  // For non-OrMatcher top-level matchers (or OrMatcher with its own authInfo), use standard format
  const matcherConfig = headerMatcherToRawConfig(headerInfo.authoriseWith.matcher, false)

  return {
    identifyWith: headerMatcherToRawConfig(headerInfo.identifyWith),
    authoriseWith: {
      ...matcherConfig,
      authorisationInfo: {
        description: headerInfo.authoriseWith.authorisationInfo.description,
        authorised: headerInfo.authoriseWith.authorisationInfo.authorised,
        date: headerInfo.authoriseWith.authorisationInfo.date.toISOString(),
      },
    },
    ...(headerInfo.requiredOn !== undefined ? { requiredOn: headerInfo.requiredOn } : {}),
  }
}
