import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model'
import type { IScriptComparisonService } from '../../interfaces/comparison'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../../types/comparison'
import type { Target } from '../../types/target'

import { getScriptSource } from '../../utils/script'
import type { ScriptMatcher } from '../../types/matcher'

export class ScriptComparisonService implements IScriptComparisonService {
  /*
  Returns scripts that match the following conditions:
    - Not found in inventory
    - Found in inventory and authorised but hash doesn't exist and doesn't have any content matches
   */
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptComparisonSummary> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.externalScripts
    const detectedInlineScripts = scriptDetectionSummary.inlineScripts

    const externalScriptsComparisonResult = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts, target, scriptContentMatchers)
    const inlineScriptsComparisonResult = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts, target, scriptContentMatchers)

    return Promise.resolve({
      target: target,
      externalScripts: externalScriptsComparisonResult,
      inlineScripts: inlineScriptsComparisonResult,
    })
  }

  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target, contentMatchers: ScriptMatcher[]): ScriptComparisonResult {
    const newScripts: ScriptInfo[] = []
    const newHashes: ScriptInfo[] = []

    detectedScripts.forEach((script) => {
      const scriptSourceValue = getScriptSource(script)
      // Push detected script if there is no existing match found in inventory
      if (!this.scriptExistsInInventory(script, inventoryScripts)) {
        console.log(`[Comparison → Script]: Script '${scriptSourceValue}' not found in inventory for target '${target.url}'.`)
        newScripts.push(script)
      }

      // There is a match found in inventory for the detected script
      else {
        const isDetectedScriptAuthorised = this.getScriptFromInventory(script, inventoryScripts)

        // The detected script is authorised, add hash if it doesn't exist
        if (isDetectedScriptAuthorised) {
          const hashExists = this.scriptHashExists(script, isDetectedScriptAuthorised)
          const contentMatchExists = this.scriptContentHasMatch(script, contentMatchers)

          if (!hashExists && !contentMatchExists) {
            console.log(`[Comparison → Script]: Script '${scriptSourceValue}' found in inventory, but hash '${script.hash.value}' doesn't exist for target '${target.url}'.`)
            newHashes.push(script)
          }
        }
      }
    })

    return {
      newScripts: newScripts,
      newHashes: newHashes,
    }
  }

  private scriptExistsInInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): boolean {
    return inventoryScripts.some((inventoryScript) => inventoryScript.nameMatcher.test(getScriptSource(scriptInfo)))
  }

  private getScriptFromInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo | undefined {
    return inventoryScripts.find((inventoryScript) => inventoryScript.nameMatcher.test(getScriptSource(scriptInfo)) && inventoryScript.authorisationInfo.authorised)
  }

  private scriptHashExists(scriptInfo: ScriptInfo, inventoryScript: InventoryScriptInfo): boolean {
    return inventoryScript.hashes.some((hashInfo) => hashInfo.hash.value === scriptInfo.hash.value)
  }

  private scriptContentHasMatch(scriptInfo: ScriptInfo, scriptContentMatchers: ScriptMatcher[]): ScriptMatcher | undefined {
    return scriptContentMatchers.find((matcher) => matcher.nameMatcher.test(getScriptSource(scriptInfo)) && matcher.contentMatcher.test(getScriptSource(scriptInfo)))
  }
}
