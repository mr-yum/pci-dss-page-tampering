import type { HeaderDetectionSummary } from './header'
import type { ScriptDetectionSummary } from './script'
import type { Target } from './target'

export type DetectionSummary = {
  target: Target
  scriptSummary: ScriptDetectionSummary
  headerSummary: HeaderDetectionSummary
}
