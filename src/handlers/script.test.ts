import type { HTTPResponse } from 'puppeteer'

import type { ScriptInfo } from '../types/script.js'
import { scriptResponseHandler } from './script.js'

type MockInitiator = { type?: string; url?: string; stack?: { callFrames: { url?: string }[] } }

function scriptResponse(content: string, url = 'https://cdn.example.com/app.js', initiator?: MockInitiator, frameUrl?: string): HTTPResponse {
  return {
    request: () => ({
      resourceType: () => 'script',
      initiator: () => initiator,
      frame: () => (frameUrl !== undefined ? { url: () => frameUrl } : null),
    }),
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

  describe('initiator attribution (CDP request initiator → Matchable.initiator)', () => {
    const sourceOf = (scripts: ScriptInfo[]) => scripts[0]!.source as { type: 'external'; initiator?: string }

    it('attributes a script-issued request to the top call frame (the immediate inserter)', async () => {
      const detectedScripts: ScriptInfo[] = []
      const initiator: MockInitiator = { type: 'script', stack: { callFrames: [{ url: 'https://pay.example.com/assets/main-abc1.js' }, { url: 'https://pay.example.com/assets/vendor.js' }] } }

      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.net/sdk.js', initiator), detectedScripts)

      expect(sourceOf(detectedScripts).initiator).toBe('https://pay.example.com/assets/main-abc1.js')
    })

    it('attributes a parser-inserted tag to the initiator (document) URL', async () => {
      const detectedScripts: ScriptInfo[] = []
      const initiator: MockInitiator = { type: 'parser', url: 'https://pay.example.com/checkout' }

      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.net/sdk.js', initiator), detectedScripts)

      expect(sourceOf(detectedScripts).initiator).toBe('https://pay.example.com/checkout')
    })

    it('falls back to the requesting frame URL when the stack is anonymous (eval), mirroring the RUM location.href fallback', async () => {
      const detectedScripts: ScriptInfo[] = []
      const initiator: MockInitiator = { type: 'script', stack: { callFrames: [{ url: '' }] } }

      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.net/sdk.js', initiator, 'https://pay.example.com/menu'), detectedScripts)

      expect(sourceOf(detectedScripts).initiator).toBe('https://pay.example.com/menu')
    })

    it('leaves initiator undefined when attribution genuinely fails (matchers then fail secure)', async () => {
      const detectedScripts: ScriptInfo[] = []

      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.net/sdk.js', undefined), detectedScripts)

      expect(sourceOf(detectedScripts).initiator).toBeUndefined()
    })
  })
})
