import type { HTTPRequest, HTTPResponse } from 'puppeteer'

import type { ScriptInfo, UnreadScriptResponse } from '../types/script.js'
import { PendingScriptReads, SCRIPT_READ_LATE_REASON, scriptResponseHandler } from './script.js'

type MockInitiator = { type?: string; url?: string; stack?: { callFrames: { url?: string }[] } }

function scriptResponse(content: string, url = 'https://cdn.example.com/app.js', initiator?: MockInitiator, frameUrl?: string): HTTPResponse {
  return {
    request: () => ({
      resourceType: () => 'script',
      initiator: () => initiator,
      frame: () => (frameUrl !== undefined ? { url: () => frameUrl } : null),
    }),
    ok: () => true,
    status: () => 200,
    url: () => url,
    text: async () => content,
  } as unknown as HTTPResponse
}

const EVICTED = 'Could not load response body for this request. This might happen if the request is a preflight request.'

/** A script response whose body Chrome no longer holds, as after a navigation away from its document. */
function unreadableResponse(url = 'https://cdn.example.com/pay.js?token=secret', reason = EVICTED, status = 200): HTTPResponse {
  return {
    request: () => ({ resourceType: () => 'script', initiator: () => undefined, frame: () => null }),
    ok: () => true,
    status: () => status,
    url: () => url,
    text: async () => {
      throw new Error(reason)
    },
  } as unknown as HTTPResponse
}

describe('scriptResponseHandler', () => {
  describe('a script whose body cannot be read', () => {
    let consoleError: jest.SpyInstance
    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation()
    })
    afterEach(() => consoleError.mockRestore())

    // The production defect: the script vanished from the run with a log line
    // that did not even name it, and the run went green.
    it('is recorded with its URL, type, status, reason, document and the step it arrived in', async () => {
      const detectedScripts: ScriptInfo[] = []
      const unread: UnreadScriptResponse[] = []

      await scriptResponseHandler(unreadableResponse(), detectedScripts, 'loader-checkout', { unread, step: 5 })

      expect(detectedScripts).toEqual([])
      expect(unread).toEqual([{ url: 'https://cdn.example.com/pay.js?token=secret', resourceType: 'script', status: 200, reason: EVICTED, document: 'loader-checkout', step: 5 }])
    })

    it('logs the script by origin and path, with its document and step', async () => {
      await scriptResponseHandler(unreadableResponse(), [], 'loader-checkout', { unread: [], step: 5 })

      const line = String(consoleError.mock.calls[0]?.[0])
      expect(line).toContain('https://cdn.example.com/pay.js')
      expect(line).not.toContain('token=secret')
      expect(line).toContain('step 5')
      expect(line).toContain('document loader-checkout')
      expect(line).toContain(EVICTED)
    })

    it('leaves an unattributed unread script without a document, which keeps it in payment scope', async () => {
      const unread: UnreadScriptResponse[] = []
      await scriptResponseHandler(unreadableResponse(), [], undefined, { unread, step: 0 })
      expect(unread[0]).not.toHaveProperty('document')
    })

    it('records the same failure on the same document once', async () => {
      const unread: UnreadScriptResponse[] = []
      await scriptResponseHandler(unreadableResponse(), [], 'loader-checkout', { unread, step: 5 })
      await scriptResponseHandler(unreadableResponse(), [], 'loader-checkout', { unread, step: 5 })
      await scriptResponseHandler(unreadableResponse(), [], 'loader-confirm', { unread, step: 6 })
      expect(unread.map((record) => record.document)).toEqual(['loader-checkout', 'loader-confirm'])
    })

    // The deadline records a read as unfinished; closing the context then makes
    // the same read fail with a different reason. One gap, one record.
    it('records the same script once however many reasons it fails for', async () => {
      const unread: UnreadScriptResponse[] = []
      await scriptResponseHandler(unreadableResponse(undefined, 'the response body was still being read 15s after the workflow finished'), [], 'loader-checkout', { unread, step: 5 })
      await scriptResponseHandler(unreadableResponse(undefined, 'Session closed. Most likely the page has been closed.'), [], 'loader-checkout', { unread, step: 5 })
      expect(unread).toHaveLength(1)
      expect(unread[0]?.reason).toBe('the response body was still being read 15s after the workflow finished')
    })
  })

  // Once the run has drained its reads and is building its summary, a body
  // that lands late must neither be compared (the summary would not include
  // it consistently) nor vanish.
  describe('once the run is sealed', () => {
    let consoleError: jest.SpyInstance
    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation()
    })
    afterEach(() => consoleError.mockRestore())

    it('records a body that finishes reading late as unread instead of comparing it', async () => {
      const detectedScripts: ScriptInfo[] = []
      const unread: UnreadScriptResponse[] = []
      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.com/late.js'), detectedScripts, 'loader-confirm', { unread, step: 6, sealed: () => true })
      expect(detectedScripts).toEqual([])
      expect(unread).toEqual([{ url: 'https://cdn.example.com/late.js', resourceType: 'script', status: 200, reason: SCRIPT_READ_LATE_REASON, document: 'loader-confirm', step: 6 }])
      expect(String(consoleError.mock.calls[0]?.[0])).toContain('recorded as unread')
    })

    it('still compares a body that is read before the run is sealed', async () => {
      const detectedScripts: ScriptInfo[] = []
      await scriptResponseHandler(scriptResponse('body'), detectedScripts, 'loader-confirm', { unread: [], step: 6, sealed: () => false })
      expect(detectedScripts).toHaveLength(1)
    })

    it('does not record a script twice when its request was recorded as unanswered and its response then lands late', async () => {
      const atDeadline: UnreadScriptResponse = { url: 'https://cdn.example.com/late.js', resourceType: 'script', status: 0, reason: 'no response had arrived 15s after the workflow finished', document: 'loader-confirm', step: 6 }
      const unread: UnreadScriptResponse[] = [atDeadline]
      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.com/late.js'), [], 'loader-confirm', { unread, step: 6, sealed: () => true })
      expect(unread).toEqual([atDeadline])
    })

    it('does not record a script twice when the deadline recorded it and the closing context fails it again', async () => {
      const atDeadline: UnreadScriptResponse = {
        url: 'https://cdn.example.com/pay.js?token=secret',
        resourceType: 'script',
        status: 200,
        reason: 'the response body was still being read 15s after the workflow finished',
        document: 'loader-checkout',
        step: 5,
      }
      const unread: UnreadScriptResponse[] = [atDeadline]
      await scriptResponseHandler(unreadableResponse(undefined, 'Session closed. Most likely the page has been closed.'), [], 'loader-checkout', { unread, step: 5, sealed: () => true })
      expect(unread).toEqual([atDeadline])
    })
  })

  describe('PendingScriptReads', () => {
    it('returns nothing once every tracked read has settled', async () => {
      const reads = new PendingScriptReads()
      const response = scriptResponse('body')
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 2)
      expect(await reads.settle(1000)).toEqual([])
    })

    // A read still in flight when the workflow ends would otherwise either be
    // cut off by the context closing or land after the run was summarised.
    it('returns the reads still pending at the deadline, described for the unread record', async () => {
      const reads = new PendingScriptReads()
      const response = { ...scriptResponse('never'), status: () => 200, url: () => 'https://cdn.example.com/slow.js', text: () => new Promise<string>(() => undefined) } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 7)

      expect(await reads.settle(10)).toEqual([{ url: 'https://cdn.example.com/slow.js', resourceType: 'script', status: 200, step: 7, document: 'loader-checkout', phase: 'reading' }])
    })

    // A response can arrive, and start a read, while settle is already
    // waiting on earlier reads: it must get its own chance to finish.
    it('waits for reads that start while it is already waiting', async () => {
      const reads = new PendingScriptReads()
      let releaseFirst: () => void = () => undefined
      const first = new Promise<void>((resolve) => (releaseFirst = resolve))
      const firstResponse = { ...scriptResponse('a'), url: () => 'https://cdn.example.com/first.js' } as unknown as HTTPResponse
      reads.track(first, firstResponse, undefined, 3)

      const settled = reads.settle(1000)
      const lateResponse = { ...scriptResponse('b'), url: () => 'https://cdn.example.com/late.js' } as unknown as HTTPResponse
      const late = new Promise<void>((resolve) => setTimeout(resolve, 50))
      reads.track(late, lateResponse, undefined, 3)
      releaseFirst()

      expect(await settled).toEqual([])
    })

    function scriptRequest(url = 'https://cdn.example.com/late.js?sig=abc', resourceType = 'script'): HTTPRequest {
      return { resourceType: () => resourceType, url: () => url } as unknown as HTTPRequest
    }

    // A request issued by the last step has no read to wait for yet; without
    // this its response would land while the context was closing, after the
    // run had been summarised.
    it('waits for a script request whose response has not arrived, and returns it at the deadline', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest(), 4, () => 'loader-confirm')
      expect(await reads.settle(50)).toEqual([{ url: 'https://cdn.example.com/late.js?sig=abc', resourceType: 'script', status: 0, step: 4, document: 'loader-confirm', phase: 'awaiting-response' }])
    })

    it('stops waiting for a request once it finishes or fails', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest()
      reads.trackRequest(request, 4, () => undefined)
      const settling = reads.settle(5000)
      reads.requestSettled(request)
      expect(await settling).toEqual([])
    })

    it('hands a request over to its read when the response arrives, and lists it once if that read is still pending at the deadline', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest('https://cdn.example.com/app.js')
      reads.trackRequest(request, 4, () => undefined)
      const response = { ...scriptResponse('body', 'https://cdn.example.com/app.js'), request: () => request, text: () => new Promise<string>(() => undefined) } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, []), response, 'loader-confirm', 4)
      const unsettled = await reads.settle(50)
      expect(unsettled).toEqual([{ url: 'https://cdn.example.com/app.js', resourceType: 'script', status: 200, step: 4, document: 'loader-confirm', phase: 'reading' }])
    })

    it('ignores requests that are not scripts', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest('https://api.example.com/session', 'xhr'), 4, () => undefined)
      expect(await reads.settle(50)).toEqual([])
    })

    it('ignores responses the handler does not read', async () => {
      const reads = new PendingScriptReads()
      const stylesheet = { request: () => ({ resourceType: () => 'stylesheet' }), ok: () => true } as unknown as HTTPResponse
      reads.track(new Promise<void>(() => undefined), stylesheet, undefined, 1)
      expect(await reads.settle(10)).toEqual([])
    })
  })

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

  // The same SDK on an earlier page and again on the payment page: deduping on
  // (url, hash) alone would keep only the earlier copy, and payment scoping
  // would then drop the payment page's SDK along with it.
  it('keeps one copy per document of the same script, tagged with its document', async () => {
    const detectedScripts: ScriptInfo[] = []

    await scriptResponseHandler(scriptResponse('sdk'), detectedScripts, 'loader-upgrades')
    await scriptResponseHandler(scriptResponse('sdk'), detectedScripts, 'loader-checkout')
    await scriptResponseHandler(scriptResponse('sdk'), detectedScripts, 'loader-checkout')

    expect(detectedScripts.map((script) => script.document)).toEqual(['loader-upgrades', 'loader-checkout'])
  })

  it('leaves an unattributed script without a document', async () => {
    const detectedScripts: ScriptInfo[] = []
    await scriptResponseHandler(scriptResponse('sdk'), detectedScripts)
    expect(detectedScripts[0]).not.toHaveProperty('document')
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
