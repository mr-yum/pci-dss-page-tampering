import type { HTTPResponse } from 'puppeteer'

import type { HeaderDetectionSummary, HeaderHost } from '../types/header'

/**
 * Extract the host portion of `response.url()` so the detection summary can
 * record which host emitted each header directive. Returns the empty string
 * for non-URL responses (e.g. blobs) — comparison still runs but HostMatcher
 * cannot meaningfully match.
 */
function extractHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return ''
  }
}

export async function headerResponseHandler(response: HTTPResponse, detectedHeaders: HeaderDetectionSummary['headers']): Promise<void> {
  if (response.ok()) {
    try {
      const headers = response.headers()
      const cspHeaderName = 'content-security-policy'

      if (headers[cspHeaderName]) {
        const host = extractHost(response.url())
        const valuesByDirective = detectedHeaders.get(cspHeaderName) ?? new Map<string, Set<HeaderHost>>()
        const headerValue = headers[cspHeaderName]
        const splitHeaderValues = headerValue
          .split(';')
          .map((splitValue) => splitValue.replace('\n', ' ').trim())
          .filter((value) => value.length !== 0)

        for (const value of splitHeaderValues) {
          const hosts = valuesByDirective.get(value) ?? new Set<HeaderHost>()
          hosts.add(host)
          valuesByDirective.set(value, hosts)
        }
        detectedHeaders.set(cspHeaderName, valuesByDirective)
      }
    } catch (error) {
      console.error(`Errored while attempting to read header response: ${error}`)
    }
  }
}
