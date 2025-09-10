import type { InventoryScriptInfo } from '../types/inventory/model'
import type { RawInventoryScriptInfo } from '../types/inventory/raw'
import type { ScriptInfo } from '../types/script'

import { scriptHashToInventoryHashInfo } from '../utils/hash'
import { escapeRegex } from './string'

export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  return {
    nameMatcher: RegExp(`^${escapeRegex(getScriptSource(scriptInfo))}$`),
    contentMatcher: undefined,
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
      scriptSourceContent = scriptInfo.source.id
      break
  }

  return scriptSourceContent
}

export function rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScriptInfo: RawInventoryScriptInfo): InventoryScriptInfo {
  return {
    nameMatcher: RegExp(rawInventoryScriptInfo.nameMatcher),
    contentMatcher: rawInventoryScriptInfo.contentMatcher ? RegExp(rawInventoryScriptInfo.contentMatcher) : undefined,
    hashes: rawInventoryScriptInfo.hashes,
    authorisationInfo: rawInventoryScriptInfo.authorisationInfo,
  }
}

export function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo {
  return {
    nameMatcher: inventoryScriptInfo.nameMatcher.source,
    contentMatcher: inventoryScriptInfo.contentMatcher?.source ?? undefined,
    hashes: inventoryScriptInfo.hashes,
    authorisationInfo: inventoryScriptInfo.authorisationInfo,
  }
}
