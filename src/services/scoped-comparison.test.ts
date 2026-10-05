import type { DetectionSummary } from '../types/detection.js'
import type { PaymentScope } from '../types/document.js'
import { headerObservationKey } from '../types/header.js'
import type { Inventory } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { ScriptInfo, UnansweredScriptRequest, UnreadScriptResponse } from '../types/script.js'
import type { TargetDetection } from '../types/target.js'
import { HeaderComparisonService } from './comparison/header.js'
import { ScriptComparisonService } from './comparison/script.js'
import { compareWithPaymentScope, reportRecordsFor, type ScopedComparison } from './scoped-comparison.js'

const quiet = { log: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
const target: TargetDetection = { type: 'detection', url: 'https://book.example.test/venue', workflow: { fileName: 'w.json', definition: { steps: [] } }, logger: quiet }
const inventory = { scripts: [], headers: [], alerts: {} } as unknown as Inventory
const services = { scripts: new ScriptComparisonService(), headers: new HeaderComparisonService() }

const script = (path: string, document: string): ScriptInfo => ({
  source: { type: 'external', url: `https://cdn.example.test${path}`, content: `/* ${path} */` },
  hash: { value: `hash${path}` } as ScriptInfo['hash'],
  document,
})
const detection = (scripts: ScriptInfo[], paymentScope?: PaymentScope, unreadScripts?: UnreadScriptResponse[], unansweredRequests?: UnansweredScriptRequest[]): DetectionSummary => ({
  target,
  scriptSummary: { externalScripts: scripts, inlineScripts: [], ...(unreadScripts === undefined ? {} : { unreadScripts }), ...(unansweredRequests === undefined ? {} : { unansweredRequests }) },
  headerSummary: { headers: new Map(), responses: [] },
  ...(paymentScope === undefined ? {} : { paymentScope }),
})
const chain: PaymentScope['documents'] = [
  { id: 'L-booking', url: 'https://book.example.test/venue', routes: [], firstStep: 0, lastStep: 2 },
  { id: 'L-checkout', url: 'https://book.example.test/venue/checkout', routes: [], firstStep: 2, lastStep: 3 },
  { id: 'L-3ds', url: 'https://acs.bank.example/challenge', routes: [], firstStep: 3, lastStep: 4 },
]
const names = (results: { type: string }[]) => results.map((result) => (result as unknown as { script: { name: string } }).script?.name ?? result.type).sort()

describe('compareWithPaymentScope', () => {
  // Capture keeps one copy per document; an unmarked run must still compare
  // (and so alert on) each script once, exactly as before.
  it('compares a script loaded in two documents once when the run is not scoped', async () => {
    const { payment, outside } = await compareWithPaymentScope(detection([script('/sdk.js', 'L-booking'), script('/sdk.js', 'L-checkout')]), inventory, services)
    expect(names(payment.scripts)).toEqual(['https://cdn.example.test/sdk.js'])
    expect(outside).toBeNull()
  })

  it('only lets the payment page and later pages reach alerting; earlier pages go to the report', async () => {
    const scope: PaymentScope = { declared: true, paymentDocuments: ['L-checkout'], documents: chain }
    const { payment, outside } = await compareWithPaymentScope(detection([script('/tag-manager.js', 'L-booking'), script('/sdk.js', 'L-booking'), script('/sdk.js', 'L-checkout'), script('/3ds.js', 'L-3ds')], scope), inventory, services)
    expect(names(payment.scripts)).toEqual(['https://cdn.example.test/3ds.js', 'https://cdn.example.test/sdk.js'])
    expect(names(outside!)).toEqual(['https://cdn.example.test/sdk.js', 'https://cdn.example.test/tag-manager.js'])
  })

  describe('unread scripts', () => {
    const unread = (path: string, document?: string): UnreadScriptResponse => ({
      url: `https://cdn.example.test${path}?token=secret`,
      resourceType: 'script',
      status: 200,
      reason: 'Could not load response body for this request. This might happen if the request is a preflight request.',
      step: 4,
      ...(document === undefined ? {} : { document }),
    })
    const scope: PaymentScope = { declared: true, paymentDocuments: ['L-checkout'], documents: chain }

    // Same rule as every other observation: only a script attributed to an
    // earlier page the payment page replaced leaves scope. An unattributed
    // one stays in — attribution failing must never hide a gap.
    it('splits unread scripts by payment scope, keeping unattributed ones in scope', async () => {
      const { unread: split } = await compareWithPaymentScope(detection([], scope, [unread('/early.js', 'L-booking'), unread('/pay.js', 'L-checkout'), unread('/3ds.js', 'L-3ds'), unread('/orphan.js')]), inventory, services)
      expect(split.payment.map((record) => record.url)).toEqual(['https://cdn.example.test/pay.js', 'https://cdn.example.test/3ds.js', 'https://cdn.example.test/orphan.js'])
      expect(split.outside!.map((record) => record.url)).toEqual(['https://cdn.example.test/early.js'])
    })

    it('redacts the script URL and names the page it was loaded on', async () => {
      const { unread: split } = await compareWithPaymentScope(detection([], scope, [unread('/pay.js', 'L-checkout'), unread('/orphan.js')]), inventory, services)
      expect(split.payment).toEqual([
        { url: 'https://cdn.example.test/pay.js', resourceType: 'script', status: 200, step: 4, documentUrl: 'https://book.example.test/venue/checkout', reason: expect.stringContaining('Could not load response body') },
        { url: 'https://cdn.example.test/orphan.js', resourceType: 'script', status: 200, step: 4, documentUrl: null, reason: expect.stringContaining('Could not load response body') },
      ])
    })

    it('keeps every unread script in payment scope when the run is not scoped', async () => {
      const { unread: split } = await compareWithPaymentScope(detection([], undefined, [unread('/early.js', 'L-booking')]), inventory, services)
      expect(split.payment.map((record) => record.url)).toEqual(['https://cdn.example.test/early.js'])
      expect(split.outside).toBeNull()
    })
  })

  describe('unanswered script requests', () => {
    const request = (path: string, document?: string): UnansweredScriptRequest => ({
      url: `https://cdn.example.test${path}?token=secret`,
      resourceType: 'script',
      reason: 'no response had arrived 15s after the workflow finished',
      step: 4,
      ...(document === undefined ? {} : { document }),
    })
    const scope: PaymentScope = { declared: true, paymentDocuments: ['L-checkout'], documents: chain }

    // Split like everything else so a reader can tell where the request came
    // from, though neither side ever fails the run.
    it('splits them by payment scope, keeping unattributed ones in scope, redacted and with their page', async () => {
      const { unanswered, unread } = await compareWithPaymentScope(detection([], scope, undefined, [request('/early.js', 'L-booking'), request('/pay.js', 'L-checkout'), request('/orphan.js')]), inventory, services)
      expect(unanswered.payment).toEqual([
        { url: 'https://cdn.example.test/pay.js', resourceType: 'script', step: 4, documentUrl: 'https://book.example.test/venue/checkout', reason: 'no response had arrived 15s after the workflow finished' },
        { url: 'https://cdn.example.test/orphan.js', resourceType: 'script', step: 4, documentUrl: null, reason: 'no response had arrived 15s after the workflow finished' },
      ])
      expect(unanswered.outside!.map((record) => record.url)).toEqual(['https://cdn.example.test/early.js'])
      expect(unread).toEqual({ payment: [], outside: [] })
    })

    // A URL the page built wrongly is exactly what a human should see; its
    // shape must survive the redaction that strips the query string.
    it('shows a malformed URL in the shape the page requested it', async () => {
      const malformed: UnansweredScriptRequest = { ...request('/x'), url: 'https://pay.example.testhttps://pay.example.test/a1b2?sig=secret' }
      const { unanswered } = await compareWithPaymentScope(detection([], undefined, undefined, [malformed]), inventory, services)
      expect(unanswered.payment.map((record) => record.url)).toEqual(['https://pay.example.testhttps//pay.example.test/a1b2'])
      expect(unanswered.outside).toBeNull()
    })
  })

  describe('headers', () => {
    const csp = 'content-security-policy'
    const BOOKING_URL = 'https://book.example.test/venue'
    const CHECKOUT_URL = 'https://book.example.test/venue/checkout'
    // A CSP required on every document, authorised for the strict value only.
    const required = {
      identifyWith: createMatcher({ andMatcher: [{ headerNameMatcher: '^content-security-policy$' }, { hostMatcher: '^book\\.example\\.test$' }] }),
      authoriseWith: { matcher: createMatcher({ contentMatcher: "^script-src 'self'$" }), authorisationInfo: { description: 'strict', authorised: true, date: new Date('2026-01-01T00:00:00.000Z') } },
      requiredOn: ['document' as const],
    }
    const headerInventory = { ...inventory, headers: [required] } as unknown as Inventory
    const scope: PaymentScope = { declared: true, paymentDocuments: ['L-checkout'], documents: chain }
    const headerDetection = (): DetectionSummary => ({
      target,
      scriptSummary: { externalScripts: [], inlineScripts: [] },
      headerSummary: {
        headers: new Map([
          [
            csp,
            new Map([
              ["script-src 'self' 'unsafe-inline'", new Set([BOOKING_URL])],
              ["script-src 'self'", new Set([CHECKOUT_URL])],
            ]),
          ],
        ]),
        documents: new Map([
          [headerObservationKey(csp, "script-src 'self' 'unsafe-inline'", BOOKING_URL), new Set(['L-booking'])],
          [headerObservationKey(csp, "script-src 'self'", CHECKOUT_URL), new Set(['L-checkout'])],
        ]),
        responses: [
          { url: BOOKING_URL, resourceType: 'document', headerNames: new Set(), document: 'L-booking' },
          { url: CHECKOUT_URL, resourceType: 'document', headerNames: new Set([csp]), document: 'L-checkout' },
        ],
      },
      paymentScope: scope,
    })

    it('compares only the payment part of the header summary for alerting', async () => {
      const { payment, outside } = await compareWithPaymentScope(headerDetection(), headerInventory, services)
      expect(payment.headers.map((r) => r.type)).toEqual(['authorized_header'])
      expect(outside!.map((r) => r.type)).toEqual(['known_header_unauthorised_content'])
    })

    // The booking page's document lacks the CSP, but it left scope; the
    // payment page carries it. Presence is judged within payment scope.
    it('judges requiredOn presence within payment scope', async () => {
      const { payment, outside } = await compareWithPaymentScope(headerDetection(), headerInventory, services)
      expect([...payment.headers, ...outside!].some((r) => r.type === 'missing_required_header')).toBe(false)
    })
  })
})

describe('reportRecordsFor', () => {
  const declared = (paymentDocuments: string[]): PaymentScope => ({ declared: true, paymentDocuments, documents: chain })
  const results = { scripts: [{ type: 'unknown_script_found' }], headers: [] } as unknown as ScopedComparison['payment']
  const noUnread: ScopedComparison['unread'] = { payment: [], outside: null }
  const noUnanswered: ScopedComparison['unanswered'] = { payment: [], outside: null }
  const unreadRecord = (url: string) => ({ url, resourceType: 'script', status: 200, step: 3, documentUrl: null, reason: 'gone' })
  const unansweredRecord = (url: string) => ({ url, resourceType: 'script', step: 3, documentUrl: null, reason: 'no response' })

  it('records an unmarked run as one unlabelled set with no page chain', () => {
    const records = reportRecordsFor({ inventory, target, scoped: { payment: results, outside: null, unread: noUnread, unanswered: noUnanswered }, paymentScope: { declared: false, paymentDocuments: [], documents: chain } })
    expect(records).toHaveLength(1)
    expect(records[0]).not.toHaveProperty('scope')
    expect(records[0]).not.toHaveProperty('paymentScope')
  })

  // A marker that stopped resolving must reach the report as such, not look
  // like an unmarked workflow.
  it('records a declared but unresolved payment page with its chain and no row labels', () => {
    const paymentScope = declared([])
    const records = reportRecordsFor({ inventory, target, scoped: { payment: results, outside: null, unread: noUnread, unanswered: noUnanswered }, paymentScope })
    expect(records).toHaveLength(1)
    expect(records[0]!.paymentScope).toBe(paymentScope)
    expect(records[0]).not.toHaveProperty('scope')
  })

  it('records a scoped run as a labelled payment set plus a report-only outside set', () => {
    const records = reportRecordsFor({
      inventory,
      target,
      scoped: {
        payment: results,
        outside: [],
        unread: { payment: [unreadRecord('https://a.example.test/pay.js')], outside: [unreadRecord('https://a.example.test/early.js')] },
        unanswered: { payment: [unansweredRecord('https://a.example.test/never.js')], outside: [unansweredRecord('https://a.example.test/early-never.js')] },
      },
      paymentScope: declared(['L-checkout']),
    })
    expect(records.map((record) => record.scope)).toEqual(['payment', 'outside_payment'])
    expect(records[0]!.paymentScope).toBeDefined()
    expect(records[1]).not.toHaveProperty('paymentScope')
    expect(records.map((record) => record.unreadScripts?.map((unread) => unread.url))).toEqual([['https://a.example.test/pay.js'], ['https://a.example.test/early.js']])
    expect(records.map((record) => record.unansweredRequests?.map((request) => request.url))).toEqual([['https://a.example.test/never.js'], ['https://a.example.test/early-never.js']])
  })
})
