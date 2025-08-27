import type { ScriptInfo } from './script'
import type { Target } from './target'
import type { HeaderName, HeaderValues } from './header'

export type ScriptComparisonResult = {
  newScripts: ScriptInfo[]
  newHashes: ScriptInfo[]
}

export type ScriptComparisonSummary = {
  target: Target
  externalScripts: ScriptComparisonResult
  inlineScripts: ScriptComparisonResult
}

export type HeaderComparisonSummary = {
  target: Target
  unauthorisedHeaders: Map<HeaderName, HeaderValues> | undefined
}
