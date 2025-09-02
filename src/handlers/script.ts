import type { HTTPResponse } from 'puppeteer'
import type { ScriptInfo } from '../types/script'

import { createSha256Hash } from '../utils/hash'

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
          },
          hash: createSha256Hash(scriptContent),
        })
      }
    } catch (e) {
      const error = e as Error
      if (error.name === 'TargetCloseError') {
        console.error('The page has already been closed, so we cannot process anymore scripts. Skipping..')
      } else {
        console.error(`Errored while attempting to read script response: ${error}`)
        await Promise.reject(error)
      }
    }
  }
}
