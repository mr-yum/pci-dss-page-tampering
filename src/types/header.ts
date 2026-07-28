import type { ResourceType } from 'puppeteer'

import type { Target } from './target.js'
import type { Workflow } from './workflow.js'

export type HeaderName = string
export type HeaderValues = Set<string>
export type HeaderUrl = string

/** Runtime counterpart to Puppeteer's ResourceType union for inventory validation. */
export const RESPONSE_RESOURCE_TYPES = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'websocket',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'fedcm',
  'other',
] as const satisfies readonly ResourceType[]
export type ResponseResourceType = (typeof RESPONSE_RESOURCE_TYPES)[number]

export type DetectedResponse = {
  readonly url: string
  readonly resourceType: ResponseResourceType
  /** Header names present on this exact response occurrence. Values remain redacted elsewhere. */
  readonly headerNames: ReadonlySet<HeaderName>
}

/**
 * Headers are keyed by name, then by individual directive/value, then by the
 * set of originating response URLs that emitted that value. URLs are tracked
 * (rather than just hosts) so inventories can authorise CSP directives at
 * either host or path precision — `HostMatcher` derives the host from these
 * URLs on the fly; `UrlMatcher` matches the full URL.
 */
export type HeaderDetectionSummary = {
  headers: Map<HeaderName, Map<string, Set<HeaderUrl>>>
  /**
   * Responses seen during the run. Optional for backwards-compatible test
   * fixtures; production detection always populates it. Required-header
   * checks use the per-response header-name set to detect removal, including
   * when the same URL responds more than once during a workflow.
   */
  responses?: DetectedResponse[]
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
   * Full URL of the response that emitted this header (e.g.
   * `https://m.stripe.network/out-4.5.45.js`). Populated by
   * `headerResponseHandler` for all production-path responses. Optional
   * because hand-crafted test fixtures may omit it; downstream alert / matcher
   * code falls back gracefully (`HostMatcher` / `UrlMatcher` fail-secure;
   * alert UI shows "(unknown)").
   */
  readonly url?: string
}
