export interface ScriptInfo {
  type: 'Inline' | 'External'
  source: string // URL for external scripts, or a placeholder for inline
  sha256: string
}
