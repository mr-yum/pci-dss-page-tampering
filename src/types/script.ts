import type { SHA256Hash } from './hash'

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
  externalScripts: ScriptInfo[]
  inlineScripts: ScriptInfo[]
}
