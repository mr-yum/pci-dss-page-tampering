import type { Frame, HTTPRequest, HTTPResponse } from 'puppeteer'

import type { ScriptInfo, UnreadScriptResponse } from '../types/script.js'
import { PendingScriptReads, SCRIPT_READ_LATE_REASON, SCRIPT_REQUEST_FRAME_DETACHED_REASON, scriptResponseHandler } from './script.js'

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
    const UNANSWERED = 'no response had arrived 15s after the workflow finished'

    it('returns nothing once every tracked read has settled', async () => {
      const reads = new PendingScriptReads()
      const response = scriptResponse('body')
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 2)
      expect(await reads.settle(1000, UNANSWERED)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([])
    })

    // A read still in flight when the workflow ends would otherwise either be
    // cut off by the context closing or land after the run was summarised.
    it('returns the reads still pending at the deadline, described for the unread record', async () => {
      const reads = new PendingScriptReads()
      const response = { ...scriptResponse('never'), status: () => 200, url: () => 'https://cdn.example.com/slow.js', text: () => new Promise<string>(() => undefined) } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 7)

      expect(await reads.settle(10, UNANSWERED)).toEqual([{ url: 'https://cdn.example.com/slow.js', resourceType: 'script', status: 200, step: 7, document: 'loader-checkout' }])
      expect(reads.unansweredRequests()).toEqual([])
    })

    // A response can arrive, and start a read, while settle is already
    // waiting on earlier reads: it must get its own chance to finish.
    it('waits for reads that start while it is already waiting', async () => {
      const reads = new PendingScriptReads()
      let releaseFirst: () => void = () => undefined
      const first = new Promise<void>((resolve) => (releaseFirst = resolve))
      const firstResponse = { ...scriptResponse('a'), url: () => 'https://cdn.example.com/first.js' } as unknown as HTTPResponse
      reads.track(first, firstResponse, undefined, 3)

      const settled = reads.settle(1000, UNANSWERED)
      const lateResponse = { ...scriptResponse('b'), url: () => 'https://cdn.example.com/late.js' } as unknown as HTTPResponse
      const late = new Promise<void>((resolve) => setTimeout(resolve, 50))
      reads.track(late, lateResponse, undefined, 3)
      releaseFirst()

      expect(await settled).toEqual([])
    })

    function scriptRequest(url = 'https://cdn.example.com/late.js?sig=abc', resourceType = 'script', frame: Frame | null = null): HTTPRequest {
      return { resourceType: () => resourceType, url: () => url, frame: () => frame } as unknown as HTTPRequest
    }

    // A request issued by the last step has no read to wait for yet; without
    // this its response would land while the context was closing, after the
    // run had been summarised.
    it('waits for a script request whose response has not arrived, then lists it as unanswered rather than as an unfinished read', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest(), 4, () => 'loader-confirm')
      expect(await reads.settle(50, UNANSWERED)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([{ url: 'https://cdn.example.com/late.js?sig=abc', resourceType: 'script', reason: UNANSWERED, step: 4, document: 'loader-confirm' }])
    })

    it('stops waiting for a request once it finishes or fails, and never lists it', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest()
      reads.trackRequest(request, 4, () => undefined)
      const settling = reads.settle(5000, UNANSWERED)
      reads.requestSettled(request)
      expect(await settling).toEqual([])
      expect(reads.unansweredRequests()).toEqual([])
    })

    // Chrome cancels what is still in flight when the context closes; that
    // failure does not mean the request was ever answered.
    it('keeps a request reported unanswered on the list when it fails afterwards', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest()
      reads.trackRequest(request, 4, () => undefined)
      await reads.settle(10, UNANSWERED)
      reads.requestSettled(request)
      expect(reads.unansweredRequests()).toHaveLength(1)
    })

    it('hands a request over to its read when the response arrives, and lists it once — as a read — if that read is still pending at the deadline', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest('https://cdn.example.com/app.js')
      reads.trackRequest(request, 4, () => undefined)
      const response = { ...scriptResponse('body', 'https://cdn.example.com/app.js'), request: () => request, text: () => new Promise<string>(() => undefined) } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, []), response, 'loader-confirm', 4)
      const unsettled = await reads.settle(50, UNANSWERED)
      expect(unsettled).toEqual([{ url: 'https://cdn.example.com/app.js', resourceType: 'script', status: 200, step: 4, document: 'loader-confirm' }])
      expect(reads.unansweredRequests()).toEqual([])
    })

    // The fail-secure half of the disposition: a request reported unanswered
    // whose response lands after the run was sealed (as the context closes)
    // leaves the unanswered list and is recorded once, as unread, by the
    // sealed response handler — the script arrived and was never compared.
    it('moves a request reported unanswered to unread when its response lands after the seal', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation()
      const reads = new PendingScriptReads()
      const request = scriptRequest('https://cdn.example.com/late.js')
      reads.trackRequest(request, 6, () => 'loader-confirm')
      await reads.settle(10, UNANSWERED)
      expect(reads.unansweredRequests()).toHaveLength(1)

      const unread: UnreadScriptResponse[] = []
      const detectedScripts: ScriptInfo[] = []
      const response = { ...scriptResponse('body', 'https://cdn.example.com/late.js'), request: () => request } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, detectedScripts, 'loader-confirm', { unread, step: 6, sealed: () => true }), response, 'loader-confirm', 6)
      expect(await reads.settle(1000, UNANSWERED)).toEqual([])

      expect(reads.unansweredRequests()).toEqual([])
      expect(detectedScripts).toEqual([])
      expect(unread).toEqual([{ url: 'https://cdn.example.com/late.js', resourceType: 'script', status: 200, reason: SCRIPT_READ_LATE_REASON, document: 'loader-confirm', step: 6 }])
      consoleError.mockRestore()
    })

    describe('when the frame that issued a request is detached', () => {
      const frame = {} as Frame
      const otherFrame = {} as Frame

      // Puppeteer does not always report a torn-down frame's requests as
      // finished or failed, so waiting for them would spend the whole deadline.
      it('stops waiting for its requests at once, and still lists them as unanswered', async () => {
        const reads = new PendingScriptReads()
        reads.trackRequest(scriptRequest('https://provider.example.test/challenge.js', 'script', frame), 5, () => 'loader-checkout')
        const started = Date.now()
        const settling = reads.settle(5000, UNANSWERED)
        reads.frameDetached(frame)
        expect(await settling).toEqual([])
        expect(Date.now() - started).toBeLessThan(1000)
        expect(reads.unansweredRequests()).toEqual([{ url: 'https://provider.example.test/challenge.js', resourceType: 'script', reason: SCRIPT_REQUEST_FRAME_DETACHED_REASON, step: 5, document: 'loader-checkout' }])
      })

      it("keeps waiting for other frames' requests", async () => {
        const reads = new PendingScriptReads()
        reads.trackRequest(scriptRequest('https://provider.example.test/challenge.js', 'script', frame), 5, () => undefined)
        reads.trackRequest(scriptRequest('https://cdn.example.com/pay.js', 'script', otherFrame), 5, () => undefined)
        reads.frameDetached(frame)
        await reads.settle(20, UNANSWERED)
        expect(reads.unansweredRequests().map((request) => request.reason)).toEqual([UNANSWERED, SCRIPT_REQUEST_FRAME_DETACHED_REASON])
      })

      // Not waited for is not forgotten: a response that lands before the
      // seal is read like any other; see the test above for one that lands after.
      it('still reads a response that arrives for it after all, and no longer lists it', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://provider.example.test/challenge.js', 'script', frame)
        reads.trackRequest(request, 5, () => undefined)
        reads.frameDetached(frame)
        const detectedScripts: ScriptInfo[] = []
        const response = { ...scriptResponse('body', 'https://provider.example.test/challenge.js'), request: () => request } as unknown as HTTPResponse
        reads.track(scriptResponseHandler(response, detectedScripts, undefined, { unread: [], step: 5, sealed: () => false }), response, undefined, 5)
        expect(await reads.settle(1000, UNANSWERED)).toEqual([])
        expect(detectedScripts).toHaveLength(1)
        expect(reads.unansweredRequests()).toEqual([])
      })
    })

    it('ignores requests that are not scripts', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest('https://api.example.com/session', 'xhr'), 4, () => undefined)
      expect(await reads.settle(50, UNANSWERED)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([])
    })

    it('ignores responses the handler does not read', async () => {
      const reads = new PendingScriptReads()
      const stylesheet = { request: () => ({ resourceType: () => 'stylesheet' }), ok: () => true } as unknown as HTTPResponse
      reads.track(new Promise<void>(() => undefined), stylesheet, undefined, 1)
      expect(await reads.settle(10, UNANSWERED)).toEqual([])
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
