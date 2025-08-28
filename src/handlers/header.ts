import type { HTTPResponse } from 'puppeteer'
import type { HeaderName, HeaderValues } from '../types/header'

export async function headerResponseHandler(response: HTTPResponse, detectedHeaders: Map<HeaderName, HeaderValues>): Promise<void> {
  if (response.ok()) {
    try {
      const headers = response.headers()
      const cspHeaderName = 'content-security-policy'

      if (headers[cspHeaderName]) {
        const headerValues = detectedHeaders.get(cspHeaderName) || new Set<string>()
        const headerValue = headers[cspHeaderName]
        const splitHeaderValues = headerValue
          .split(';')
          .map((splitValue) => splitValue.replace('\n', '\s').trim())
          .filter((value) => value.length !== 0)

        for (const value of splitHeaderValues) {
          headerValues.add(value)
        }
        detectedHeaders.set(cspHeaderName, headerValues)
      }
    } catch (error) {
      console.error(`Errored while attempting to read header response: ${error}`)
    }
  }
}
