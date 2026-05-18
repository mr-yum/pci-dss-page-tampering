import type { Target } from './target'
import type { Workflow } from './workflow'

export type HeaderName = string
export type HeaderValues = Set<string>
export type HeaderHost = string

/**
 * Headers are keyed by name, then by individual directive/value, then by the
 * set of originating hosts that emitted that value. Hosts are tracked so
 * inventories can authorise CSP directives per-host (e.g. `default-src 'self'`
 * is fine from `*.meandu.app` but must be flagged from a third-party domain).
 */
export type HeaderDetectionSummary = {
  headers: Map<HeaderName, Map<string, Set<HeaderHost>>>
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
  /**
   * Host portion of the response URL that emitted this header (e.g.
   * `m.stripe.network`). Populated by `headerResponseHandler` for all
   * production-path responses. Optional because hand-crafted test fixtures
   * and any future synthetic header source may omit it; downstream alert /
   * matcher code falls back gracefully (HostMatcher fails-secure; alert UI
   * shows "(unknown)").
   */
  readonly host?: string
}
