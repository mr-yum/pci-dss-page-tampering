import type { HTTPResponse } from 'puppeteer'

import type { ScriptInfo } from '../types/script.js'
import { createSha256Hash } from '../utils/hash.js'

export async function scriptResponseHandler(response: HTTPResponse, detectedScripts: ScriptInfo[]): Promise<void> {
  if (response.request().resourceType() === 'script' && response.ok()) {
    try {
      const scriptUrl = response.url()
      const scriptContent = await response.text()
      const scriptHash = createSha256Hash(scriptContent)

      // Reload recovery can observe more than one body at the same URL. Keep
      // every distinct version so a failed first render cannot mask changed
      // bytes served by the successful attempt.
      if (!detectedScripts.some((scriptInfo) => scriptInfo.source.type === 'external' && scriptInfo.source.url === scriptUrl && scriptInfo.hash.value === scriptHash.value) && scriptContent) {
        detectedScripts.push({
          source: {
            type: 'external',
            url: scriptUrl,
            content: scriptContent,
          },
          hash: scriptHash,
        })
      }
    } catch (error) {
      console.error(`Errored while attempting to read script response: ${error}`)
    }
  }
}
