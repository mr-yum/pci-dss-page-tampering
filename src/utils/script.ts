import type { ExternalScriptSource, ScriptInfo } from '../types/script'
import type { InventoryScriptInfo } from '../types/inventory'
import { scriptHashToInventoryHashInfo } from '../utils/hash'

export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  const scriptSource = scriptInfo.source as ExternalScriptSource
  return {
    matcher: RegExp(`^${scriptSource.url}$`),
    hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)],
    authorisationInfo: {
      description: 'NO_DESCRIPTION',
      authorised: false,
      date: date,
    },
  }
}
