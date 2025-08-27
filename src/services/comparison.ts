import type { Inventory, InventoryScriptInfo } from '../types/inventory/model'
import type { IScriptComparisonService } from '../interfaces/comparison'
import type { ScriptDetectionSummary, ScriptInfo } from '../types/script'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'
import type { Target } from '../types/target'

import { getScriptSource } from '../utils/script'

export class ScriptComparisonService implements IScriptComparisonService {
  /*
  Returns scripts that match the following conditions:
    - Not found in inventory
    - Found in inventory but hash doesn't exist
   */
  compare(target: Target, inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ScriptComparisonSummary> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.external
    const detectedInlineScripts = scriptDetectionSummary.inline

    const externalScriptsComparisonResult = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts, target)
    const inlineScriptsComparisonResult = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts, target)

    return Promise.resolve({
      target: target,
      externalScripts: externalScriptsComparisonResult,
      inlineScripts: inlineScriptsComparisonResult,
    })
  }

  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[], target: Target): ScriptComparisonResult {
    const newScripts: ScriptInfo[] = []
    const newHashes: ScriptInfo[] = []

    detectedScripts.forEach((script) => {
      const scriptSourceValue = getScriptSource(script)
      if (!this.scriptExistsInInventory(script, inventoryScripts)) {
        console.log(`[Comparison]: Script '${scriptSourceValue}' not found in inventory for target '${target.url}'.`)
        newScripts.push(script)
      } else {
        const inventoryScript = this.getScriptFromInventory(script, inventoryScripts)
        const hashExists = this.scriptHashExists(script, inventoryScript)

        if (!hashExists) {
          console.log(`[Comparison]: Script '${scriptSourceValue}' found in inventory, but hash '${script.hash.value}' doesn't exist for target '${target.url}'.`)
          newHashes.push(script)
        }
      }
    })

    return {
      newScripts: newScripts,
      newHashes: newHashes,
    }
  }

  // private compareHeadersWithInventory(detectedHeaders: HeaderInfo[], inventoryHeaders: InventoryHeaderInfo[], target: Target): HeaderComparisonResult {
  //   const changedHeaders: HeaderInfo[] = []
  //
  //   // If no headers are defined in inventory, no comparison needed
  //   if (!inventoryHeaders || inventoryHeaders.length === 0) {
  //     return {
  //       changedHeaders: [],
  //     }
  //   }
  //
  //   detectedHeaders.forEach((detectedHeader) => {
  //     // Find if this header is defined in the inventory
  //     const inventoryHeader = this.getHeaderFromInventory(detectedHeader, inventoryHeaders)
  //
  //     if (inventoryHeader) {
  //       // Header is defined in inventory - check if content has changed
  //       if (!this.headerContentMatches(detectedHeader, inventoryHeader)) {
  //         console.log(`[Comparison]: Header '${detectedHeader.name}' content changed for target '${target.url}'.`)
  //         changedHeaders.push(detectedHeader)
  //       }
  //     }
  //     // If header is not in inventory, we don't alert on it (new headers are ignored)
  //   })
  //
  //   return {
  //     changedHeaders: changedHeaders,
  //   }
  // }

  private scriptExistsInInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): boolean {
    return inventoryScripts.some((inventoryScript) => inventoryScript.matcher.test(getScriptSource(scriptInfo)))
  }

  private getScriptFromInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo {
    return inventoryScripts.find((inventoryScript) => inventoryScript.matcher.test(getScriptSource(scriptInfo)))!
  }

  private scriptHashExists(scriptInfo: ScriptInfo, inventoryScript: InventoryScriptInfo): boolean {
    return inventoryScript.hashes.some((hashInfo) => hashInfo.hash.value === scriptInfo.hash.value)
  }

  // private getHeaderFromInventory(detectedHeader: HeaderInfo, inventoryHeaders: InventoryHeaderInfo[]): InventoryHeaderInfo | undefined {
  //   return inventoryHeaders.find((inventoryHeader) => inventoryHeader.nameMatcher.test(detectedHeader.name))
  // }
  //
  // private headerContentMatches(detectedHeader: HeaderInfo, inventoryHeader: InventoryHeaderInfo): boolean {
  //   return inventoryHeader.contentMatcher.test(detectedHeader.value)
  // }
}
