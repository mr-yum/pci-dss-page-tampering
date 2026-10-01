import type { HTTPRequest, Page } from 'puppeteer'

import { DocumentLedger, DocumentTracker } from './document-ledger.js'

const MAIN = 'frame-main'

// Event sequences follow what Chrome emits: the navigation request carries the
// new document's loaderId (requestId === loaderId), then the main frame commits
// with Page.frameNavigated, then the new document's subresources and frames.
function bookingThenCheckout(): DocumentLedger {
  const ledger = new DocumentLedger()
  ledger.setMainFrame(MAIN)
  ledger.onRequestWillBeSent('L1', 'L1', MAIN) // booking page navigation
  ledger.onFrameNavigated({ id: MAIN, loaderId: 'L1', url: 'https://book.example.test/venue' })
  ledger.onRequestWillBeSent('r-tm', 'L1', MAIN) // tag manager on booking
  ledger.setStep(2)
  ledger.onRequestWillBeSent('r-sdk-early', 'L1', MAIN) // SDK preloaded after a soft navigation, same document
  ledger.setStep(4)
  ledger.onRequestWillBeSent('L2', 'L2', MAIN) // full page load into checkout
  ledger.onRequestWillBeSent('r-late', 'L1', MAIN) // booking page request still in flight
  ledger.onFrameNavigated({ id: MAIN, loaderId: 'L2', url: 'https://book.example.test/venue/checkout' })
  ledger.onRequestWillBeSent('r-sdk', 'L2', MAIN)
  ledger.onFrameAttached('frame-card', MAIN) // card iframe on checkout
  ledger.onRequestWillBeSent('r-card', 'L-card', 'frame-card')
  ledger.setStep(9)
  return ledger
}

describe('DocumentLedger', () => {
  it('attributes each main-frame request to the document that issued it', () => {
    const ledger = bookingThenCheckout()
    expect(ledger.documentOfRequest('r-tm')).toBe('L1')
    expect(ledger.documentOfRequest('r-sdk-early')).toBe('L1')
    expect(ledger.documentOfRequest('r-sdk')).toBe('L2')
  })

  it("attributes a page's own navigation response to the document it creates", () => {
    const ledger = bookingThenCheckout()
    expect(ledger.documentOfRequest('L1')).toBe('L1')
    expect(ledger.documentOfRequest('L2')).toBe('L2')
  })

  it('keeps a request issued by the previous page on that page, even after the next one commits', () => {
    expect(bookingThenCheckout().documentOfRequest('r-late')).toBe('L1')
  })

  it('attributes a child frame to the top-level document current when it attached', () => {
    expect(bookingThenCheckout().documentOfRequest('r-card')).toBe('L2')
  })

  it('attributes an out-of-process frame through its frame chain', () => {
    const ledger = bookingThenCheckout()
    ledger.onFrameAttached('frame-nested', 'frame-card')
    // request id unknown to this session (out-of-process frame): innermost frame first
    expect(ledger.documentOfRequest('oopif-request', ['frame-nested', 'frame-card', MAIN])).toBe('L2')
    expect(ledger.documentOfRequest(undefined, ['frame-card', MAIN])).toBe('L2')
  })

  it('does not start a new document on a client-side route change', () => {
    const ledger = bookingThenCheckout()
    expect(ledger.documents().map((d) => d.id)).toEqual(['L1', 'L2'])
    // A same-document navigation never produces a new loaderId; re-reporting the current one is ignored.
    ledger.onFrameNavigated({ id: MAIN, loaderId: 'L2', url: 'https://book.example.test/venue/checkout?step=2' })
    expect(ledger.documents().map((d) => d.id)).toEqual(['L1', 'L2'])
  })

  it('records which steps each document spanned', () => {
    expect(bookingThenCheckout().documents()).toEqual([
      { id: 'L1', url: 'https://book.example.test/venue', routes: [], firstStep: 0, lastStep: 4 },
      { id: 'L2', url: 'https://book.example.test/venue/checkout', routes: [], firstStep: 4, lastStep: 9 },
    ])
  })

  it('records the routes a document renders through client-side navigation, main frame only', () => {
    const ledger = new DocumentLedger()
    ledger.setMainFrame(MAIN)
    ledger.onFrameNavigated({ id: MAIN, loaderId: 'L1', url: 'https://book.example.test/venue' })
    ledger.onNavigatedWithinDocument(MAIN, 'https://book.example.test/venue/upgrades')
    ledger.onNavigatedWithinDocument('frame-card', 'https://payments.example.test/card#ready')
    ledger.onNavigatedWithinDocument(MAIN, 'https://book.example.test/venue/checkout')
    expect(ledger.documents()[0]!.routes).toEqual(['https://book.example.test/venue/upgrades', 'https://book.example.test/venue/checkout'])
  })

  it('records a page restored from the back/forward cache as another appearance of the same document', () => {
    const ledger = bookingThenCheckout()
    ledger.onFrameNavigated({ id: MAIN, loaderId: 'L1', url: 'https://book.example.test/venue' })
    expect(ledger.documents().map((d) => d.id)).toEqual(['L1', 'L2', 'L1'])
    expect(ledger.currentDocument()).toBe('L1')
  })

  describe('fails secure: unattributable observations return undefined (kept in scope)', () => {
    it('for a request this session never saw', () => {
      expect(bookingThenCheckout().documentOfRequest('unknown')).toBeUndefined()
    })

    it('for a worker request, whose loaderId is empty', () => {
      const ledger = bookingThenCheckout()
      ledger.onRequestWillBeSent('r-worker', '', undefined)
      expect(ledger.documentOfRequest('r-worker')).toBeUndefined()
    })

    it('for a frame that was never seen attaching', () => {
      const ledger = bookingThenCheckout()
      ledger.onRequestWillBeSent('r-ghost', 'L-ghost', 'frame-ghost')
      expect(ledger.documentOfRequest('r-ghost')).toBeUndefined()
    })

    it('for a main-frame request missing from the ledger, rather than guessing the current page', () => {
      expect(bookingThenCheckout().documentOfRequest('missing', [MAIN])).toBeUndefined()
    })

    it('when the frame chain cannot be read', () => {
      expect(bookingThenCheckout().documentOfRequest(undefined, [undefined, 'frame-card'])).toBeUndefined()
    })
  })
})

describe('DocumentTracker', () => {
  // A DevTools session that records handlers so the test can emit Chrome's events.
  function fakeSession() {
    const handlers = new Map<string, (event: any) => void>()
    return {
      handlers,
      emit: (event: string, payload: object) => handlers.get(event)!(payload),
      on: jest.fn((event: string, handler: (payload: any) => void) => handlers.set(event, handler)),
      send: jest.fn(async (method: string) => (method === 'Page.getFrameTree' ? { frameTree: { frame: { id: MAIN, loaderId: 'L-current' } } } : {})),
    }
  }
  type FakeFrame = { _id?: string; parentFrame: () => FakeFrame | null }
  const frame = (id: string | undefined, parent: FakeFrame | null = null): FakeFrame => ({ ...(id === undefined ? {} : { _id: id }), parentFrame: () => parent })
  const request = (id: string | undefined, of: FakeFrame | null) => ({ ...(id === undefined ? {} : { id }), frame: () => of }) as unknown as HTTPRequest

  async function attached(mainFrame: FakeFrame = frame(MAIN)) {
    const session = fakeSession()
    const page = { createCDPSession: jest.fn().mockResolvedValue(session), mainFrame: () => mainFrame } as unknown as Page
    const tracker = await DocumentTracker.attach(page)
    session.emit('Network.requestWillBeSent', { requestId: 'L1', loaderId: 'L1', frameId: MAIN })
    session.emit('Page.frameNavigated', { frame: { id: MAIN, loaderId: 'L1', url: 'https://book.example.test/venue' } })
    session.emit('Network.requestWillBeSent', { requestId: 'r-main', loaderId: 'L1', frameId: MAIN })
    session.emit('Page.frameAttached', { frameId: 'frame-card', parentFrameId: MAIN })
    return { tracker, session, mainFrame }
  }

  it('enables the domains it listens to and learns the main frame before the first navigation', async () => {
    const { session } = await attached()
    expect(session.send).toHaveBeenCalledWith('Page.enable')
    expect(session.send).toHaveBeenCalledWith('Network.enable')
    expect([...session.handlers.keys()].sort()).toEqual(['Network.requestWillBeSent', 'Page.frameAttached', 'Page.frameNavigated', 'Page.navigatedWithinDocument'])
  })

  it('feeds session events into the ledger and resolves a Puppeteer request by its DevTools id', async () => {
    const { tracker, mainFrame, session } = await attached()
    session.emit('Page.navigatedWithinDocument', { frameId: MAIN, url: 'https://book.example.test/venue/checkout' })
    expect(tracker.documentOf(request('r-main', mainFrame as never))).toBe('L1')
    expect(tracker.ledger.documents()).toEqual([expect.objectContaining({ id: 'L1', routes: ['https://book.example.test/venue/checkout'] })])
  })

  it('resolves an out-of-process frame request through the frame chain', async () => {
    const { tracker, mainFrame } = await attached()
    const card = frame('frame-card', mainFrame)
    const nested = frame('frame-nested-in-oopif', card)
    expect(tracker.documentOf(request('oopif-request-unknown-here', nested as never))).toBe('L1')
  })

  it('leaves a request unattributed when Puppeteer does not expose the ids it reads', async () => {
    const { tracker } = await attached(frame(undefined))
    const anonymous = frame(undefined, frame(undefined))
    expect(tracker.documentOf(request(undefined, anonymous as never))).toBeUndefined()
    expect(tracker.attributionAvailable()).toBe(false)
  })

  it('reports attribution as available when the main frame id is readable', async () => {
    expect((await attached()).tracker.attributionAvailable()).toBe(true)
  })

  it('reads the current document from the browser, and degrades to undefined if it cannot', async () => {
    const { tracker, session } = await attached()
    expect(await tracker.currentDocument()).toBe('L-current')
    session.send.mockRejectedValueOnce(new Error('target closed'))
    expect(await tracker.currentDocument()).toBeUndefined()
  })
})
