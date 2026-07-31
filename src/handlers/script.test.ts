import type { HTTPResponse } from 'puppeteer'

import type { ScriptInfo } from '../types/script.js'
import { scriptResponseHandler } from './script.js'

function scriptResponse(content: string, url = 'https://cdn.example.com/app.js'): HTTPResponse {
  return {
    request: () => ({ resourceType: () => 'script' }),
    ok: () => true,
    url: () => url,
    text: async () => content,
  } as unknown as HTTPResponse
}

describe('scriptResponseHandler', () => {
  it('retains different script bodies served from the same URL', async () => {
    const detectedScripts: ScriptInfo[] = []

    await scriptResponseHandler(scriptResponse('first version'), detectedScripts)
    await scriptResponseHandler(scriptResponse('second version'), detectedScripts)

    expect(detectedScripts).toHaveLength(2)
    expect(new Set(detectedScripts.map(({ hash }) => hash.value)).size).toBe(2)
  })

  it('deduplicates repeated responses with the same URL and body', async () => {
    const detectedScripts: ScriptInfo[] = []

    await scriptResponseHandler(scriptResponse('same version'), detectedScripts)
    await scriptResponseHandler(scriptResponse('same version'), detectedScripts)

    expect(detectedScripts).toHaveLength(1)
  })

  it('retains the same script body when it is served from different URLs', async () => {
    const detectedScripts: ScriptInfo[] = []

    await scriptResponseHandler(scriptResponse('shared version', 'https://cdn.example.com/first.js'), detectedScripts)
    await scriptResponseHandler(scriptResponse('shared version', 'https://cdn.example.com/second.js'), detectedScripts)

    expect(detectedScripts).toHaveLength(2)
  })
})
