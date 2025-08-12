import { HTTPResponse } from 'puppeteer'
import { ScriptInfo } from 'src/types/scriptInfo'
import { createSha256Hash } from 'src/utils/hash'

export async function scriptResponseHandler(response: HTTPResponse, detectedScripts: ScriptInfo[]): Promise<void> {
  if (response.request().resourceType() === 'script' && response.ok()) {
    try {
      const scriptUrl = response.url()
      const scriptContent = await response.text()

      if (!detectedScripts.some((scriptInfo) => scriptInfo.source === scriptUrl) && scriptContent) {
        detectedScripts.push({
          type: 'External',
          source: scriptUrl,
          sha256: createSha256Hash(scriptContent),
        })
      }
    } catch (error) {
      console.error(`Errored while attempting to read script response: ${error}`)
    }
  }
}
