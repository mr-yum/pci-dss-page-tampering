/**
 * Initiator chains and inherited authorisation as the auditor report, the
 * HTML page, the Slack alerts and the unanswered-request records show them.
 */

import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found.js'
import { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found.js'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import type { InitiatorHop } from '../../types/initiator-chain.js'
import { REPORT_SCHEMA_VERSION } from '../../types/report.js'
import { createProvenanceResolver } from '../../utils/provenance.js'
import { SlackAlertService } from '../alert/slack.js'
import { toUnansweredRequestRecords } from '../scoped-comparison.js'
import { ReportCollector } from './collector.js'
import { renderReportHtml } from './html/template.js'
import { displayInitiatorChain, redactInitiatorChain, toReportRow } from './mapper.js'
import { buildInventory, detectionTarget, INVENTORY_TEXT, makeScript, runContext, SCRIPT_URL } from './test-fixtures.js'

jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { ok: true } }) }))

// The fixture inventory with its first entry granting what it loads.
const GRANTING_TEXT = INVENTORY_TEXT.replace(
  '"authorisationInfo": { "description": "Analytics, approved by security", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }\n      }\n    },',
  '"authorisationInfo": { "description": "Analytics, approved by security", "authorised": true, "date": "2025-10-02T00:00:00.000Z" }\n      },\n      "authorisesLoads": "transitive",\n      "loadsMatching": { "nameMatcher": "^https:" }\n    },',
)

const CHAIN: InitiatorHop[] = [
  { url: 'inline_script/id_not_found#k1-4', kind: 'script' },
  { url: `${SCRIPT_URL}?key=secret-token`, kind: 'script' },
  { url: 'https://checkout.example.com/pay?session=secret#card', kind: 'document' },
]
const timestamp = new Date('2026-01-01T00:00:00.000Z')
const loaded = makeScript({ name: 'https://assets.example.com/pixel.js', url: 'https://assets.example.com/pixel.js', hash: { value: 'eeee' }, initiatorChain: CHAIN })

describe('initiator chains in the auditor report', () => {
  it('was a minor schema bump (from 1.7.0), and stays on major 1', () => {
    const [major, minor] = REPORT_SCHEMA_VERSION.split('.').map(Number)
    expect(major).toBe(1)
    expect(minor).toBeGreaterThanOrEqual(7)
  })

  it('redacts URL hops like every URL and keeps inline identities readable', () => {
    expect(redactInitiatorChain(CHAIN)).toEqual([
      { url: 'inline_script/id_not_found#k1-4', kind: 'script' },
      { url: SCRIPT_URL, kind: 'script' },
      { url: 'https://checkout.example.com/pay', kind: 'document' },
    ])
    expect(redactInitiatorChain([{ url: 'blob:https://checkout.example.com/0b6e?x=1', kind: 'script' }])).toEqual([{ url: 'blob:https://checkout.example.com/0b6e', kind: 'script' }])
    expect(displayInitiatorChain(CHAIN)).toBe(`inline_script/id_not_found#k1-4 ← ${SCRIPT_URL} ← page https://checkout.example.com/pay`)
    expect(displayInitiatorChain(CHAIN)).not.toContain('secret')
  })

  it('records the chain on every script row, unknown and denied alike', () => {
    const inventory = buildInventory()
    const unknown = toReportRow(new UnknownScriptFound(detectionTarget, timestamp, loaded), inventory, 'checkout', null)
    expect(unknown.observed.initiatorChain).toEqual(redactInitiatorChain(CHAIN))
    const denied = toReportRow(
      new KnownScriptWithUnauthorisedContentFound(detectionTarget, timestamp, makeScript({ initiatorChain: CHAIN }), inventory.scripts[0]!, inventory.scripts[0]!.authoriseWith.matcher, 'hash not in list', []),
      inventory,
      'checkout',
      null,
    )
    expect(denied.observed.initiatorChain).toHaveLength(3)
    expect(toReportRow(new UnknownScriptFound(detectionTarget, timestamp, makeScript()), inventory, 'checkout', null).observed).not.toHaveProperty('initiatorChain')
  })

  it('keeps the rowId independent of the chain, so rows stay stable across runs', () => {
    const inventory = buildInventory()
    const withChain = toReportRow(new UnknownScriptFound(detectionTarget, timestamp, loaded), inventory, 'checkout', null)
    const without = toReportRow(new UnknownScriptFound(detectionTarget, timestamp, { ...loaded, initiatorChain: [] }), inventory, 'checkout', null)
    expect(withChain.rowId).toBe(without.rowId)
  })

  describe('an inherited row', () => {
    const inventory = buildInventory(GRANTING_TEXT)
    const grant = inventory.scripts[0]!
    const inherited = new AuthorizedScriptFound(detectionTarget, timestamp, loaded, grant, [grant.authoriseWith.authorisationInfo], { from: `${SCRIPT_URL}?key=secret-token`, via: CHAIN.slice(0, 2), mode: 'transitive' })
    const row = toReportRow(inherited, inventory, 'checkout', createProvenanceResolver(inventory))

    it('says it was inherited, from whom and along which chain — and names no identifying or authorising matcher', () => {
      expect(row.status).toBe('authorised')
      expect(row.identification).toBeNull()
      expect(row.authorisation.matcher).toBeNull()
      expect(row.authorisation.inherited).toEqual({ from: SCRIPT_URL, chain: redactInitiatorChain(CHAIN.slice(0, 2)), mode: 'transitive' })
      expect(row.authorisation.effective?.description).toBe('Analytics, approved by security')
    })

    it('cites the granting entry and its authorisesLoads line, never an authorising node that did not run', () => {
      const provenance = row.inventoryEntry?.provenance
      expect(provenance?.entry.pointer).toBe('/scripts/0')
      expect(provenance?.grantedBy?.pointer).toBe('/scripts/0/authorisesLoads')
      expect(GRANTING_TEXT.split('\n')[provenance!.grantedBy!.line - 1]).toContain('"authorisesLoads"')
      expect(provenance?.authorisedBy).toBeNull()
    })

    it('renders "loaded by" and "inherited" in the HTML page', () => {
      const collector = new ReportCollector()
      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [inherited] })
      const html = renderReportHtml(collector.build('detection', runContext())!)
      expect(html).toContain('loaded by')
      expect(html).toContain('inherited (transitive grant) from')
      expect(html).toContain('load grant at')
      expect(html).not.toContain('secret-token')
    })
  })

  it('carries the redacted chain on an unanswered request record', () => {
    const [record] = toUnansweredRequestRecords([{ url: 'https://assets.example.com/late.js', resourceType: 'script', reason: 'unanswered', step: 2, initiatorChain: CHAIN }], [])
    expect(record?.initiatorChain).toEqual(redactInitiatorChain(CHAIN))
  })
})

describe('initiator chains in Slack alerts', () => {
  const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
  const destinations = buildInventory().alerts

  it('adds a Loaded By column to the unknown-script table', async () => {
    const send = jest.spyOn(service as never, 'sendMessage').mockResolvedValue(undefined as never)
    await service.alertForTypedResults([new UnknownScriptFound(detectionTarget, timestamp, loaded)], detectionTarget, destinations)
    const payload = JSON.stringify(send.mock.calls[0]?.[0])
    expect(payload).toContain('Loaded By')
    expect(payload).toContain('page https://checkout.example.com/pay')
    expect(payload).not.toContain('secret-token')
    send.mockRestore()
  })

  it('adds a Loaded By column to the mismatched-script table, and says when there is no evidence', async () => {
    const inventory = buildInventory()
    const send = jest.spyOn(service as never, 'sendMessage').mockResolvedValue(undefined as never)
    const denied = new KnownScriptWithUnauthorisedContentFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, inventory.scripts[0]!.authoriseWith.matcher, 'hash not in list', [])
    await service.alertForTypedResults([denied], detectionTarget, destinations)
    const payload = JSON.stringify(send.mock.calls[0]?.[0])
    expect(payload).toContain('Loaded By')
    expect(payload).toContain('(no initiator evidence)')
    send.mockRestore()
  })
})
