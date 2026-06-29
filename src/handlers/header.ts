import type { HTTPResponse } from 'puppeteer'

import type { HeaderDetectionSummary, HeaderUrl } from '../types/header.js'

export async function headerResponseHandler(response: HTTPResponse, detectedHeaders: HeaderDetectionSummary['headers']): Promise<void> {
  if (response.ok()) {
    try {
      const headers = response.headers()
      const cspHeaderName = 'content-security-policy'

      if (headers[cspHeaderName]) {
        // Store the full response URL — HostMatcher derives host from it,
        // UrlMatcher matches the full URL. Both fail-secure on empty.
        const url = response.url()
        const valuesByDirective = detectedHeaders.get(cspHeaderName) ?? new Map<string, Set<HeaderUrl>>()
        const headerValue = headers[cspHeaderName]
        const splitHeaderValues = headerValue
          .split(';')
          .map((splitValue) => splitValue.replace('\n', ' ').trim())
          .filter((value) => value.length !== 0)

        for (const value of splitHeaderValues) {
          const urls = valuesByDirective.get(value) ?? new Set<HeaderUrl>()
          urls.add(url)
          valuesByDirective.set(value, urls)
        }
        detectedHeaders.set(cspHeaderName, valuesByDirective)
      }
    } catch (error) {
      console.error(`Errored while attempting to read header response: ${error}`)
    }
  }
}
