import type { DetectionSummary } from '../types/detection.js'
import type { PaymentScope } from '../types/document.js'
import { headerObservationKey } from '../types/header.js'
import type { ScriptInfo } from '../types/script.js'
import { outsidePaymentDocuments, partitionByPaymentScope } from './payment-scope.js'

const external = (url: string, document?: string): ScriptInfo => ({
  source: { type: 'external', url, content: `/* ${url} */` },
  hash: { value: `hash-${url}` } as ScriptInfo['hash'],
  ...(document === undefined ? {} : { document }),
})
const inline = (id: string, document?: string): ScriptInfo => ({
  source: { type: 'inline', id, content: `/* ${id} */` },
  hash: { value: `hash-${id}` } as ScriptInfo['hash'],
  ...(document === undefined ? {} : { document }),
})

const BOOKING = 'loader-booking'
const CHECKOUT = 'loader-checkout'
const scope = (overrides: Partial<PaymentScope> = {}): PaymentScope => ({
  declared: true,
  paymentDocuments: [CHECKOUT],
  documents: [
    { id: BOOKING, url: 'https://book.example.test/venue', routes: [], firstStep: 0, lastStep: 3 },
    { id: CHECKOUT, url: 'https://book.example.test/venue/checkout', routes: [], firstStep: 4, lastStep: 9 },
  ],
  ...overrides,
})

const summary = (paymentScope?: PaymentScope): DetectionSummary => {
  const csp = 'content-security-policy'
  const headers = new Map([
    [
      csp,
      new Map([
        ["script-src 'self' https://*.tagmanager.example", new Set(['https://book.example.test/venue'])],
        ["script-src 'self' 'nonce-x' https://js.payments.example", new Set(['https://book.example.test/venue/checkout'])],
        ["default-src 'self'", new Set(['https://book.example.test/venue', 'https://book.example.test/venue/checkout'])],
        ["img-src 'self'", new Set(['https://book.example.test/unattributed'])],
      ]),
    ],
  ])
  const documents = new Map<string, Set<string | null>>([
    [headerObservationKey(csp, "script-src 'self' https://*.tagmanager.example", 'https://book.example.test/venue'), new Set([BOOKING])],
    [headerObservationKey(csp, "script-src 'self' 'nonce-x' https://js.payments.example", 'https://book.example.test/venue/checkout'), new Set([CHECKOUT])],
    [headerObservationKey(csp, "default-src 'self'", 'https://book.example.test/venue'), new Set([BOOKING])],
    [headerObservationKey(csp, "default-src 'self'", 'https://book.example.test/venue/checkout'), new Set([CHECKOUT])],
    // img-src has no index entry: unattributed
  ])
  return {
    target: { type: 'detection', url: 'https://book.example.test/venue', workflow: {} as any, logger: {} as any },
    scriptSummary: {
      externalScripts: [external('https://tagmanager.example/tm.js', BOOKING), external('https://js.payments.example/v3', BOOKING), external('https://js.payments.example/v3', CHECKOUT), external('https://cdn.example/unattributed.js')],
      inlineScripts: [inline('inline_script/booking', BOOKING), inline('inline_script/checkout', CHECKOUT), inline('inline_script/unattributed')],
    },
    headerSummary: {
      headers,
      documents,
      responses: [
        { url: 'https://book.example.test/venue', resourceType: 'document', headerNames: new Set([csp]), document: BOOKING },
        { url: 'https://book.example.test/venue/checkout', resourceType: 'document', headerNames: new Set([csp]), document: CHECKOUT },
        { url: 'https://book.example.test/late', resourceType: 'document', headerNames: new Set() },
      ],
    },
    ...(paymentScope === undefined ? {} : { paymentScope }),
  }
}

const urls = (scripts: ScriptInfo[]) => scripts.map((s) => (s.source.type === 'external' ? `${s.source.url}@${s.document ?? '?'}` : `${s.source.id}@${s.document ?? '?'}`))

describe('partitionByPaymentScope', () => {
  it('keeps the whole run in scope when no payment page is declared', () => {
    const input = summary()
    const { payment, outsidePayment } = partitionByPaymentScope(input)
    expect(outsidePayment).toBeNull()
    expect(payment.headerSummary).toBe(input.headerSummary)
    expect(payment.scriptSummary.inlineScripts).toHaveLength(3)
  })

  it('keeps the whole run in scope when a payment page is declared but never resolved', () => {
    const input = summary(scope({ paymentDocuments: [] }))
    const { payment, outsidePayment } = partitionByPaymentScope(input)
    expect(outsidePayment).toBeNull()
    expect(payment.headerSummary).toBe(input.headerSummary)
  })

  // Capture keeps a copy per document so the payment page's copy survives
  // scoping. A run with no payment page must still compare each script once,
  // as it did before documents were tracked, or it would alert twice.
  it('compares a script loaded on two pages once when the whole run is in scope', () => {
    const { payment } = partitionByPaymentScope(summary())
    expect(urls(payment.scriptSummary.externalScripts)).toEqual(['https://tagmanager.example/tm.js@loader-booking', 'https://js.payments.example/v3@loader-booking', 'https://cdn.example/unattributed.js@?'])
  })

  // Copies of one script captured in two documents may have been loaded into
  // frames on different origins; the copy kept for comparison then has no
  // single frame, so it may not bind a document hop to either.
  describe('the frame a collapsed script was loaded into', () => {
    const inFrame = (document: string, frameUrl?: string): ScriptInfo => {
      const script = external('https://js.payments.example/v3', document)
      return frameUrl === undefined ? script : { ...script, source: { ...(script.source as { type: 'external'; url: string; content: string }), frameUrl } }
    }
    const collapsed = (scripts: ScriptInfo[]) => {
      const base = summary()
      return partitionByPaymentScope({ ...base, scriptSummary: { ...base.scriptSummary, externalScripts: scripts } }).payment.scriptSummary.externalScripts
    }

    it('keeps the frame when every copy agrees on its origin', () => {
      const [kept] = collapsed([inFrame(BOOKING, 'https://pay.vendor.example/a'), inFrame(CHECKOUT, 'https://pay.vendor.example/b')])
      expect(kept!.source).toHaveProperty('frameUrl', 'https://pay.vendor.example/a')
    })

    // Copies that disagree have no single frame, whichever came first: a copy
    // with no frame never lends the binding to one that has it, or the reverse.
    it('never adopts a frame from a later copy when the first had none', () => {
      const [kept] = collapsed([inFrame(BOOKING), inFrame(CHECKOUT, 'https://pay.vendor.example/a')])
      expect(kept!.source).not.toHaveProperty('frameUrl')
    })

    it.each([
      ['a frame on another origin', 'https://book.example.test/venue/checkout'],
      ['no frame', undefined],
    ])('drops it when another copy was loaded into %s, without touching the summary', (_label, other) => {
      const first = inFrame(BOOKING, 'https://pay.vendor.example/a')
      const scripts = [first, inFrame(CHECKOUT, other)]
      const result = collapsed(scripts)
      expect(result).toHaveLength(1)
      expect(result[0]!.source).not.toHaveProperty('frameUrl')
      expect(result[0]!.document).toBe(BOOKING)
      expect(first.source).toHaveProperty('frameUrl', 'https://pay.vendor.example/a')
    })
  })

  // Detection always deduped inline scripts by hash across scans, but kept two
  // identical scripts found in the same scan (they may differ in initiator).
  // The collapse must undo only the per-document copies capture now keeps.
  it('collapses cross-document copies of an inline script but keeps same-scan duplicates', () => {
    const input = summary(scope())
    const sameBody = (id: string, document: string, initiator: string): ScriptInfo => ({ source: { type: 'inline', id, content: 'same', url: initiator }, hash: { value: 'hash-same' } as ScriptInfo['hash'], document })
    input.scriptSummary.inlineScripts = [
      sameBody('inline_script/a', BOOKING, 'https://book.example.test/a.js'),
      sameBody('inline_script/a', CHECKOUT, 'https://book.example.test/a.js'),
      sameBody('inline_script/a', CHECKOUT, 'https://evil.example.test/inject.js'),
    ]
    const { payment, outsidePayment } = partitionByPaymentScope(input)
    expect(payment.scriptSummary.inlineScripts.map((s) => s.source.type === 'inline' && s.source.url)).toEqual(['https://book.example.test/a.js', 'https://evil.example.test/inject.js'])
    expect(urls(outsidePayment!.scriptSummary.inlineScripts)).toEqual(['inline_script/a@loader-booking'])
  })

  it('collapses an inline script seen in two documents of an unscoped run to the first, as before', () => {
    const input = summary()
    const sameBody = (document: string): ScriptInfo => ({ source: { type: 'inline', id: 'inline_script/a', content: 'same' }, hash: { value: 'hash-same' } as ScriptInfo['hash'], document })
    input.scriptSummary.inlineScripts = [sameBody(BOOKING), sameBody(CHECKOUT)]
    expect(urls(partitionByPaymentScope(input).payment.scriptSummary.inlineScripts)).toEqual(['inline_script/a@loader-booking'])
  })

  describe('which documents leave scope', () => {
    const CONFIRM = 'loader-confirmation'
    const RELOAD = 'loader-checkout-reload'
    const chain = (...documents: ([string, string] | [string, string, string[]])[]): PaymentScope['documents'] => documents.map(([id, url, routes], index) => ({ id, url, routes: routes ?? [], firstStep: index, lastStep: index }))

    it('keeps every document loaded after the payment page in scope (3-D Secure, confirmation, reload recovery)', () => {
      const scoped = scope({
        documents: chain([BOOKING, 'https://book.example.test/venue'], [CHECKOUT, 'https://book.example.test/venue/checkout'], [RELOAD, 'https://book.example.test/venue/checkout'], [CONFIRM, 'https://acs.bank.example/3ds']),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set([BOOKING]))
    })

    // Reload recovery on the marked step replaces a failed first render with a
    // new document; the failed render may be the one a skimmer broke.
    it('keeps an earlier render of the payment page itself in scope', () => {
      const scoped = scope({
        paymentDocuments: [RELOAD],
        documents: chain([BOOKING, 'https://book.example.test/venue'], [CHECKOUT, 'https://book.example.test/venue/checkout?attempt=1'], [RELOAD, 'https://book.example.test/venue/checkout/']),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set([BOOKING]))
    })

    // The app loaded /venue, routed client-side to the checkout path, and the
    // card form failed to mount there; reload recovery reloaded the current
    // route as a new document. The failed render was never *loaded* at the
    // checkout path, but it rendered it — and may be what a skimmer broke.
    it('keeps an earlier document that client-side-routed to the payment path in scope', () => {
      const scoped = scope({
        paymentDocuments: [RELOAD],
        documents: chain([BOOKING, 'https://book.example.test/venue', ['https://book.example.test/venue/upgrades', 'https://book.example.test/venue/checkout?step=card']], [RELOAD, 'https://book.example.test/venue/checkout']),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set())
    })

    it('keeps an earlier document in scope when the payment document itself client-side-routed to a path it rendered', () => {
      const scoped = scope({
        documents: chain([BOOKING, 'https://book.example.test/venue/card'], [CHECKOUT, 'https://book.example.test/venue/checkout', ['https://book.example.test/venue/card']]),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set())
    })

    // A back/forward-cache restore keeps the original document id, so an
    // earlier page the app returns to after payment reappears in the chain.
    it('keeps an earlier page the browser restores after the payment page in scope', () => {
      const scoped = scope({
        documents: chain([BOOKING, 'https://book.example.test/venue'], [CHECKOUT, 'https://book.example.test/venue/checkout'], [BOOKING, 'https://book.example.test/venue']),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set())
    })

    it('still separates an earlier page that only routed between non-payment paths', () => {
      const scoped = scope({
        documents: chain([BOOKING, 'https://book.example.test/venue', ['https://book.example.test/venue/upgrades']], [CHECKOUT, 'https://book.example.test/venue/checkout']),
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set([BOOKING]))
    })

    // Initial-step recovery reloads the start URL, which can redirect to a
    // per-visit path: the failed render it replaced shares no path with the
    // payment page, so only detection's record of the recovery keeps it in.
    it("keeps a document the monitor's recovery replaced with the payment page in scope, whatever its path", () => {
      const scoped = scope({
        paymentDocuments: [RELOAD],
        documents: chain([BOOKING, 'https://book.example.test/session/abc'], [RELOAD, 'https://book.example.test/session/def']),
        recoveryReplaced: [BOOKING],
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set())
    })

    // Recovery anywhere is recorded; the replaced render takes the scope of
    // what replaced it. A failed render of an earlier page leaves with it.
    it('leaves a failed render of an earlier page outside when recovery replaced it with that earlier page', () => {
      const scoped = scope({
        documents: chain(['B1', 'https://book.example.test/session/a'], ['B2', 'https://book.example.test/session/b'], [CHECKOUT, 'https://book.example.test/venue/checkout']),
        recoveryReplaced: ['B1'],
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set(['B1', 'B2']))
    })

    // Recovery of a render recovery produced: B1 -> B2 -> payment page. Both
    // are failed renders of the payment page; one pass would miss B1.
    it('follows a chain of recoveries to the payment page', () => {
      const scoped = scope({
        documents: chain(['B1', 'https://book.example.test/session/a'], ['B2', 'https://book.example.test/session/b'], [CHECKOUT, 'https://book.example.test/venue/checkout']),
        recoveryReplaced: ['B1', 'B2'],
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set())
    })

    it('keeps a recovery-replaced document with no successor in the chain in scope', () => {
      const scoped = scope({
        paymentDocuments: [CHECKOUT],
        documents: chain([BOOKING, 'https://book.example.test/venue'], [CHECKOUT, 'https://book.example.test/venue/checkout']),
        recoveryReplaced: ['loader-never-in-chain'],
      })
      expect(outsidePaymentDocuments(scoped)).toEqual(new Set([BOOKING]))
    })

    it('keeps a document missing from the page chain in scope', () => {
      const input = summary(scope())
      input.scriptSummary.externalScripts.push(external('https://cdn.example/aborted-navigation.js', 'loader-never-committed'))
      expect(urls(partitionByPaymentScope(input).payment.scriptSummary.externalScripts)).toContain('https://cdn.example/aborted-navigation.js@loader-never-committed')
    })

    it('does not scope at all when the payment document is missing from the chain', () => {
      expect(outsidePaymentDocuments(scope({ paymentDocuments: ['loader-unknown'] }))).toBeNull()
      expect(partitionByPaymentScope(summary(scope({ paymentDocuments: ['loader-unknown'] }))).outsidePayment).toBeNull()
    })

    it('still separates a scoped run whose payment page is the first document, with nothing outside', () => {
      const { outsidePayment } = partitionByPaymentScope(summary(scope({ paymentDocuments: [BOOKING] })))
      expect(outsidePayment).not.toBeNull()
      expect(outsidePayment!.scriptSummary.externalScripts).toEqual([])
    })
  })

  it('moves only scripts attributed to a known non-payment document out of scope', () => {
    const { payment, outsidePayment } = partitionByPaymentScope(summary(scope()))
    expect(urls(payment.scriptSummary.externalScripts)).toEqual(['https://js.payments.example/v3@loader-checkout', 'https://cdn.example/unattributed.js@?'])
    expect(urls(outsidePayment!.scriptSummary.externalScripts)).toEqual(['https://tagmanager.example/tm.js@loader-booking', 'https://js.payments.example/v3@loader-booking'])
    expect(urls(payment.scriptSummary.inlineScripts)).toEqual(['inline_script/checkout@loader-checkout', 'inline_script/unattributed@?'])
    expect(urls(outsidePayment!.scriptSummary.inlineScripts)).toEqual(['inline_script/booking@loader-booking'])
  })

  it('scopes header observations by the documents they were seen in', () => {
    const { payment, outsidePayment } = partitionByPaymentScope(summary(scope()))
    const csp = (map: Map<string, Map<string, Set<string>>>) => Object.fromEntries([...(map.get('content-security-policy') ?? new Map())].map(([v, u]) => [v, [...u]]))

    expect(csp(payment.headerSummary.headers)).toEqual({
      "script-src 'self' 'nonce-x' https://js.payments.example": ['https://book.example.test/venue/checkout'],
      "default-src 'self'": ['https://book.example.test/venue/checkout'],
      // never attributed: stays in scope
      "img-src 'self'": ['https://book.example.test/unattributed'],
    })
    expect(csp(outsidePayment!.headerSummary.headers)).toEqual({
      "script-src 'self' https://*.tagmanager.example": ['https://book.example.test/venue'],
      "default-src 'self'": ['https://book.example.test/venue'],
    })
  })

  it('puts a header value seen on both an earlier page and the payment page in both scopes', () => {
    const input = summary(scope())
    const key = headerObservationKey('content-security-policy', "default-src 'self'", 'https://book.example.test/venue')
    input.headerSummary.documents!.set(key, new Set([BOOKING, CHECKOUT]))
    const { payment, outsidePayment } = partitionByPaymentScope(input)

    expect([...payment.headerSummary.headers.get('content-security-policy')!.get("default-src 'self'")!]).toContain('https://book.example.test/venue')
    expect([...outsidePayment!.headerSummary.headers.get('content-security-policy')!.get("default-src 'self'")!]).toContain('https://book.example.test/venue')
  })

  it('keeps an unattributed observation in scope even alongside known documents', () => {
    const input = summary(scope())
    const key = headerObservationKey('content-security-policy', "script-src 'self' https://*.tagmanager.example", 'https://book.example.test/venue')
    input.headerSummary.documents!.set(key, new Set([BOOKING, null]))
    const { payment } = partitionByPaymentScope(input)

    expect(payment.headerSummary.headers.get('content-security-policy')!.has("script-src 'self' https://*.tagmanager.example")).toBe(true)
  })

  it('scopes required-header response occurrences by document, keeping unattributed ones in scope', () => {
    const { payment, outsidePayment } = partitionByPaymentScope(summary(scope()))
    expect(payment.headerSummary.responses!.map((r) => r.url)).toEqual(['https://book.example.test/venue/checkout', 'https://book.example.test/late'])
    expect(outsidePayment!.headerSummary.responses!.map((r) => r.url)).toEqual(['https://book.example.test/venue'])
  })

  it('treats every payment document as in scope when several steps are marked', () => {
    const { payment, outsidePayment } = partitionByPaymentScope(summary(scope({ paymentDocuments: [BOOKING, CHECKOUT] })))
    expect(outsidePayment!.scriptSummary.externalScripts).toEqual([])
    // the SDK loaded in both payment documents is compared once
    expect(urls(payment.scriptSummary.externalScripts)).toEqual(['https://tagmanager.example/tm.js@loader-booking', 'https://js.payments.example/v3@loader-booking', 'https://cdn.example/unattributed.js@?'])
  })
})
