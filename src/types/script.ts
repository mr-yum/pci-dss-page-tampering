export type ExternalScriptSource = {
  type: 'external'
  url: string
}

export type InlineScriptSource = {
  type: 'inline'
  content: string
}

export type ScriptSource = ExternalScriptSource | InlineScriptSource

export type ScriptInfo = {
  source: ScriptSource
  sha256: string
}

export type ScriptSummary = {
  external: ScriptInfo[]
  internal: ScriptInfo[]
}
