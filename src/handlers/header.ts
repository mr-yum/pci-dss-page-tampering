import type { HTTPResponse } from 'puppeteer'

import type { DetectedResponse, HeaderDetectionSummary, HeaderUrl, ResponseResourceType } from '../types/header.js'
import type { InventoryHeaderInfo } from '../types/inventory/model.js'
import { normalizeTrackedHeader, TRACKED_HEADER_NAMES } from '../utils/header-normalization.js'

export async function headerResponseHandler(
  response: HTTPResponse,
  detectedHeaders: HeaderDetectionSummary['headers'],
  detectedResponses?: DetectedResponse[],
  targetUrl?: string,
  inventoryHeaders: readonly InventoryHeaderInfo[] = [],
  workflowId = 'default',
): Promise<void> {
  try {
    const headers = response.headers()
    const url = response.url()
    const resourceType = response.request?.().resourceType?.() ?? 'other'
    const responseOk = response.ok()
    const isTargetHost = targetUrl === undefined || isSameHost(url, targetUrl)
    const responseDate = Date.parse(headers['date'] ?? '')
    const referenceTimeMs = Number.isNaN(responseDate) ? Date.now() : responseDate

    // Keep presence on the individual response occurrence. The value map is
    // intentionally URL-deduplicated for comparison, so it cannot tell whether
    // a later response for the same URL omitted a required header.
    const headerNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()))
    detectedResponses?.push({ url, resourceType, headerNames })

    for (const headerName of TRACKED_HEADER_NAMES) {
      const rawValue = headers[headerName]
      if (rawValue === undefined) continue
      // Preserve the established CSP scope. Redirect/error CSP policies were
      // not inventoried before this feature; only the new redirect-sensitive
      // headers intentionally observe non-OK responses.
      if (headerName === 'content-security-policy' && !responseOk) continue

      const valuesByUrl = detectedHeaders.get(headerName) ?? new Map<string, Set<HeaderUrl>>()
      for (const value of normalizeTrackedHeader(headerName, rawValue, referenceTimeMs)) {
        if (!shouldCapture(headerName, resourceType, isTargetHost, url, inventoryHeaders, workflowId)) continue
        const urls = valuesByUrl.get(value) ?? new Set<HeaderUrl>()
        urls.add(url)
        valuesByUrl.set(value, urls)
      }
      if (valuesByUrl.size > 0) {
        detectedHeaders.set(headerName, valuesByUrl)
      }
    }
  } catch (error) {
    console.error(`Errored while attempting to read header response: ${error}`)
  }
}

function isSameHost(responseUrl: string, targetUrl: string): boolean {
  try {
    return new URL(responseUrl).host === new URL(targetUrl).host
  } catch {
    return false
  }
}

function shouldCapture(headerName: (typeof TRACKED_HEADER_NAMES)[number], resourceType: ResponseResourceType, isTargetHost: boolean, url: string, inventoryHeaders: readonly InventoryHeaderInfo[], workflowId: string): boolean {
  // Preserve the established CSP behaviour: CSP from every response is part
  // of the PCI inventory and is scoped later with HostMatcher/UrlMatcher.
  if (headerName === 'content-security-policy') return true
  const explicitlyTracked = inventoryHeaders.some((entry) => identifiesHeaderAndOrigin(entry.identifyWith, headerName, url, workflowId))
  if (!isTargetHost && !explicitlyTracked) return false

  switch (headerName) {
    case 'x-frame-options':
    case 'strict-transport-security':
    case 'x-xss-protection':
      return resourceType === 'document'
    case 'x-content-type-options':
      return resourceType === 'document' || resourceType === 'script' || resourceType === 'stylesheet'
    case 'set-cookie':
      return true
    default:
      return false
  }
}

type PresencePath = {
  readonly matches: boolean
  readonly hasHeaderName: boolean
  readonly hasProvenance: boolean
}

/**
 * Decide third-party capture from name/provenance only. Content matchers are
 * authorization/identity refinements; using the current content here would
 * suppress the very changed value that detection needs to report.
 */
function identifiesHeaderAndOrigin(matcher: InventoryHeaderInfo['identifyWith'], headerName: string, url: string, workflowId: string): boolean {
  const matchable = { name: headerName, content: '', url, workflowId }

  const paths = (candidate: InventoryHeaderInfo['identifyWith']): PresencePath[] => {
    switch (candidate.getType()) {
      case 'header-name':
        return [{ matches: candidate.identify(matchable), hasHeaderName: true, hasProvenance: false }]
      case 'host':
      case 'url':
        return [{ matches: candidate.identify(matchable), hasHeaderName: false, hasProvenance: true }]
      case 'workflow':
        return [{ matches: candidate.identify(matchable), hasHeaderName: false, hasProvenance: false }]
      case 'or':
        return (candidate.getPattern() as InventoryHeaderInfo['identifyWith'][]).flatMap(paths)
      case 'and':
        return (candidate.getPattern() as InventoryHeaderInfo['identifyWith'][]).reduce<PresencePath[]>(
          (combinations, child) =>
            combinations.flatMap((left) =>
              paths(child).map((right) => ({
                matches: left.matches && right.matches,
                hasHeaderName: left.hasHeaderName || right.hasHeaderName,
                hasProvenance: left.hasProvenance || right.hasProvenance,
              })),
            ),
          [{ matches: true, hasHeaderName: false, hasProvenance: false }],
        )
      case 'content':
      case 'hash':
      case 'name':
        return [{ matches: true, hasHeaderName: false, hasProvenance: false }]
    }
  }

  return paths(matcher).some((path) => path.matches && path.hasHeaderName && path.hasProvenance)
}
