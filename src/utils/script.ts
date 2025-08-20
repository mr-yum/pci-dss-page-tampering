import type { ScriptInfo } from '../types/script'
import type { InventoryScriptInfo } from '../types/inventory'

import { scriptHashToInventoryHashInfo } from '../utils/hash'

export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  return {
    matcher: RegExp(`^${getScriptSource(scriptInfo)}$`),
    hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)],
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
      // scriptSourceContent = scriptInfo.source.content
      scriptSourceContent = 'inline_script'
      break
  }

  return scriptSourceContent
}
