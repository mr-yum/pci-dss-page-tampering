import type { Frame, HTTPRequest, HTTPResponse } from 'puppeteer'

import type { ScriptInfo, UnreadScriptResponse } from '../types/script.js'
import { PendingScriptReads, recordUnreadScript, SCRIPT_BODY_WITHOUT_RESPONSE_REASON, SCRIPT_READ_LATE_REASON, SCRIPT_REQUEST_FRAME_DETACHED_REASON, scriptResponseHandler } from './script.js'

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
    const READING = 'the response body was still being read 15s after the workflow finished'
    const REASONS = { reading: READING, unanswered: UNANSWERED }

    function scriptRequest(url = 'https://cdn.example.com/late.js?sig=abc', resourceType = 'script', frame: Frame | null = null, id = `req-${url}`, response: HTTPResponse | null = null): HTTPRequest {
      return { resourceType: () => resourceType, url: () => url, frame: () => frame, id, response: () => response } as unknown as HTTPRequest
    }

    /** A response to `request` whose body read never settles — what Puppeteer does when the read's session disconnects. */
    const neverReadResponse = (request: HTTPRequest, url = 'https://cdn.example.com/late.js'): HTTPResponse =>
      ({ ...scriptResponse('never', url), request: () => request, text: () => new Promise<string>(() => undefined) }) as unknown as HTTPResponse

    it('returns nothing once every tracked read has settled', async () => {
      const reads = new PendingScriptReads()
      const response = scriptResponse('body')
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 2)
      expect(await reads.settle(1000, REASONS)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([])
    })

    // A read still in flight when the workflow ends would otherwise either be
    // cut off by the context closing or land after the run was summarised.
    it('returns the reads still pending at the deadline as unread, with the reading reason', async () => {
      const reads = new PendingScriptReads()
      const response = { ...scriptResponse('never'), status: () => 200, url: () => 'https://cdn.example.com/slow.js', text: () => new Promise<string>(() => undefined) } as unknown as HTTPResponse
      reads.track(scriptResponseHandler(response, []), response, 'loader-checkout', 7)

      expect(await reads.settle(10, REASONS)).toEqual([{ url: 'https://cdn.example.com/slow.js', resourceType: 'script', status: 200, reason: READING, step: 7, document: 'loader-checkout' }])
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

      const settled = reads.settle(1000, REASONS)
      const lateResponse = { ...scriptResponse('b'), url: () => 'https://cdn.example.com/late.js' } as unknown as HTTPResponse
      const late = new Promise<void>((resolve) => setTimeout(resolve, 50))
      reads.track(late, lateResponse, undefined, 3)
      releaseFirst()

      expect(await settled).toEqual([])
    })

    // A request issued by the last step has no read to wait for yet; without
    // this its response would land while the context was closing, after the
    // run had been summarised.
    it('waits for a script request whose response has not arrived, then lists it as unanswered rather than unread', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest(), 4, () => 'loader-confirm')
      expect(await reads.settle(50, REASONS)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([{ url: 'https://cdn.example.com/late.js?sig=abc', resourceType: 'script', reason: UNANSWERED, step: 4, document: 'loader-confirm' }])
    })

    it('stops waiting for a request once it fails, and never lists it', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest()
      reads.trackRequest(request, 4, () => undefined)
      const settling = reads.settle(5000, REASONS)
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
      await reads.settle(10, REASONS)
      reads.requestSettled(request)
      expect(reads.unansweredRequests()).toHaveLength(1)
    })

    it('hands a request over to its read when the response arrives, and returns it once — as unread — if that read is still pending at the deadline', async () => {
      const reads = new PendingScriptReads()
      const request = scriptRequest('https://cdn.example.com/app.js')
      reads.trackRequest(request, 4, () => undefined)
      const response = neverReadResponse(request, 'https://cdn.example.com/app.js')
      reads.track(scriptResponseHandler(response, []), response, 'loader-confirm', 4)
      expect(await reads.settle(50, REASONS)).toEqual([{ url: 'https://cdn.example.com/app.js', resourceType: 'script', status: 200, reason: READING, step: 4, document: 'loader-confirm' }])
      expect(reads.unansweredRequests()).toEqual([])
    })

    describe('a response that lands after the request was reported unanswered', () => {
      // The fail-secure half of the disposition: the script arrived and was
      // never compared, so it ends unread — recorded by the sealed handler.
      it('moves to unread once its read settles after the seal', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation()
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/late.js')
        reads.trackRequest(request, 6, () => 'loader-confirm')
        await reads.settle(10, REASONS)
        expect(reads.unansweredRequests()).toHaveLength(1)

        const unread: UnreadScriptResponse[] = []
        const detectedScripts: ScriptInfo[] = []
        const response = { ...scriptResponse('body', 'https://cdn.example.com/late.js'), request: () => request } as unknown as HTTPResponse
        reads.track(scriptResponseHandler(response, detectedScripts, 'loader-confirm', { unread, step: 6, sealed: () => true }), response, 'loader-confirm', 6)
        expect(await reads.settle(1000, REASONS)).toEqual([])

        expect(reads.unansweredRequests()).toEqual([])
        expect(detectedScripts).toEqual([])
        expect(unread).toEqual([{ url: 'https://cdn.example.com/late.js', resourceType: 'script', status: 200, reason: SCRIPT_READ_LATE_REASON, document: 'loader-confirm', step: 6 }])
        consoleError.mockRestore()
      })

      // Puppeteer never rejects a body read whose session disconnected, so a
      // read can hang forever. It must not drop off the unanswered list and
      // then vanish: until it settles it is a pending read, returned as
      // unread by the close-grace settle, and only that.
      it('is returned as unread by the next settle when its read never settles, and is no longer listed as unanswered', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/late.js')
        reads.trackRequest(request, 6, () => 'loader-confirm')
        await reads.settle(10, REASONS)
        const response = neverReadResponse(request)
        reads.track(scriptResponseHandler(response, [], 'loader-confirm', { unread: [], step: 6, sealed: () => true }), response, 'loader-confirm', 6)

        expect(reads.unansweredRequests()).toEqual([])
        expect(await reads.settle(10, { reading: 'still being read when the context closed', unanswered: UNANSWERED })).toEqual([
          { url: 'https://cdn.example.com/late.js', resourceType: 'script', status: 200, reason: 'still being read when the context closed', step: 6, document: 'loader-confirm' },
        ])
      })

      // A 404 or 502 is not a script that runs, and the handler records
      // nothing for it — so the request must stay on a list somewhere.
      it('stays listed, with the late answer in its reason, when that response is not a script that runs', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/late.js')
        reads.trackRequest(request, 6, () => 'loader-confirm')
        await reads.settle(10, REASONS)
        const notFound = { request: () => request, ok: () => false, status: () => 404, url: () => 'https://cdn.example.com/late.js' } as unknown as HTTPResponse
        reads.track(Promise.resolve(), notFound, 'loader-confirm', 6)

        expect(reads.unansweredRequests()).toEqual([{ url: 'https://cdn.example.com/late.js', resourceType: 'script', reason: `${UNANSWERED}; answered only afterwards, with HTTP 404`, step: 6, document: 'loader-confirm' }])
      })

      // The finished body under that request id is the error page's: a 404
      // never ran, so it must not become "no response was surfaced".
      it('stays listed with its status, and is never turned into an unread script, when its error page body then finishes', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/late.js', 'script', null, 'R-404')
        reads.trackRequest(request, 6, () => undefined)
        await reads.settle(10, REASONS)
        reads.track(Promise.resolve(), { request: () => request, ok: () => false, status: () => 502, url: () => 'https://cdn.example.com/late.js' } as unknown as HTTPResponse, undefined, 6)
        reads.bodyFinished('R-404')

        expect(await reads.settle(10, REASONS)).toEqual([])
        expect(reads.unansweredRequests()).toEqual([expect.objectContaining({ reason: `${UNANSWERED}; answered only afterwards, with HTTP 502` })])
      })

      // A redirect hop and its target share one DevTools request id, so the
      // target's finished body must not turn the hop into a second record.
      it('drops a redirect hop answered after the deadline, leaving exactly one record — for the script it redirected to', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation()
        const reads = new PendingScriptReads()
        const hop = scriptRequest('https://cdn.example.com/a.js', 'script', null, 'R-302')
        reads.trackRequest(hop, 6, () => 'loader-confirm')
        await reads.settle(10, REASONS)

        reads.track(Promise.resolve(), { request: () => hop, ok: () => false, status: () => 302, url: () => 'https://cdn.example.com/a.js' } as unknown as HTTPResponse, 'loader-confirm', 6)
        const target = scriptRequest('https://cdn.example.com/b.js', 'script', null, 'R-302')
        reads.trackRequest(target, 6, () => 'loader-confirm')
        const unread: UnreadScriptResponse[] = []
        const response = { ...scriptResponse('body', 'https://cdn.example.com/b.js'), request: () => target } as unknown as HTTPResponse
        reads.track(scriptResponseHandler(response, [], 'loader-confirm', { unread, step: 6, sealed: () => true }), response, 'loader-confirm', 6)
        reads.bodyFinished('R-302')

        expect(await reads.settle(1000, REASONS)).toEqual([])
        expect(reads.unansweredRequests()).toEqual([])
        expect(unread).toEqual([expect.objectContaining({ url: 'https://cdn.example.com/b.js', status: 200, reason: SCRIPT_READ_LATE_REASON })])
        consoleError.mockRestore()
      })
    })

    // Puppeteer emits requestfinished even when no response event was ever
    // surfaced (crbug.com/883475): the body was delivered, the script may
    // have run, and nothing read it.
    describe('a request that finishes with no response surfaced', () => {
      it('is returned as unread before the deadline', () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/pay.js')
        reads.trackRequest(request, 3, () => 'loader-checkout')
        expect(reads.requestFinished(request, 9, () => undefined)).toEqual({ url: 'https://cdn.example.com/pay.js', resourceType: 'script', status: 0, reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step: 3, document: 'loader-checkout' })
      })

      it('is returned as unread, and taken off the unanswered list, after the deadline', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/pay.js')
        reads.trackRequest(request, 3, () => 'loader-checkout')
        await reads.settle(10, REASONS)
        expect(reads.requestFinished(request, 9, () => undefined)).toMatchObject({ reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step: 3, document: 'loader-checkout' })
        expect(reads.unansweredRequests()).toEqual([])
      })

      it('is not returned when its response was surfaced, or when it is not a script', () => {
        const reads = new PendingScriptReads()
        const answered = scriptRequest('https://cdn.example.com/pay.js', 'script', null, 'r1', scriptResponse('body'))
        reads.trackRequest(answered, 3, () => undefined)
        expect(reads.requestFinished(answered, 3, () => undefined)).toBeUndefined()
        expect(reads.requestFinished(scriptRequest('https://cdn.example.com/a.css', 'stylesheet'), 3, () => undefined)).toBeUndefined()
      })
    })

    // Chrome's own Network.loadingFinished, seen on the monitor's sessions
    // independent of Puppeteer's event queueing: a request whose body is known
    // to have finished may have run, so it is never merely unanswered.
    describe('a request whose body Chrome reported finished', () => {
      it('is returned as unread at the deadline instead of being listed as unanswered', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/pay.js', 'script', null, 'R-7')
        reads.trackRequest(request, 5, () => 'loader-checkout')
        reads.bodyFinished('R-7')
        expect(await reads.settle(10, REASONS)).toEqual([{ url: 'https://cdn.example.com/pay.js', resourceType: 'script', status: 0, reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step: 5, document: 'loader-checkout' }])
        expect(reads.unansweredRequests()).toEqual([])
      })

      it('is moved from unanswered to unread by a later settle when the finish is reported after the deadline', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://cdn.example.com/pay.js', 'script', null, 'R-8')
        reads.trackRequest(request, 5, () => 'loader-checkout')
        await reads.settle(10, REASONS)
        reads.bodyFinished('R-8')
        expect(await reads.settle(10, REASONS)).toMatchObject([{ reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step: 5, document: 'loader-checkout' }])
        expect(reads.unansweredRequests()).toEqual([])
      })

      it("applies to a detached frame's request too", async () => {
        const frame = {} as Frame
        const reads = new PendingScriptReads()
        reads.trackRequest(scriptRequest('https://provider.example.test/challenge.js', 'script', frame, 'R-9'), 5, () => undefined)
        reads.frameDetached(frame)
        reads.bodyFinished('R-9')
        expect(await reads.settle(10, REASONS)).toMatchObject([{ reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON }])
        expect(reads.unansweredRequests()).toEqual([])
      })
    })

    describe('when the frame that issued a request is detached', () => {
      const frame = {} as Frame
      const otherFrame = {} as Frame

      // Puppeteer does not always report a torn-down frame's requests as
      // finished or failed, so waiting for them would spend the whole deadline.
      it('stops waiting for its requests at once, and lists those that neither finished nor failed as unanswered', async () => {
        const reads = new PendingScriptReads()
        reads.trackRequest(scriptRequest('https://provider.example.test/challenge.js', 'script', frame), 5, () => 'loader-checkout')
        const started = Date.now()
        const settling = reads.settle(5000, REASONS)
        reads.frameDetached(frame)
        expect(await settling).toEqual([])
        expect(Date.now() - started).toBeLessThan(1000)
        expect(reads.unansweredRequests()).toEqual([{ url: 'https://provider.example.test/challenge.js', resourceType: 'script', reason: SCRIPT_REQUEST_FRAME_DETACHED_REASON, step: 5, document: 'loader-checkout' }])
      })

      // What Chrome usually does: abort them, which Puppeteer reports.
      it('does not list a detached request that then failed', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://provider.example.test/challenge.js', 'script', frame)
        reads.trackRequest(request, 5, () => undefined)
        reads.frameDetached(frame)
        reads.requestSettled(request)
        await reads.settle(10, REASONS)
        expect(reads.unansweredRequests()).toEqual([])
      })

      it("keeps waiting for other frames' requests", async () => {
        const reads = new PendingScriptReads()
        reads.trackRequest(scriptRequest('https://provider.example.test/challenge.js', 'script', frame), 5, () => undefined)
        reads.trackRequest(scriptRequest('https://cdn.example.com/pay.js', 'script', otherFrame), 5, () => undefined)
        reads.frameDetached(frame)
        await reads.settle(20, REASONS)
        expect(reads.unansweredRequests().map((request) => request.reason)).toEqual([UNANSWERED, SCRIPT_REQUEST_FRAME_DETACHED_REASON])
      })

      // Not waited for is not forgotten: a response that lands before the
      // seal is read like any other.
      it('still reads a response that arrives for it after all, and no longer lists it', async () => {
        const reads = new PendingScriptReads()
        const request = scriptRequest('https://provider.example.test/challenge.js', 'script', frame)
        reads.trackRequest(request, 5, () => undefined)
        reads.frameDetached(frame)
        const detectedScripts: ScriptInfo[] = []
        const response = { ...scriptResponse('body', 'https://provider.example.test/challenge.js'), request: () => request } as unknown as HTTPResponse
        reads.track(scriptResponseHandler(response, detectedScripts, undefined, { unread: [], step: 5, sealed: () => false }), response, undefined, 5)
        expect(await reads.settle(1000, REASONS)).toEqual([])
        expect(detectedScripts).toHaveLength(1)
        expect(reads.unansweredRequests()).toEqual([])
      })
    })

    it('ignores requests that are not scripts', async () => {
      const reads = new PendingScriptReads()
      reads.trackRequest(scriptRequest('https://api.example.com/session', 'xhr'), 4, () => undefined)
      expect(await reads.settle(50, REASONS)).toEqual([])
      expect(reads.unansweredRequests()).toEqual([])
    })

    it('ignores responses the handler does not read', async () => {
      const reads = new PendingScriptReads()
      const stylesheet = { request: () => ({ resourceType: () => 'stylesheet' }), ok: () => true } as unknown as HTTPResponse
      reads.track(new Promise<void>(() => undefined), stylesheet, undefined, 1)
      expect(await reads.settle(10, REASONS)).toEqual([])
    })
  })

  describe('recordUnreadScript', () => {
    // A body-finished-without-response record carries no status; the same
    // script surfacing later with its real status is the same gap.
    it('treats a status-0 record and the same script with its real status as one', () => {
      const unread: UnreadScriptResponse[] = []
      recordUnreadScript(unread, { url: 'https://cdn.example.com/pay.js', resourceType: 'script', status: 0, reason: SCRIPT_BODY_WITHOUT_RESPONSE_REASON, step: 3, document: 'L' })
      recordUnreadScript(unread, { url: 'https://cdn.example.com/pay.js', resourceType: 'script', status: 200, reason: SCRIPT_READ_LATE_REASON, step: 3, document: 'L' })
      expect(unread).toHaveLength(1)
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

  describe("the attribution shim's own frame", () => {
    const SHIM = 'pci-attribution-0b6e1c2a.js'
    const sourceOf = (scripts: ScriptInfo[]) => scripts[0]!.source as { type: 'external'; initiator?: string; initiatorEvidence?: unknown }
    const through = async (callFrames: { url?: string }[], shim: string | null = SHIM) => {
      const detectedScripts: ScriptInfo[] = []
      await scriptResponseHandler(scriptResponse('body', 'https://cdn.example.net/sdk.js', { type: 'script', stack: { callFrames } }, 'https://pay.example.com/menu'), detectedScripts, undefined, undefined, shim ?? undefined)
      return sourceOf(detectedScripts)
    }

    // Seen in real Chrome: every DOM-inserted script's top frame was the
    // shim's appendChild wrapper, and the initiator fell back to the page.
    it('is taken off the top, so the script that called appendChild is the initiator', async () => {
      const source = await through([{ url: SHIM }, { url: 'https://js.vendor.example/loader.js' }])
      expect(source.initiator).toBe('https://js.vendor.example/loader.js')
      expect(source.initiatorEvidence).toEqual({ type: 'stack', topFrameUrl: 'https://js.vendor.example/loader.js' })
    })

    it('leaves an anonymous caller (a dynamically inserted inline script) anonymous', async () => {
      const source = await through([{ url: SHIM }, { url: '' }, { url: SHIM }, { url: 'https://js.vendor.example/loader.js' }])
      expect(source.initiator).toBe('https://pay.example.com/menu')
      expect(source.initiatorEvidence).toEqual({ type: 'stack', topFrameUrl: '' })
    })

    it('removes one frame only: a second frame claiming the shim name reads as anonymous, never as its caller', async () => {
      const source = await through([{ url: SHIM }, { url: SHIM }, { url: 'https://js.vendor.example/loader.js' }])
      expect(source.initiatorEvidence).toEqual({ type: 'stack', topFrameUrl: '' })
      expect(source.initiator).toBe('https://pay.example.com/menu')
    })

    it('is not skipped when it is not on top', async () => {
      const source = await through([{ url: 'https://evil.example/x.js' }, { url: SHIM }, { url: 'https://js.vendor.example/loader.js' }])
      expect(source.initiator).toBe('https://evil.example/x.js')
    })

    it('is left alone without a shim name', async () => {
      const source = await through([{ url: SHIM }, { url: 'https://js.vendor.example/loader.js' }], null)
      expect(source.initiator).toBe(SHIM)
    })
  })
})
