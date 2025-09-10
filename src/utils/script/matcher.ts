import type { ScriptMatcher } from '../../types/matcher'
import type { Inventory } from '../../types/inventory/model'

export function getScriptContentMatchersFromInventory(payload: Inventory): ScriptMatcher[] {
  return payload.scripts
    .filter((script) => script.contentMatcher !== undefined)
    .map<ScriptMatcher>((script) => {
      return {
        nameMatcher: script.nameMatcher,
        contentMatcher: script.contentMatcher!,
      }
    })
}
