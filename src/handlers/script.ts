import type { HTTPResponse } from 'puppeteer'

import type { ScriptInfo } from '../types/script.js'
import { createSha256Hash } from '../utils/hash.js'

export async function scriptResponseHandler(response: HTTPResponse, detectedScripts: ScriptInfo[]): Promise<void> {
  if (response.request().resourceType() === 'script' && response.ok()) {
    try {
      const scriptUrl = response.url()
      const scriptContent = await response.text()

      if (!detectedScripts.some((scriptInfo) => scriptInfo.source.type === 'external' && scriptInfo.source.url === scriptUrl) && scriptContent) {
        detectedScripts.push({
          source: {
            type: 'external',
            url: scriptUrl,
            content: scriptContent,
          },
          hash: createSha256Hash(scriptContent),
        })
      }
    } catch (error) {
      console.error(`Errored while attempting to read script response: ${error}`)
    }
  }
}
