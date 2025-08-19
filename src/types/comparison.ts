import type { ScriptInfo } from './script'
import type { Target } from './target'

export type ScriptComparisonResult = {
  newScripts: ScriptInfo[]
  newHashes: ScriptInfo[]
}

export type ScriptComparisonSummary = {
  target: Target
  externalScripts: ScriptComparisonResult
  inlineScripts: ScriptComparisonResult
}
