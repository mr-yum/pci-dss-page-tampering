import type { ScriptInfo } from './script'
import type { Target } from './target'

export type ComparisonResult = {
  target: Target
  externalNonInventoryScripts: ScriptInfo[]
  inlineNonInventoryScripts: ScriptInfo[]
}
