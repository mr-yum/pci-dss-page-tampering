import type { ScriptInfo, HeaderInfo } from './script'
import type { Target } from './target'

export type ScriptComparisonResult = {
  newScripts: ScriptInfo[]
  newHashes: ScriptInfo[]
}

export type HeaderComparisonResult = {
  changedHeaders: HeaderInfo[]
}

export type ScriptComparisonSummary = {
  target: Target
  externalScripts: ScriptComparisonResult
  inlineScripts: ScriptComparisonResult
  headers: HeaderComparisonResult
}
