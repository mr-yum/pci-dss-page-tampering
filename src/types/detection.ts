import type { HeaderName, HeaderValues } from './header'
import type { ScriptDetectionSummary } from './script'
import type { Target } from './target'

export type DetectionSummary = {
  target: Target
  scripts: ScriptDetectionSummary
  headers: Map<HeaderName, HeaderValues>
}
