import type { HTTPResponse } from 'puppeteer'
import type { HeaderName, HeaderValues } from '../types/header'

export async function headerResponseHandler(response: HTTPResponse, detectedHeaders: Map<HeaderName, HeaderValues>): Promise<void> {
  if (response.ok()) {
    try {
      const headers = response.headers()
      const cspHeaderName = 'content-security-policy'

      if (headers[cspHeaderName]) {
        const headerValues = createOrGetHeaderValues(cspHeaderName, detectedHeaders)
        headerValues.add(headers[cspHeaderName])
      }
    } catch (error) {
      console.error(`Errored while attempting to read header response: ${error}`)
    }
  }
}

function createOrGetHeaderValues(headerName: HeaderName, detectedHeaders: Map<HeaderName, HeaderValues>): HeaderValues {
  if (!detectedHeaders.has(headerName)) {
    detectedHeaders.set(headerName, new Set<string>())
  }

  return detectedHeaders.get(headerName)!
}
