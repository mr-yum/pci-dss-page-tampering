import type { DetectionSummary } from '../types/detection.js'
import type { PaymentScope } from '../types/document.js'
import { headerObservationKey } from '../types/header.js'
import type { Inventory } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { ScriptInfo } from '../types/script.js'
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
const detection = (scripts: ScriptInfo[], paymentScope?: PaymentScope): DetectionSummary => ({
  target,
  scriptSummary: { externalScripts: scripts, inlineScripts: [] },
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

  it('records an unmarked run as one unlabelled set with no page chain', () => {
    const records = reportRecordsFor({ inventory, target, scoped: { payment: results, outside: null }, paymentScope: { declared: false, paymentDocuments: [], documents: chain } })
    expect(records).toHaveLength(1)
    expect(records[0]).not.toHaveProperty('scope')
    expect(records[0]).not.toHaveProperty('paymentScope')
  })

  // A marker that stopped resolving must reach the report as such, not look
  // like an unmarked workflow.
  it('records a declared but unresolved payment page with its chain and no row labels', () => {
    const paymentScope = declared([])
    const records = reportRecordsFor({ inventory, target, scoped: { payment: results, outside: null }, paymentScope })
    expect(records).toHaveLength(1)
    expect(records[0]!.paymentScope).toBe(paymentScope)
    expect(records[0]).not.toHaveProperty('scope')
  })

  it('records a scoped run as a labelled payment set plus a report-only outside set', () => {
    const records = reportRecordsFor({ inventory, target, scoped: { payment: results, outside: [] }, paymentScope: declared(['L-checkout']) })
    expect(records.map((record) => record.scope)).toEqual(['payment', 'outside_payment'])
    expect(records[0]!.paymentScope).toBeDefined()
    expect(records[1]).not.toHaveProperty('paymentScope')
  })
})
