import type { SHA256Hash } from './hash'
import type { Target } from './target'

export type ExternalScriptSource = {
  type: 'external'
  url: string
}

export type InlineScriptSource = {
  type: 'inline'
  id: string
  content: string
}

export type ScriptSource = ExternalScriptSource | InlineScriptSource

export type ScriptInfo = {
  source: ScriptSource
  hash: SHA256Hash
}

export type ScriptDetectionSummary = {
  target: Target
  external: ScriptInfo[]
  inline: ScriptInfo[]
}
