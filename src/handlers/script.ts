import type { HTTPRequest, HTTPResponse } from 'puppeteer'

import type { ScriptInfo } from '../types/script.js'
import { createSha256Hash } from '../utils/hash.js'

/**
 * Derive the initiator URL for a script request from the CDP initiator info,
 * mirroring the RUM agent's attribution semantics so `initiatorHostMatcher`
 * entries behave identically across the synthetic and RUM passes:
 * - script-issued requests: the top call frame is the script that caused the
 *   load (the RUM insertion patch's `document.currentScript` equivalent);
 * - parser-inserted tags: the initiator/document URL (the RUM agent's
 *   `location.href` fallback for parser-inserted scripts);
 * - anonymous stacks (eval'd code): the requesting frame's document URL, the
 *   same honest fallback the agent uses when `currentScript` is null.
 * Returns undefined only when attribution genuinely failed — matchers then
 * fail secure on the missing evidence.
 */
function deriveInitiatorUrl(request: HTTPRequest): string | undefined {
  try {
    const initiator = request.initiator?.()
    const frameUrl = initiator?.stack?.callFrames?.[0]?.url
    if (frameUrl) return frameUrl
    if (initiator?.url) return initiator.url
    const documentUrl = request.frame()?.url()
    return documentUrl && documentUrl !== '' ? documentUrl : undefined
  } catch {
    return undefined
  }
}

export async function scriptResponseHandler(response: HTTPResponse, detectedScripts: ScriptInfo[]): Promise<void> {
  if (response.request().resourceType() === 'script' && response.ok()) {
    try {
      const scriptUrl = response.url()
      const scriptContent = await response.text()
      const scriptHash = createSha256Hash(scriptContent)
      const initiator = deriveInitiatorUrl(response.request())

      // Reload recovery can observe more than one body at the same URL. Keep
      // every distinct version so a failed first render cannot mask changed
      // bytes served by the successful attempt.
      if (!detectedScripts.some((scriptInfo) => scriptInfo.source.type === 'external' && scriptInfo.source.url === scriptUrl && scriptInfo.hash.value === scriptHash.value) && scriptContent) {
        detectedScripts.push({
          source: {
            type: 'external',
            url: scriptUrl,
            content: scriptContent,
            ...(initiator !== undefined ? { initiator } : {}),
          },
          hash: scriptHash,
        })
      }
    } catch (error) {
      console.error(`Errored while attempting to read script response: ${error}`)
    }
  }
}
