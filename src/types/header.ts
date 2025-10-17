import type { Target } from './target'
import type { Workflow } from './workflow'

export type HeaderName = string
export type HeaderValues = Set<string>

export type HeaderDetectionSummary = {
  headers: Map<HeaderName, HeaderValues>
}

export type HeaderInfo = {
  name: HeaderName
  value: string
}

export interface DetectedHeader {
  readonly name: string
  readonly value: string
  readonly target: Target
  readonly workflow: Workflow
}
