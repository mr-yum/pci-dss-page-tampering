import type { CDPSession, Frame, HTTPRequest, Page, Protocol } from 'puppeteer'

import type { DocumentId, DocumentTrailEntry } from '../types/document.js'

/**
 * Attributes every network observation of a workflow run to the top-level
 * browser document it belongs to, so a run can be scoped to the payment
 * page's SPA context.
 *
 * Built from Chrome DevTools events rather than timing, because only the
 * protocol knows which document issued a request:
 *
 * - A main-frame request carries the `loaderId` of the document that issued
 *   it. The navigation request itself carries the loader of the document it
 *   creates, so a page's own response is attributed to that page.
 * - A child frame belongs to the top-level document that was current when it
 *   attached. `Page.frameAttached` for a direct child arrives on the parent's
 *   session — this one — even for cross-origin frames, ordered after the
 *   parent's own `Page.frameNavigated`.
 *
 * Fail-secure: anything that cannot be attributed — an unknown request, a
 * frame we never saw attach, a main-frame request missing from the ledger —
 * returns `undefined`, which payment scoping treats as in scope. Attribution
 * may degrade (for instance if a Puppeteer upgrade drops the internal ids
 * read below); it can never move an observation out of scope by mistake.
 */
export class DocumentLedger {
  private mainFrameId: string | undefined
  private currentMain: DocumentId | undefined
  private readonly requestOrigins = new Map<string, { loaderId: string; frameId: string | undefined }>()
  private readonly frameOwners = new Map<string, DocumentId>()
  private readonly trail: DocumentTrailEntry[] = []
  private step = 0

  setMainFrame(frameId: string): void {
    this.mainFrameId = frameId
  }

  onFrameNavigated(frame: { id: string; parentId?: string | undefined; loaderId: string; url: string }): void {
    if (frame.parentId !== undefined) {
      // A child frame navigating keeps its owner; record it if we missed the attach.
      if (!this.frameOwners.has(frame.id)) {
        const owner = this.ownerOfFrame(frame.parentId)
        if (owner !== undefined) this.frameOwners.set(frame.id, owner)
      }
      return
    }
    if (this.mainFrameId === undefined) this.mainFrameId = frame.id
    if (frame.id !== this.mainFrameId || frame.loaderId === this.currentMain) return

    this.currentMain = frame.loaderId
    this.trail.push({ id: frame.loaderId, url: frame.url, routes: [], firstStep: this.step, lastStep: this.step })
  }

  /** A same-document navigation of the main frame: the current document now renders another route. */
  onNavigatedWithinDocument(frameId: string, url: string): void {
    if (frameId !== this.mainFrameId) return
    const current = this.trail.at(-1)
    if (current !== undefined && current.id === this.currentMain) current.routes.push(url)
  }

  onFrameAttached(frameId: string, parentFrameId: string): void {
    const owner = this.ownerOfFrame(parentFrameId)
    if (owner !== undefined) this.frameOwners.set(frameId, owner)
  }

  onRequestWillBeSent(requestId: string, loaderId: string, frameId: string | undefined): void {
    this.requestOrigins.set(requestId, { loaderId, frameId })
  }

  /** The document an observed request belongs to, or `undefined` when it cannot be attributed. */
  documentOfRequest(requestId: string | undefined, frameChain: readonly (string | undefined)[] = []): DocumentId | undefined {
    const origin = requestId === undefined ? undefined : this.requestOrigins.get(requestId)
    // An empty loaderId means a worker fetched it, and a missing frameId means
    // no frame did: neither names a document, so neither may be attributed.
    if (origin !== undefined && origin.loaderId !== '' && origin.frameId !== undefined) {
      if (origin.frameId === this.mainFrameId) return origin.loaderId
      const owner = this.frameOwners.get(origin.frameId)
      if (owner !== undefined) return owner
    }
    // Requests from out-of-process frames never reach this session. Walk the
    // frame chain (innermost first) to the nearest frame whose owner we saw
    // attach. A main-frame request missing from the ledger is deliberately
    // left unattributed: guessing "the current document" could pin a late
    // response from one page onto the next.
    for (const frameId of frameChain) {
      if (frameId === undefined || frameId === this.mainFrameId) return undefined
      const owner = this.frameOwners.get(frameId)
      if (owner !== undefined) return owner
    }
    return undefined
  }

  /** Workflow step now running; extends the current document's span. */
  setStep(step: number): void {
    this.step = step
    const current = this.trail.at(-1)
    if (current !== undefined && current.id === this.currentMain) current.lastStep = step
  }

  currentDocument(): DocumentId | undefined {
    return this.currentMain
  }

  documents(): DocumentTrailEntry[] {
    return this.trail.map((entry) => ({ ...entry, routes: [...entry.routes] }))
  }

  private ownerOfFrame(frameId: string): DocumentId | undefined {
    return frameId === this.mainFrameId ? this.currentMain : this.frameOwners.get(frameId)
  }
}

/**
 * Puppeteer does not expose the DevTools request or frame id publicly. Both
 * are stable at runtime (`HTTPRequest.id` is the CDP requestId, `Frame._id` the
 * CDP frameId); reading them through these guards means an upgrade that
 * removes them only degrades attribution to `undefined` — in scope — and never
 * throws.
 */
function requestIdOf(request: HTTPRequest): string | undefined {
  const id = (request as unknown as { id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

function frameIdOf(frame: Frame | null): string | undefined {
  const id = (frame as unknown as { _id?: unknown } | null)?._id
  return typeof id === 'string' ? id : undefined
}

/** A ledger attached to a live page. */
export class DocumentTracker {
  private constructor(
    private readonly page: Page,
    private readonly session: CDPSession,
    readonly ledger: DocumentLedger,
  ) {}

  /** Attach before the first navigation so the initial document is recorded. */
  static async attach(page: Page): Promise<DocumentTracker> {
    const ledger = new DocumentLedger()
    const session = await page.createCDPSession()
    session.on('Page.frameNavigated', (event: Protocol.Page.FrameNavigatedEvent) => {
      ledger.onFrameNavigated({ id: event.frame.id, parentId: event.frame.parentId, loaderId: event.frame.loaderId, url: event.frame.url })
    })
    session.on('Page.navigatedWithinDocument', (event: Protocol.Page.NavigatedWithinDocumentEvent) => ledger.onNavigatedWithinDocument(event.frameId, event.url))
    session.on('Page.frameAttached', (event: Protocol.Page.FrameAttachedEvent) => ledger.onFrameAttached(event.frameId, event.parentFrameId))
    session.on('Network.requestWillBeSent', (event: Protocol.Network.RequestWillBeSentEvent) => ledger.onRequestWillBeSent(event.requestId, event.loaderId, event.frameId))
    await session.send('Page.enable')
    await session.send('Network.enable')
    const { frameTree } = await session.send('Page.getFrameTree')
    ledger.setMainFrame(frameTree.frame.id)
    return new DocumentTracker(page, session, ledger)
  }

  documentOf(request: HTTPRequest): DocumentId | undefined {
    const chain: (string | undefined)[] = []
    for (let frame: Frame | null = request.frame(); frame !== null; frame = frame.parentFrame()) chain.push(frameIdOf(frame))
    return this.ledger.documentOfRequest(requestIdOf(request), chain)
  }

  /**
   * The top-level document committed right now, read from the browser rather
   * than from buffered events, so it is exact at the moment of the call.
   */
  async currentDocument(): Promise<DocumentId | undefined> {
    try {
      const { frameTree } = await this.session.send('Page.getFrameTree')
      return frameTree.frame.loaderId
    } catch {
      return undefined
    }
  }

  /** Whether request/frame ids are readable on this Puppeteer build; logged once so degradation is visible. */
  attributionAvailable(): boolean {
    return frameIdOf(this.page.mainFrame()) !== undefined
  }
}
