export type HeaderName = string
export type HeaderValues = Set<string>

export type HeaderDetectionSummary = {
  headers: Map<HeaderName, HeaderValues>
}

export type HeaderInfo = {
  name: HeaderName
  value: string
}
