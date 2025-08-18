import type { ScriptInfo } from './script'

export type ComparisonResult = {
  externalNonInventoryScripts: ScriptInfo[]
  inlineNonInventoryScripts: ScriptInfo[]
}
