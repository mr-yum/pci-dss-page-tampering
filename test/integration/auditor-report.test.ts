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

import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { InventoryFileCopy } from '../../src/interfaces/report.js'
import { ReportCollector } from '../../src/services/report/collector.js'
import { serialiseReportForComparison } from '../../src/services/report/json.js'
import { buildStepSummary } from '../../src/services/report/step-summary.js'
import { buildInventory, detectionTarget, everyResultType, inventoryTarget, makeScript, runContext } from '../../src/services/report/test-fixtures.js'
import { FileReportWriter } from '../../src/services/report/writer.js'
import { UnknownScriptFound } from '../../src/types/comparison/unknown-script-found.js'
import type { Inventory } from '../../src/types/inventory/model.js'
import { type AuditorReport, REPORT_SCHEMA_VERSION } from '../../src/types/report.js'

describe('auditor report end to end', () => {
  let reportDir: string

  beforeEach(async () => {
    reportDir = await mkdtemp(join(tmpdir(), 'auditor-report-'))
  })

  afterEach(async () => {
    await rm(reportDir, { recursive: true, force: true })
  })

  // The report and its inventory copies come out together, because the writer
  // requires them to agree — a report citing a copy it did not ship would be a
  // compliance document pointing at evidence that is not there.
  const buildWritable = (pass: 'inventory' | 'detection' = 'detection'): { report: AuditorReport; files: InventoryFileCopy[] } => {
    const inventory = buildInventory()
    const collector = new ReportCollector()

    collector.recordTargetRun({ inventory, target: pass === 'inventory' ? inventoryTarget : detectionTarget, comparisonResults: everyResultType(inventory) })
    collector.recordInventoryRef(pass, { branch: 'main', commitSha: 'abc1234', commitIsoDate: '2026-01-01T00:00:00.000Z', repositoryUrl: 'https://github.example.com/org/inventory' })

    return { report: collector.build(pass, runContext())!, files: collector.getInventoryFiles(pass) }
  }

  const buildReport = (pass: 'inventory' | 'detection' = 'detection'): AuditorReport => buildWritable(pass).report

  /** Write a fixture report together with the copies it cites. */
  const writeFixture = async (writer: FileReportWriter, pass: 'inventory' | 'detection' = 'detection', directory = reportDir) => {
    const { report, files } = buildWritable(pass)

    return writer.write(report, directory, files)
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
      const paths = await writeFixture(new FileReportWriter())

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
      const paths = await writeFixture(new FileReportWriter())

      expect(await readFile(paths.jsonPath, 'utf8')).toMatch(/\n$/u)
    })

    it('produces HTML that loads nothing from the network', async () => {
      const paths = await writeFixture(new FileReportWriter())
      const html = await readFile(paths.htmlPath, 'utf8')

      expect(html).not.toMatch(/\ssrc="/u)
      expect(html).toContain("default-src 'none'")
    })

    it('writes both passes side by side with a linking index', async () => {
      const writer = new FileReportWriter()
      const inventoryPaths = await writeFixture(writer, 'inventory')
      const detectionPaths = await writeFixture(writer, 'detection')

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
      const paths = await new FileReportWriter().write(report, reportDir, collector.getInventoryFiles('detection'))
      const written = JSON.parse(await readFile(paths.jsonPath, 'utf8'))
      const rows = written.targets.flatMap((target: { scripts: { observed: { contentExcerpt: string | null; hash: string | null } }[] }) => target.scripts)

      expect(rows.length).toBe(ROWS)
      expect(rows[0].observed.contentExcerpt).toHaveLength(128)
      // The hash is the integrity anchor and is never dropped.
      expect(rows[0].observed.hash).not.toBeNull()
      expect(written.notes.some((note: string) => note.includes('shortened'))).toBe(true)

      const html = await readFile(paths.htmlPath, 'utf8')

      // The label must state what is actually shown, not the default limit.
      expect(html).not.toContain('512 chars shown')
      expect(html).toContain('(128 chars shown; original 4000 chars)')
      // Two full renders (measure, then re-render smaller) on a deliberately
      // oversized fixture — slower than the default 5s budget.
    }, 30000)
  })

  describe('inventory shipped beside the report', () => {
    // One inventory instance, shared: provenance is resolved by identity
    // (`indexOf` on the recorded inventory), so a second `buildInventory()`
    // would legitimately resolve to nothing.
    const buildCollector = (): { collector: ReportCollector; inventory: Inventory } => {
      const inventory = buildInventory()
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: everyResultType(inventory) })

      return { collector, inventory }
    }

    it('copies the exact bytes the run read, next to the report', async () => {
      const { collector, inventory } = buildCollector()
      const report = collector.build('detection', runContext())!
      const paths = await new FileReportWriter().write(report, reportDir, collector.getInventoryFiles('detection'))

      const copied = await readFile(join(reportDir, 'detection', 'inventory', 'targets', '1.0.json'), 'utf8')

      // Byte-identical to what the comparison ran against — not a re-serialised
      // model, which would renumber every line the report cites.
      expect(copied).toBe(inventory.source!.text)
      expect(paths.jsonPath).toBe(join(reportDir, 'detection', 'report.json'))
    })

    it('records a digest an auditor can verify against the copy', async () => {
      const { collector } = buildCollector()
      const report = collector.build('detection', runContext())!
      const paths = await new FileReportWriter().write(report, reportDir, collector.getInventoryFiles('detection'))

      const written = JSON.parse(await readFile(paths.jsonPath, 'utf8'))

      expect(written.run.inventorySources).toHaveLength(1)

      const [source] = written.run.inventorySources
      const copied = await readFile(join(reportDir, 'detection', source.copiedTo), 'utf8')

      expect(source.file).toBe('targets/1.0.json')
      expect(source.copiedTo).toBe('inventory/targets/1.0.json')
      // Computed independently of the collector, so a broken hash helper cannot
      // agree with itself.
      expect(source.sha256).toBe(createHash('sha256').update(copied, 'utf8').digest('hex'))
      expect(source.bytes).toBe(Buffer.byteLength(copied, 'utf8'))
    })

    it('makes the provenance line references resolve within the shipped copy', async () => {
      // This is the whole point: `targets/1.0.json:12` in the report has to mean
      // something months later, when the branch has moved on.
      const { collector } = buildCollector()
      const report = collector.build('detection', runContext())!

      await new FileReportWriter().write(report, reportDir, collector.getInventoryFiles('detection'))

      const authorised = report.targets.flatMap((target) => [...target.scripts, ...target.headers]).filter((row) => row.status === 'authorised')

      expect(authorised.length).toBeGreaterThan(0)

      for (const row of authorised) {
        const provenance = row.inventoryEntry!.provenance!
        const lines = (await readFile(join(reportDir, 'detection', 'inventory', provenance.entry.file), 'utf8')).split('\n')

        expect(provenance.entry.line).toBeGreaterThanOrEqual(1)
        expect(provenance.entry.line).toBeLessThanOrEqual(lines.length)
        // Both are 1-based; a 0 column would make the slice below silently
        // read from the end of the line instead of failing.
        expect(provenance.entry.column).toBeGreaterThanOrEqual(1)
        // The cited column holds the start of a JSON value, not blank space.
        expect(lines[provenance.entry.line - 1]!.slice(provenance.entry.column - 1)).toMatch(/^[[{"\d\-tfn]/u)
      }
    })

    it('keeps each pass pointing at the branch it actually read', async () => {
      // Under `--mode all` the passes read different branches. One shared copy
      // would misrepresent at least one of them.
      const writer = new FileReportWriter()
      const inventoryText = buildInventory().source!.text.replace('Analytics, approved by security', 'Analytics, approved by security (inventory branch)')
      const collector = new ReportCollector()

      collector.recordTargetRun({ inventory: buildInventory(inventoryText), target: inventoryTarget, comparisonResults: [] })
      collector.recordTargetRun({ inventory: buildInventory(), target: detectionTarget, comparisonResults: [] })

      await writer.write(collector.build('inventory', runContext())!, reportDir, collector.getInventoryFiles('inventory'))
      await writer.write(collector.build('detection', runContext())!, reportDir, collector.getInventoryFiles('detection'))

      const fromInventory = await readFile(join(reportDir, 'inventory', 'inventory', 'targets', '1.0.json'), 'utf8')
      const fromDetection = await readFile(join(reportDir, 'detection', 'inventory', 'targets', '1.0.json'), 'utf8')

      expect(fromInventory).toContain('(inventory branch)')
      expect(fromDetection).not.toContain('(inventory branch)')
    })

    it('refuses a path that would escape the report directory, writing nothing at all', async () => {
      // Names come from the inventory repository, which is a supply-chain
      // surface: a traversing filename must fail loudly, not overwrite. Climb
      // far enough to clear the temp directory itself, not just the copy dir.
      const outside = join(reportDir, '..', 'pwned.json')
      const escape = new FileReportWriter().write(buildReport(), reportDir, [{ file: '../../../pwned.json', text: 'x' }])

      await expect(escape).rejects.toThrow(/outside the report directory/u)
      await expect(stat(outside)).rejects.toThrow(/ENOENT/u)
      // Validation precedes every write, so no half-written report is left
      // claiming an inventory copy that never landed.
      await expect(stat(join(reportDir, 'detection', 'report.json'))).rejects.toThrow(/ENOENT/u)
    })

    it('refuses to ship a report citing copies it was not given', async () => {
      // The document renders those citations as links and as digests to verify.
      // A mismatch would put an auditor in front of evidence that is not there.
      const mismatched = new FileReportWriter().write(buildReport(), reportDir, [])

      await expect(mismatched).rejects.toThrow(/cites inventory sources .* but was given/u)
    })

    it('refuses copies whose bytes are not the ones the report vouches for', async () => {
      // The digest in the document is what an auditor checks the copy against.
      // Writing different bytes under it would make the report vouch for
      // content it never saw — the exact failure the copies exist to prevent.
      const { report, files } = buildWritable()
      const tampered = files.map(({ file, text }) => ({ file, text: `${text} ` }))

      await expect(new FileReportWriter().write(report, reportDir, tampered)).rejects.toThrow(/does not match the report: cites sha256/u)
      await expect(stat(join(reportDir, 'detection', 'report.json'))).rejects.toThrow(/ENOENT/u)
    })

    it('refuses two copies claiming the same path', async () => {
      const { report, files } = buildWritable()
      const duplicated = [...files, ...files]

      await expect(new FileReportWriter().write(report, reportDir, duplicated)).rejects.toThrow(/two inventory copies/u)
    })

    it('writes no inventory directory when no source text was retained', async () => {
      // Through the collector, not a hand-passed [], so this exercises the path
      // a real run takes when the repository retained no raw text.
      const collector = new ReportCollector()
      const { source: _dropped, ...withoutSource } = buildInventory()

      collector.recordTargetRun({ inventory: withoutSource, target: detectionTarget, comparisonResults: [] })

      const files = collector.getInventoryFiles('detection')

      expect(files).toEqual([])

      const report = collector.build('detection', runContext())!

      expect(report.run.inventorySources).toEqual([])

      await new FileReportWriter().write(report, reportDir, files)

      await expect(stat(join(reportDir, 'detection', 'inventory'))).rejects.toThrow(/ENOENT/u)
    })
  })

  describe('determinism', () => {
    it('produces byte-identical documents across runs once run metadata is removed', async () => {
      const writer = new FileReportWriter()
      const first = await writeFixture(writer)
      const firstJson = JSON.parse(await readFile(first.jsonPath, 'utf8'))

      const secondDir = await mkdtemp(join(tmpdir(), 'auditor-report-'))

      try {
        const second = await writeFixture(writer, 'detection', secondDir)
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
