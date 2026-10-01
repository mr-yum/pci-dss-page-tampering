import type { IHeaderComparisonService, IScriptComparisonService } from '../interfaces/comparison.js'
import type { DetectionSummary } from '../types/detection.js'
import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo } from '../types/inventory/model.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import type { TargetDetection } from '../types/target.js'
import { HeaderComparisonService } from './comparison/header.js'
import { ScriptComparisonService } from './comparison/script.js'
import { compareOutsidePayment } from './outside-payment.js'

describe('compareOutsidePayment', () => {
  const lines: string[] = []
  const logger = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), debug: (m: string) => lines.push(m) }
  const target: TargetDetection = { type: 'detection', url: 'https://book.example.test/venue', workflow: { fileName: 'w.json', definition: { steps: [] } }, logger }

  // An authorised monitoring agent required on the payment page, and an HSTS policy required on every document.
  const requiredAgent: InventoryScriptInfo = {
    identifyWith: createMatcher({ nameMatcher: '^https://agent\\.example\\.test/agent\\.js$' }),
    authoriseWith: { matcher: createMatcher({ nameMatcher: '.*' }), authorisationInfo: { description: 'RUM agent', authorised: true, date: new Date('2026-01-01T00:00:00.000Z') } },
    requiredOn: ['detection'],
  } as unknown as InventoryScriptInfo
  const requiredHsts: InventoryHeaderInfo = {
    identifyWith: createMatcher({ andMatcher: [{ headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^book\\.example\\.test$' }] }),
    authoriseWith: { matcher: createMatcher({ contentMatcher: '^max-age=31536000$' }), authorisationInfo: { description: 'HSTS', authorised: true, date: new Date('2026-01-01T00:00:00.000Z') } },
    requiredOn: ['document'],
  }
  const inventory = { scripts: [requiredAgent], headers: [requiredHsts], alerts: {} } as unknown as Inventory

  const outside: DetectionSummary = {
    target,
    scriptSummary: { externalScripts: [{ source: { type: 'external', url: 'https://tagmanager.example/tm.js', content: 'tm' }, hash: { value: 'h-tm' } as any, document: 'l1' }], inlineScripts: [] },
    headerSummary: { headers: new Map(), responses: [{ url: 'https://book.example.test/venue', resourceType: 'document', headerNames: new Set(), document: 'l1' }] },
  }
  const services = { scripts: new ScriptComparisonService(), headers: new HeaderComparisonService() }

  beforeEach(() => lines.splice(0))

  it('compares what an earlier page ran, for the report', async () => {
    const results = await compareOutsidePayment(outside, inventory, services)
    expect(results.map((r) => r.type)).toEqual(['unknown_script_found'])
  })

  it("never judges the payment page's required controls against an earlier page", async () => {
    // The input genuinely lacks both controls: compared directly, both are reported missing.
    const direct = [...(await services.scripts.compare(target, inventory, outside.scriptSummary)), ...(await services.headers.compare(target, inventory, outside.headerSummary))]
    expect(direct.map((r) => r.type)).toEqual(expect.arrayContaining(['missing_required_script', 'missing_required_header']))

    const results = await compareOutsidePayment(outside, inventory, services)
    expect(results.some((r) => r.type === 'missing_required_script' || r.type === 'missing_required_header')).toBe(false)
  })

  it('prefixes every log line so an earlier page never reads like a payment-page finding', async () => {
    await compareOutsidePayment(outside, inventory, services)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line.startsWith('[outside payment page] '))).toBe(true)
  })

  it('never throws, so it cannot cost the target its alerts', async () => {
    const failing = { compare: () => Promise.reject(new Error('boom')) } as unknown as IScriptComparisonService
    await expect(compareOutsidePayment(outside, inventory, { scripts: failing, headers: services.headers as IHeaderComparisonService })).resolves.toEqual([])
    expect(lines.some((line) => line.includes('Comparison failed'))).toBe(true)
  })
})
