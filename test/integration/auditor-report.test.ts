/**
 * End-to-end integration tests for the auditor report.
 *
 * Covers the properties that only hold across the whole pipeline: that the
 * census is complete, that the written artefacts are self-contained, and that
 * two runs of an unchanged site and inventory produce a byte-identical
 * document once volatile run metadata is removed.
 *
 * @see src/services/report/collector.ts
 * @see src/services/report/writer.ts
 */

import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { ReportCollector } from '../../src/services/report/collector.js'
import { serialiseReportForComparison } from '../../src/services/report/json.js'
import { buildStepSummary } from '../../src/services/report/step-summary.js'
import { buildInventory, detectionTarget, everyResultType, inventoryTarget, makeScript, runContext } from '../../src/services/report/test-fixtures.js'
import { FileReportWriter } from '../../src/services/report/writer.js'
import { UnknownScriptFound } from '../../src/types/comparison/unknown-script-found.js'
import { type AuditorReport, REPORT_SCHEMA_VERSION } from '../../src/types/report.js'

describe('auditor report end to end', () => {
  let reportDir: string

  beforeEach(async () => {
    reportDir = await mkdtemp(join(tmpdir(), 'auditor-report-'))
  })

  afterEach(async () => {
    await rm(reportDir, { recursive: true, force: true })
  })

  const buildReport = (pass: 'inventory' | 'detection' = 'detection'): AuditorReport => {
    const inventory = buildInventory()
    const collector = new ReportCollector()

    collector.recordTargetRun({ inventory, target: pass === 'inventory' ? inventoryTarget : detectionTarget, comparisonResults: everyResultType(inventory) })
    collector.recordInventoryRef(pass, { branch: 'main', commitSha: 'abc1234', commitIsoDate: '2026-01-01T00:00:00.000Z', repositoryUrl: 'https://github.example.com/org/inventory' })

    return collector.build(pass, runContext())!
  }

  describe('census completeness', () => {
    it('includes every observed resource exactly once', () => {
      const report = buildReport()
      const rows = report.targets.flatMap((target) => [...target.scripts, ...target.headers])

      expect(rows).toHaveLength(7)
      expect(new Set(rows.map((row) => row.rowId)).size).toBe(7)
      // Summary counts must reconcile with the rows, or the headline lies.
      expect(report.summary.total).toBe(rows.reduce((sum, row) => sum + row.occurrences, 0))
      expect(report.summary.authorised + report.summary.unauthorised_content + report.summary.unknown + report.summary.missing_required).toBe(report.summary.total)
    })

    it('maps every authorised row to a file and line in the inventory', () => {
      const report = buildReport()
      const authorised = report.targets.flatMap((target) => [...target.scripts, ...target.headers]).filter((row) => row.status === 'authorised')

      expect(authorised.length).toBeGreaterThan(0)

      for (const row of authorised) {
        expect(row.inventoryEntry?.provenance?.authorisedBy).not.toBeNull()
        expect(row.inventoryEntry?.provenance?.entry.file).toBe('targets/1.0.json')
        expect(row.inventoryEntry?.provenance?.entry.line).toBeGreaterThan(0)
      }
    })
  })

  describe('written artefacts', () => {
    it('writes JSON and HTML into a pass-scoped directory', async () => {
      const paths = await new FileReportWriter().write(buildReport(), reportDir)

      expect(paths.jsonPath).toBe(join(reportDir, 'detection', 'report.json'))
      expect(paths.htmlPath).toBe(join(reportDir, 'detection', 'report.html'))

      const json = JSON.parse(await readFile(paths.jsonPath, 'utf8'))

      // Pinned to the exported constant, not a literal: additive fields bump the
      // minor legitimately. The major is what consumers gate on.
      expect(json.schemaVersion).toBe(REPORT_SCHEMA_VERSION)
      expect(json.schemaVersion).toMatch(/^1\./u)
      expect(json.run.pass).toBe('detection')
    })

    it('ends the JSON with a newline so it is diff- and shell-friendly', async () => {
      const paths = await new FileReportWriter().write(buildReport(), reportDir)

      expect(await readFile(paths.jsonPath, 'utf8')).toMatch(/\n$/u)
    })

    it('produces HTML that loads nothing from the network', async () => {
      const paths = await new FileReportWriter().write(buildReport(), reportDir)
      const html = await readFile(paths.htmlPath, 'utf8')

      expect(html).not.toMatch(/\ssrc="/u)
      expect(html).toContain("default-src 'none'")
    })

    it('writes both passes side by side with a linking index', async () => {
      const writer = new FileReportWriter()
      const inventoryPaths = await writer.write(buildReport('inventory'), reportDir)
      const detectionPaths = await writer.write(buildReport('detection'), reportDir)

      await writer.writeIndex(reportDir, [
        { pass: 'inventory', paths: inventoryPaths },
        { pass: 'detection', paths: detectionPaths },
      ])

      const index = await readFile(join(reportDir, 'index.html'), 'utf8')

      expect(index).toContain('inventory/report.html')
      expect(index).toContain('detection/report.html')
      // Relative links, so the directory stays portable once unzipped from CI.
      expect(index).not.toContain(reportDir)
    })

    it('ties both passes of one invocation together by correlation id', () => {
      // The fixture supplies the id, so comparing two fixture-built reports
      // would compare a constant with itself. Assert instead that build()
      // propagates whatever the caller passed, distinctly per invocation —
      // main.ts generates one randomUUID per process and shares it across passes.
      const inventory = buildInventory()
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory, target: inventoryTarget, comparisonResults: [] })
      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [] })

      const first = collector.build('inventory', runContext({ correlationId: 'run-A' }))!
      const second = collector.build('detection', runContext({ correlationId: 'run-A' }))!
      const other = collector.build('detection', runContext({ correlationId: 'run-B' }))!

      expect(first.run.correlationId).toBe(second.run.correlationId)
      expect(other.run.correlationId).not.toBe(first.run.correlationId)
    })
  })

  describe('size guard', () => {
    it('shortens excerpts and says so, rather than emitting an unopenable page', async () => {
      // A very large target would otherwise produce an HTML file that is
      // painful to open. Excerpts give way; hashes and matchers never do.
      const inventory = buildInventory()
      const collector = new ReportCollector()
      const ROWS = 1600
      const huge = 'x'.repeat(4000)
      const results = Array.from(
        { length: ROWS },
        (_unused, index) => new UnknownScriptFound(detectionTarget, new Date('2026-01-01T00:00:00.000Z'), makeScript({ name: `https://cdn.example.test/s${index}.js`, content: huge, hash: { value: `hash${index}` } })),
      )

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: results })

      const report = collector.build('detection', runContext())!
      const paths = await new FileReportWriter().write(report, reportDir)
      const written = JSON.parse(await readFile(paths.jsonPath, 'utf8'))
      const rows = written.targets.flatMap((target: { scripts: { observed: { contentExcerpt: string | null; hash: string | null } }[] }) => target.scripts)

      expect(rows.length).toBe(ROWS)
      expect(rows[0].observed.contentExcerpt).toHaveLength(128)
      // The hash is the integrity anchor and is never dropped.
      expect(rows[0].observed.hash).not.toBeNull()
      expect(written.notes.some((note: string) => note.includes('shortened'))).toBe(true)

      const html = await readFile(paths.htmlPath, 'utf8')

      // The label must state what is actually shown, not the default limit.
      expect(html).not.toContain('first 512 of')
      expect(html).toContain('first 128 of')
      // Two full renders (measure, then re-render smaller) on a deliberately
      // oversized fixture — slower than the default 5s budget.
    }, 30000)
  })

  describe('determinism', () => {
    it('produces byte-identical documents across runs once run metadata is removed', async () => {
      const writer = new FileReportWriter()
      const first = await writer.write(buildReport(), reportDir)
      const firstJson = JSON.parse(await readFile(first.jsonPath, 'utf8'))

      const secondDir = await mkdtemp(join(tmpdir(), 'auditor-report-'))

      try {
        const second = await writer.write(buildReport(), secondDir)
        const secondJson = JSON.parse(await readFile(second.jsonPath, 'utf8'))

        expect(serialiseReportForComparison(secondJson)).toBe(serialiseReportForComparison(firstJson))
      } finally {
        await rm(secondDir, { recursive: true, force: true })
      }
    })
  })

  describe('step summary', () => {
    it('reports the counts and lists only the findings', () => {
      const summary = buildStepSummary(buildReport())

      expect(summary).toContain('## Auditor report — detection')
      expect(summary).toContain('abc1234')
      expect(summary).toContain('### Findings')
      // The compliant majority belongs in the artefact, not the job page.
      expect(summary).not.toContain('| authorised |')
    })

    it('says so plainly when nothing was found', () => {
      const inventory = buildInventory()
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: everyResultType(inventory).filter((result) => result.type === 'authorized_script') })

      expect(buildStepSummary(collector.build('detection', runContext())!)).toContain('No findings')
    })
  })
})
