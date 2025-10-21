import type { HeaderName, HeaderValues } from './header'
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

export type HeaderComparisonSummary = {
  target: Target
  unauthorisedHeaders: Map<HeaderName, HeaderValues> | undefined
}

// Re-export typed comparison results from comparison/index.ts
export type { ComparisonResultType } from './comparison/index'
export { ComparisonResult, UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound } from './comparison/index'
