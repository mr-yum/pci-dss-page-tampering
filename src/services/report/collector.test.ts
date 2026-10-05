/**
 * Unit tests for the auditor report collector.
 *
 * @see ./collector.ts
 */

import type { ComparisonResultType } from '../../types/comparison.js'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found.js'
import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found.js'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import { ExecutionMode } from '../../types/config.js'
import { NoopReportCollector, ReportCollector } from './collector.js'
import { serialiseReportForComparison } from './json.js'
import { buildInventory, detectionTarget, everyResultType, inventoryTarget, makeHeader, makeScript, OTHER_HASH, runContext, SCRIPT_HASH } from './test-fixtures.js'

describe('ReportCollector', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z')

  const collect = (results: ComparisonResultType[], inventory = buildInventory(), target = detectionTarget): ReturnType<ReportCollector['build']> => {
    const collector = new ReportCollector()

    collector.recordTargetRun({ inventory, target, comparisonResults: results })

    return collector.build('detection', runContext())
  }

  describe('build', () => {
    it('returns null when the pass recorded nothing', () => {
      expect(new ReportCollector().build('detection', runContext())).toBeNull()
    })

    it('produces a row for every comparison result variant', () => {
      const inventory = buildInventory()
      const report = collect(everyResultType(inventory))!
      const rows = report.targets.flatMap((target) => [...target.scripts, ...target.headers])

      expect(rows).toHaveLength(7)
      expect(rows.map((row) => row.resultType).sort()).toEqual(
        ['authorized_header', 'authorized_script', 'known_header_unauthorised_content', 'known_script_unauthorised_content', 'missing_required_header', 'unknown_header_found', 'unknown_script_found'].sort(),
      )
    })

    it('maps each result type to the right status', () => {
      const inventory = buildInventory()
      const report = collect(everyResultType(inventory))!
      const rows = report.targets.flatMap((target) => [...target.scripts, ...target.headers])
      const statusFor = (resultType: string): string => rows.find((row) => row.resultType === resultType)!.status

      expect(statusFor('authorized_script')).toBe('authorised')
      expect(statusFor('authorized_header')).toBe('authorised')
      expect(statusFor('known_script_unauthorised_content')).toBe('unauthorised_content')
      expect(statusFor('known_header_unauthorised_content')).toBe('unauthorised_content')
      expect(statusFor('unknown_script_found')).toBe('unknown')
      expect(statusFor('unknown_header_found')).toBe('unknown')
      expect(statusFor('missing_required_header')).toBe('missing_required')
    })

    it('separates scripts from headers', () => {
      const inventory = buildInventory()
      const report = collect(everyResultType(inventory))!

      expect(report.targets[0]!.scripts).toHaveLength(3)
      expect(report.targets[0]!.headers).toHaveLength(4)
    })

    it('resolves provenance to a file and line for an authorised script', () => {
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!
      const row = report.targets[0]!.scripts[0]!

      expect(row.inventoryEntry?.index).toBe(0)
      expect(row.inventoryEntry?.provenance?.entry.file).toBe('targets/1.0.json')
      expect(row.inventoryEntry?.provenance?.entry.pointer).toBe('/scripts/0')
      expect(row.inventoryEntry?.provenance?.entry.line).toBeGreaterThan(0)
      // The second hash is the one that matches, so the pointer must say so.
      expect(row.inventoryEntry?.provenance?.authorisedBy?.children?.[0]?.pointer).toBe('/scripts/0/authoriseWith/hashes/1')
    })

    it('reports the justification for a single-matcher entry, whose metadataPath is empty', () => {
      // processAuthorizeWith strips authorisationInfo off a single-matcher
      // config, so the comparison result carries an empty metadataPath and the
      // justification lives on the entry. This is the commonest entry shape in
      // the inventory repo — a blank Justification column here would gut the
      // report's 6.4.3 value.
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!
      const row = report.targets[0]!.scripts[0]!

      expect(row.authorisation.metadataPath).toEqual([])
      expect(row.authorisation.effective?.description).toBe('Analytics, approved by security')
    })

    it('redacts credentials and query strings from the resource name', () => {
      const inventory = buildInventory()
      const leaky = makeScript({ name: 'https://user:hunter2@cdn.example.com/l.js?apikey=SUPERSECRET#frag', url: 'https://cdn.example.com/l.js' })
      const report = collect([new UnknownScriptFound(detectionTarget, timestamp, leaky)], inventory)!
      const row = report.targets[0]!.scripts[0]!

      expect(row.name).not.toContain('hunter2')
      expect(row.name).not.toContain('SUPERSECRET')
      expect(row.name).toContain('[credentials-redacted]')
      expect(row.name).toContain('[query-redacted]')
    })

    it('redacts a signed URL embedded in a header value', () => {
      // A CSP report-uri commonly carries a per-request token. It must not
      // reach a 90-day CI artefact.
      const inventory = buildInventory()
      const header = makeHeader({ name: 'content-security-policy-report-only', value: 'report-uri https://csp.example.test/violations?q=SIGNEDTOKEN' })
      const report = collect([new UnknownHeaderFound(detectionTarget, timestamp, header)], inventory)!
      const row = report.targets[0]!.headers[0]!

      expect(row.value).not.toContain('SIGNEDTOKEN')
      expect(row.value).toContain('[query-redacted]')
    })

    it('reports the justification recorded against the entry', () => {
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [{ description: 'Analytics, approved by security', authorised: true, date: timestamp }])], inventory)!
      const row = report.targets[0]!.scripts[0]!

      expect(row.authorisation.decision).toBe('authorised')
      expect(row.authorisation.effective?.description).toBe('Analytics, approved by security')
      expect(row.authorisation.effective?.authorised).toBe(true)
    })

    it('records the SHA-256 as the integrity anchor', () => {
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!

      expect(report.targets[0]!.scripts[0]!.observed.hash).toBe(SCRIPT_HASH)
    })

    it('redacts the query string from a target URL so signed URLs cannot leak', () => {
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!

      expect(detectionTarget.url).toContain('session=secret')
      expect(report.targets[0]!.url).not.toContain('secret')
    })

    it('classifies scripts by their inline_script/ id prefix, not URL shape', () => {
      // An external script may legally use a non-HTTP scheme; an inline script
      // carries provenance in `url`. Neither is a reliable discriminator.
      const inventory = buildInventory()
      const blobExternal = new UnknownScriptFound(detectionTarget, timestamp, makeScript({ name: 'blob:https://checkout.example.com/ccfd8f47-8319-4f53', url: 'https://checkout.example.com/pay' }))
      const inline = new UnknownScriptFound(detectionTarget, timestamp, makeScript({ name: 'inline_script/checkout.example.com/bootstrap', url: 'https://checkout.example.com/pay' }))
      const report = collect([blobExternal, inline], inventory)!
      const kinds = Object.fromEntries(report.targets[0]!.scripts.map((row) => [row.name.split('/')[0], row.kind]))

      expect(kinds['blob:https:']).toBe('external_script')
      expect(kinds['inline_script']).toBe('inline_script')
    })

    it('collapses a header repeated across responses into one row with an occurrence count', () => {
      const inventory = buildInventory()
      const authorised = (): AuthorizedHeaderFound => new AuthorizedHeaderFound(detectionTarget, timestamp, makeHeader(), inventory.headers[0]!, [])
      const report = collect([authorised(), authorised(), authorised()], inventory)!

      expect(report.targets[0]!.headers).toHaveLength(1)
      expect(report.targets[0]!.headers[0]!.occurrences).toBe(3)
      // Counts follow occurrences, so the summary reflects what was observed.
      expect(report.summary.authorised).toBe(3)
      expect(report.summary.total).toBe(3)
    })

    it('lists inventory entries that nothing matched', () => {
      const inventory = buildInventory()
      const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!
      const unmatched = report.targets[0]!.unmatchedInventoryEntries

      // scripts[1] and headers[0] were never observed.
      expect(unmatched.map((entry) => `${entry.kind}/${entry.index}`)).toEqual(['header/0', 'script/1'])
      expect(unmatched.find((entry) => entry.kind === 'script')!.source?.pointer).toBe('/scripts/1')
      expect(unmatched.find((entry) => entry.kind === 'script')!.source?.line).toBeGreaterThan(0)
    })

    it('groups by inventory file and workflow', () => {
      const collector = new ReportCollector()
      const first = buildInventory(undefined, '1.0.json')
      const second = buildInventory(undefined, '2.0.json')

      collector.recordTargetRun({ inventory: first, target: detectionTarget, comparisonResults: [] })
      collector.recordTargetRun({ inventory: second, target: detectionTarget, comparisonResults: [] })

      const report = collector.build('detection', runContext())!

      expect(report.targets.map((target) => target.targetKey)).toEqual(['1.0.json#checkout', '2.0.json#checkout'])
      expect(report.summary.targets).toBe(2)
    })

    it('keeps inventory and detection passes in separate documents', () => {
      const collector = new ReportCollector()
      const inventory = buildInventory()

      collector.recordTargetRun({ inventory, target: inventoryTarget, comparisonResults: [] })
      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [] })

      expect(collector.build('inventory', runContext())!.run.pass).toBe('inventory')
      expect(collector.build('detection', runContext())!.run.pass).toBe('detection')
    })

    it('uses the recorded inventory ref for the pass', () => {
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory: buildInventory(), target: detectionTarget, comparisonResults: [] })
      collector.recordInventoryRef('detection', { branch: 'main', commitSha: 'deadbeef', commitIsoDate: '2026-01-01T00:00:00.000Z', repositoryUrl: 'https://github.example.com/org/inventory' })

      expect(collector.build('detection', runContext())!.run.inventoryRef.commitSha).toBe('deadbeef')
    })
  })

  describe('determinism', () => {
    it('produces identical output regardless of the order results arrive in', () => {
      const inventory = buildInventory()
      const results = everyResultType(inventory)
      const reversed = [...results].reverse()

      expect(serialiseReportForComparison(collect(reversed, inventory)!)).toBe(serialiseReportForComparison(collect(results, inventory)!))
    })

    it('produces identical output across two runs once volatile metadata is removed', () => {
      const inventory = buildInventory()
      const first = collect(everyResultType(inventory), inventory)!
      const second = collect(everyResultType(inventory), inventory)!

      expect(serialiseReportForComparison(second)).toBe(serialiseReportForComparison(first))
    })
  })

  describe('failures', () => {
    it('marks the run partial and still reports the targets that succeeded', () => {
      const collector = new ReportCollector()
      const healthy = buildInventory(undefined, '1.0.json')
      const broken = buildInventory(undefined, '2.0.json')

      collector.recordTargetRun({ inventory: healthy, target: detectionTarget, comparisonResults: everyResultType(healthy) })
      collector.recordTargetFailure({ inventory: broken, target: detectionTarget, error: new Error('navigation timeout') })

      const report = collector.build('detection', runContext())!

      expect(report.run.status).toBe('partial')
      expect(report.run.failures).toEqual([{ targetKey: '2.0.json#checkout', message: 'navigation timeout' }])
      expect(report.summary.targetsFailed).toBe(1)
      expect(report.targets.find((target) => target.targetKey === '1.0.json#checkout')!.counts.total).toBe(7)
      expect(report.notes.some((note) => note.startsWith('PARTIAL RUN'))).toBe(true)
    })

    it('orders inventory copies deterministically, whatever order targets ran in', () => {
      // `run.inventorySources` is a digest list an auditor diffs between runs.
      // Target processing order is not guaranteed, so the sort is the only
      // thing keeping two identical runs byte-identical here.
      const files = (names: string[]): string[] => {
        const collector = new ReportCollector()

        for (const name of names) collector.recordTargetRun({ inventory: buildInventory(undefined, name), target: detectionTarget, comparisonResults: [] })

        return collector.getInventoryFiles('detection').map(({ file }) => file)
      }

      const expected = ['targets/1.0.json', 'targets/2.0.json', 'targets/10.0.json']

      expect(files(['10.0.json', '2.0.json', '1.0.json'])).toEqual(expected)
      expect(files(['2.0.json', '10.0.json', '1.0.json'])).toEqual(expected)
    })

    it('still retains the inventory a failed target was compared against', () => {
      // The run that fell over is the one an assessor asks about, so the report
      // must still be able to say which baseline it was working from.
      const collector = new ReportCollector()
      const broken = buildInventory(undefined, '2.0.json')

      collector.recordTargetFailure({ inventory: broken, target: detectionTarget, error: new Error('navigation timeout') })

      expect(collector.getInventoryFiles('detection')).toEqual([{ file: 'targets/2.0.json', text: broken.source!.text }])
      expect(collector.build('detection', runContext())!.run.inventorySources.map((source) => source.file)).toEqual(['targets/2.0.json'])
    })

    it('redacts credentials from a failure message before it reaches the artefact', () => {
      // Git errors echo the authenticated remote. Without redaction the token
      // lands in a 90-day CI artefact whose own notes promise it cannot.
      const collector = new ReportCollector()

      collector.recordTargetFailure({ inventory: buildInventory(), target: detectionTarget, error: new Error("fatal: repository 'https://x-access-token:ghp_supersecret@github.com/org/inventory' not found") })

      const report = collector.build('detection', runContext())!

      expect(report.run.failures[0]!.message).not.toContain('ghp_supersecret')
      expect(report.run.failures[0]!.message).toContain('[credentials-redacted]')
      expect(report.targets[0]!.error).not.toContain('ghp_supersecret')
    })

    it('stringifies a non-Error failure', () => {
      const collector = new ReportCollector()

      collector.recordTargetFailure({ inventory: buildInventory(), target: detectionTarget, error: 'boom' })

      expect(collector.build('detection', runContext())!.run.failures[0]!.message).toBe('boom')
    })
  })

  describe('notes', () => {
    it('flags a filtered run as a partial census', () => {
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory: buildInventory(), target: detectionTarget, comparisonResults: [] })

      const report = collector.build('detection', runContext({ targetFilter: '1.0', configuredMode: ExecutionMode.Detection }))!

      expect(report.notes.some((note) => note.startsWith('PARTIAL CENSUS'))).toBe(true)
    })

    it('always states the truncation and redaction policy', () => {
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory: buildInventory(), target: detectionTarget, comparisonResults: [] })

      const report = collector.build('detection', runContext())!

      expect(report.notes.some((note) => note.includes('integrity anchor'))).toBe(true)
      expect(report.notes.some((note) => note.includes('credentials'))).toBe(true)
    })
  })

  describe('memory', () => {
    it('does not retain a reference to the comparison results it was given', () => {
      const inventory = buildInventory()
      const script = makeScript()
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, script, inventory.scripts[0]!, [])] })

      // Mutating the source after recording must not change the report: rows
      // are mapped eagerly precisely so the heavy result objects can be freed.
      ;(script as { content: string | null }).content = 'MUTATED AFTER RECORDING'

      expect(collector.build('detection', runContext())!.targets[0]!.scripts[0]!.observed.contentExcerpt).toBe('window.analytics=1')
    })
  })
})

describe('ReportCollector payment scope', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z')
  const paymentScope = {
    declared: true,
    paymentDocuments: ['loader-checkout'],
    documents: [
      { id: 'loader-booking', url: 'https://book.example.test/venue?token=secret', routes: [], firstStep: 0, lastStep: 3 },
      { id: 'loader-checkout', url: 'https://book.example.test/venue/checkout?session=secret', routes: [], firstStep: 4, lastStep: 9 },
    ],
  }

  const scopedReport = () => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    const tagManager = makeScript({ name: 'https://tagmanager.example/tm.js', url: 'https://tagmanager.example/tm.js', content: 'tm', hash: { value: OTHER_HASH } })
    collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], scope: 'payment', paymentScope })
    // The same authorised SDK also ran on the earlier page, plus an unknown tag manager there.
    collector.recordTargetRun({
      inventory,
      target: detectionTarget,
      comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, []), new UnknownScriptFound(detectionTarget, timestamp, tagManager)],
      scope: 'outside_payment',
    })
    return collector.build('detection', runContext())!
  }

  it('tags every row with the scope it was recorded under', () => {
    const rows = scopedReport().targets[0]!.scripts
    expect(rows.map((row) => [row.name, row.scope]).sort()).toEqual(
      [
        ['https://cdn.example.com/analytics.js', 'outside_payment'],
        ['https://cdn.example.com/analytics.js', 'payment'],
        ['https://tagmanager.example/tm.js', 'outside_payment'],
      ].sort(),
    )
  })

  it('keeps a resource seen in both scopes as two rows with distinct ids, the payment row keeping its natural id', () => {
    const unscoped = new ReportCollector()
    const inventory = buildInventory()
    unscoped.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])] })
    const naturalId = unscoped.build('detection', runContext())!.targets[0]!.scripts[0]!.rowId

    const sdk = scopedReport().targets[0]!.scripts.filter((row) => row.name === 'https://cdn.example.com/analytics.js')
    expect(sdk).toHaveLength(2)
    expect(sdk.find((row) => row.scope === 'payment')!.rowId).toBe(naturalId)
    expect(sdk.find((row) => row.scope === 'outside_payment')!.rowId).not.toBe(naturalId)
    expect(sdk.every((row) => row.occurrences === 1)).toBe(true)
  })

  it('counts the census in full and the payment scope separately', () => {
    const target = scopedReport().targets[0]!
    expect(target.counts).toMatchObject({ authorised: 2, unknown: 1, total: 3 })
    expect(target.paymentScope!.counts).toMatchObject({ authorised: 1, unknown: 0, total: 1 })
  })

  it('records the redacted page chain and marks the payment document', () => {
    expect(scopedReport().targets[0]!.paymentScope!.documents).toEqual([
      { url: 'https://book.example.test/venue', firstStep: 0, lastStep: 3, paymentPage: false, scope: 'outside_payment' },
      { url: 'https://book.example.test/venue/checkout', firstStep: 4, lastStep: 9, paymentPage: true, scope: 'payment' },
    ])
  })

  // A marker that stopped resolving must be visible, not silent: the run fell
  // back to whole-run scope, and the report says so.
  it('records a declared payment page that could not be identified as unresolved', () => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    collector.recordTargetRun({
      inventory,
      target: detectionTarget,
      comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])],
      paymentScope: { ...paymentScope, paymentDocuments: [] },
    })
    const target = collector.build('detection', runContext())!.targets[0]!

    expect(target.paymentScope).toMatchObject({ resolved: false, counts: { total: 1 } })
    expect(target.paymentScope!.documents.every((document) => document.scope === 'payment' && !document.paymentPage)).toBe(true)
    expect(target.scripts[0]!.scope).toBeUndefined()
  })

  it('records a resolved scope as resolved', () => {
    expect(scopedReport().targets[0]!.paymentScope!.resolved).toBe(true)
  })

  it('leaves an unscoped run exactly as before', () => {
    const inventory = buildInventory()
    const report = collect([new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])], inventory)!
    expect(report.targets[0]!.paymentScope).toBeUndefined()
    expect(report.targets[0]!.scripts[0]!.scope).toBeUndefined()
  })

  function collect(results: ComparisonResultType[], inventory = buildInventory()) {
    const collector = new ReportCollector()
    collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: results })
    return collector.build('detection', runContext())
  }
})

describe('ReportCollector unread scripts', () => {
  const unread = (url: string) => ({ url, resourceType: 'script', status: 200, step: 6, documentUrl: 'https://book.example.test/venue/checkout', reason: 'Could not load response body for this request.' })

  const build = (records: { unread: ReturnType<typeof unread>[]; scope?: 'payment' | 'outside_payment' }[]) => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    for (const record of records) collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [], unreadScripts: record.unread, ...(record.scope === undefined ? {} : { scope: record.scope }) })
    return collector.build('detection', runContext())!
  }

  // An unread payment-page script is a gap in the census, like a failed target.
  it('lists an unread script under its target and marks the run partial', () => {
    const report = build([{ unread: [unread('https://cdn.example.test/pay.js')] }])
    expect(report.targets[0]!.unreadScripts).toEqual([unread('https://cdn.example.test/pay.js')])
    expect(report.targets[0]!.status).toBe('completed')
    expect(report.run.status).toBe('partial')
    expect(report.run.failures).toEqual([])
    expect(report.summary.scriptsUnread).toBe(1)
    expect(report.notes.some((note) => note.startsWith('PARTIAL RUN: 1 script response(s) in payment scope'))).toBe(true)
  })

  it('records an unread script outside the payment page as evidence without making the run partial', () => {
    const report = build([
      { unread: [], scope: 'payment' },
      { unread: [unread('https://cdn.example.test/landing.js')], scope: 'outside_payment' },
    ])
    expect(report.targets[0]!.unreadScripts).toEqual([{ ...unread('https://cdn.example.test/landing.js'), scope: 'outside_payment' }])
    expect(report.run.status).toBe('complete')
    expect(report.summary.scriptsUnread).toBe(0)
  })

  it('tags payment-scope unread scripts and orders them deterministically', () => {
    const report = build([{ unread: [unread('https://cdn.example.test/b.js'), unread('https://cdn.example.test/a.js')], scope: 'payment' }])
    expect(report.targets[0]!.unreadScripts.map((script) => [script.url, script.scope])).toEqual([
      ['https://cdn.example.test/a.js', 'payment'],
      ['https://cdn.example.test/b.js', 'payment'],
    ])
    expect(report.run.status).toBe('partial')
  })

  it('records an empty list, and a complete run, when every script was read', () => {
    const report = build([{ unread: [] }])
    expect(report.targets[0]!.unreadScripts).toEqual([])
    expect(report.run.status).toBe('complete')
  })
})

describe('ReportCollector unanswered script requests', () => {
  const request = (url: string) => ({ url, resourceType: 'script', step: 4, documentUrl: 'https://book.example.test/venue/checkout', reason: 'no response had arrived 15s after the workflow finished' })

  const build = (records: { unanswered: ReturnType<typeof request>[]; scope?: 'payment' | 'outside_payment' }[]) => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    for (const record of records) collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [], unansweredRequests: record.unanswered, ...(record.scope === undefined ? {} : { scope: record.scope }) })
    return collector.build('detection', runContext())!
  }

  // Evidence, not a gap in the census: the script never ran.
  it('lists them under their target, counts them, and leaves the run complete', () => {
    const report = build([
      { unanswered: [request('https://cdn.example.test/b.js'), request('https://cdn.example.test/a.js')], scope: 'payment' },
      { unanswered: [request('https://cdn.example.test/landing.js')], scope: 'outside_payment' },
    ])
    expect(report.targets[0]!.unansweredRequests.map((entry) => [entry.url, entry.scope])).toEqual([
      ['https://cdn.example.test/landing.js', 'outside_payment'],
      ['https://cdn.example.test/a.js', 'payment'],
      ['https://cdn.example.test/b.js', 'payment'],
    ])
    expect(report.targets[0]!.unreadScripts).toEqual([])
    expect(report.run.status).toBe('complete')
    expect(report.summary).toEqual(expect.objectContaining({ scriptsUnread: 0, requestsUnanswered: 3 }))
    expect(report.notes.some((note) => note.startsWith('3 script request(s) never received a response'))).toBe(true)
    expect(report.notes.some((note) => note.startsWith('PARTIAL RUN'))).toBe(false)
  })

  it('records an empty list when every request was answered', () => {
    const report = build([{ unanswered: [] }])
    expect(report.targets[0]!.unansweredRequests).toEqual([])
    expect(report.summary.requestsUnanswered).toBe(0)
  })
})

describe('NoopReportCollector', () => {
  it('records nothing and builds nothing', () => {
    const collector = new NoopReportCollector()
    const inventory = buildInventory()

    collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: everyResultType(inventory) })
    collector.recordTargetFailure({ inventory, target: detectionTarget, error: new Error('x') })
    collector.recordInventoryRef('detection', { branch: 'main', commitSha: null, commitIsoDate: null, repositoryUrl: 'https://github.example.com/org/inventory' })

    expect(collector.build()).toBeNull()
  })
})
