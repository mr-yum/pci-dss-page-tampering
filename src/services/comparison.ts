import type { Inventory, InventoryScriptInfo } from 'src/types/inventory'
import type { ExternalScriptSource, ScriptDetectionSummary, ScriptInfo } from '../types/script'
import type { ScriptComparisonResult, ScriptComparisonSummary } from '../types/comparison'

export interface IScriptComparisonService {
  compare(inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ScriptComparisonSummary>
}

export class ScriptComparisonService implements IScriptComparisonService {
  /*
  Returns scripts that match the following conditions:
    - Not found in inventory
    - Found in inventory but hash doesn't exist
   */
  compare(inventory: Inventory, scriptDetectionSummary: ScriptDetectionSummary): Promise<ScriptComparisonSummary> {
    const inventoryScripts = inventory.scripts
    const detectedExternalScripts = scriptDetectionSummary.external
    const detectedInlineScripts = scriptDetectionSummary.inline

    const externalScriptsComparisonResult = this.compareScriptWithInventory(detectedExternalScripts, inventoryScripts)
    const inlineScriptsComparisonResult = this.compareScriptWithInventory(detectedInlineScripts, inventoryScripts)

    return Promise.resolve({
      target: scriptDetectionSummary.target,
      externalScripts: externalScriptsComparisonResult,
      inlineScripts: inlineScriptsComparisonResult,
    })
  }

  private compareScriptWithInventory(detectedScripts: ScriptInfo[], inventoryScripts: InventoryScriptInfo[]): ScriptComparisonResult {
    const newScripts: ScriptInfo[] = []
    const newHashes: ScriptInfo[] = []

    detectedScripts.forEach((script) => {
      if (!this.scriptExistsInInventory(script, inventoryScripts)) {
        const scriptSourceValue = this.getScriptSourceValue(script)
        console.log(`[Comparison]: Script '${scriptSourceValue}' not found in inventory.`)
        newScripts.push(script)
      } else {
        const inventoryScript = this.getScriptFromInventory(script, inventoryScripts)
        const hashExists = this.scriptHashExists(script, inventoryScript)

        if (!hashExists) {
          console.log(`[Comparison]: Script found in inventory, but hash '${script.hash.value}' doesn't exist.`)
          newHashes.push(script)
        }
      }
    })

    return {
      newScripts: newScripts,
      newHashes: newHashes,
    }
  }

  private scriptExistsInInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): boolean {
    return inventoryScripts.some((script) => script.name === (scriptInfo.source as ExternalScriptSource).url)
  }

  private getScriptFromInventory(scriptInfo: ScriptInfo, inventoryScripts: InventoryScriptInfo[]): InventoryScriptInfo {
    return inventoryScripts.find((inventoryScript) => inventoryScript.name === (scriptInfo.source as ExternalScriptSource).url)!
  }

  private scriptHashExists(scriptInfo: ScriptInfo, inventoryScript: InventoryScriptInfo): boolean {
    return inventoryScript.hashes.some((hashInfo) => hashInfo.hash === scriptInfo.hash)
  }

  private getScriptSourceValue(scriptInfo: ScriptInfo): string {
    switch (scriptInfo.source.type) {
      case 'external':
        return (scriptInfo.source as ExternalScriptSource).url
      case 'inline':
        return '(inline)'
    }
  }
}
