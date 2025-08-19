import type { ScriptInfo } from '../types/script'
import type { InventoryScriptInfo } from '../types/inventory'
import { scriptHashToInventoryHashInfo } from '../utils/hash'

export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  return {
    matcher: RegExp(''),
    hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)],
    authorisationInfo: {
      description: 'NO_DESCRIPTION',
      authorised: false,
      date: date,
    },
  }
}
