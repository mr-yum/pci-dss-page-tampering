import type { Inventory } from '../../types/inventory/model'
import type { ScriptMatcher } from '../../types/matcher'

/**
 * Extracts content matchers from inventory for inline script detection.
 *
 * Phase 4 Update: Works with new matcher-based inventory structure.
 * Returns scripts where identifyWith is a ContentMatcher (for inline script detection).
 */
export function getScriptContentMatchersFromInventory(payload: Inventory): ScriptMatcher[] {
  return payload.scripts
    .filter((script) => {
      // Only include scripts that use contentMatcher for identification
      // These are typically inline scripts identified by their content patterns
      return script.identifyWith.getType() === 'content'
    })
    .map<ScriptMatcher>((script) => {
      const identifyPattern = script.identifyWith.getPattern() as string
      const authorizePattern = script.authoriseWith.getType() === 'content' ? (script.authoriseWith.getPattern() as string) : identifyPattern // Fallback to identify pattern if authorize is not content-based

      return {
        nameMatcher: new RegExp(identifyPattern),
        contentMatcher: new RegExp(authorizePattern),
      }
    })
}
