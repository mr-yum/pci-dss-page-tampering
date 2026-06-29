import type { HeaderDetectionSummary } from './header.js'
import type { ScriptDetectionSummary } from './script.js'
import type { Target } from './target.js'

export type DetectionSummary = {
  target: Target
  scriptSummary: ScriptDetectionSummary
  headerSummary: HeaderDetectionSummary
}
