/**
 * Collect auditor-report rows during a run.
 *
 * Two design points worth knowing before changing this:
 *
 * 1. **Results are mapped eagerly.** A `ComparisonResultType` holds the whole
 *    script body, the entire `Target` (workflow definition and logger) and the
 *    `Inventory` matcher trees. Retaining them for every target of a
 *    `--mode all` run would be a real memory problem in the Puppeteer
 *    container, so `recordTargetRun` converts to plain data and lets the
 *    results go.
 * 2. **Ordering is imposed, never inherited.** Rows arrive in whatever order
 *    Puppeteer saw them; two runs of an unchanged page must still produce
 *    byte-identical documents, so everything is sorted on the way out.
 *
 * @see ../../interfaces/report.ts
 */

import type { InventoryFileCopy, IReportCollector, ReportInventoryRefInput, ReportRunContext } from '../../interfaces/report.js'
import type { ComparisonResultType } from '../../types/comparison.js'
import type { Inventory, InventoryHeaderInfo, InventoryScriptInfo } from '../../types/inventory/model.js'
import type { AuditorReport, ReportPass, ReportResourceRow, ReportStatusCounts, ReportTargetSection, ReportUnmatchedEntry } from '../../types/report.js'
import { REPORT_SCHEMA_VERSION } from '../../types/report.js'
import type { Target } from '../../types/target.js'
import { createSha256Hash } from '../../utils/hash.js'
import { inventoryHeaderInfoToRawInventoryHeaderInfo } from '../../utils/inventory.js'
import { createProvenanceResolver, createSourceLocator, type ProvenanceResolver } from '../../utils/provenance.js'
import { inventoryScriptInfoToRawInventoryScriptInfo } from '../../utils/script.js'
import { redactUrl } from '../../utils/url.js'
import { redactForDisplay, toReportRow } from './mapper.js'
import { toReportAuthorisationInfo, toReportMatcherRef } from './matcher-ref.js'

const GENERATOR_NAME = 'pci-dss-page-tampering'

/** Numeric collation so `1.0` sorts before `1.10` before `2.0`. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function emptyCounts(): ReportStatusCounts {
  return { authorised: 0, unauthorised_content: 0, unknown: 0, missing_required: 0, total: 0 }
}

function countRows(rows: readonly ReportResourceRow[]): ReportStatusCounts {
  const counts = emptyCounts()

  for (const row of rows) {
    counts[row.status] += row.occurrences
    counts.total += row.occurrences
  }

  return counts
}

function addCounts(into: ReportStatusCounts, from: ReportStatusCounts): void {
  into.authorised += from.authorised
  into.unauthorised_content += from.unauthorised_content
  into.unknown += from.unknown
  into.missing_required += from.missing_required
  into.total += from.total
}

/** Total order over rows, so shuffled input produces identical output. */
function compareRows(left: ReportResourceRow, right: ReportResourceRow): number {
  return (
    collator.compare(left.kind, right.kind) ||
    collator.compare(left.name, right.name) ||
    collator.compare(left.origin.url ?? '', right.origin.url ?? '') ||
    collator.compare(left.workflowId, right.workflowId) ||
    collator.compare(left.observed.hash ?? '', right.observed.hash ?? '') ||
    collator.compare(left.value ?? '', right.value ?? '') ||
    collator.compare(left.rowId, right.rowId)
  )
}

type TargetSectionState = {
  targetKey: string
  inventoryFile: string
  workflowId: string
  targetName: string
  targetType: ReportPass
  url: string
  workflowFile: string
  status: 'completed' | 'failed'
  error: string | null
  rows: Map<string, ReportResourceRow>
  /**
   * Accumulated across every recordTargetRun call that lands in this section —
   * rows accumulate, so the matched sets must too, or a second call would
   * recompute `unmatched` from its own matches alone and report entries the
   * first call matched as "not observed".
   */
  matchedScripts: Set<InventoryScriptInfo>
  matchedHeaders: Set<InventoryHeaderInfo>
  unmatched: ReportUnmatchedEntry[]
}

export class ReportCollector implements IReportCollector {
  private readonly passes = new Map<ReportPass, Map<string, TargetSectionState>>()
  private readonly inventoryRefs = new Map<ReportPass, ReportInventoryRefInput>()
  /**
   * Verbatim inventory text per pass, keyed by repo-relative path.
   *
   * The same strings the Inventory objects already hold — retaining a reference
   * costs nothing — and the same bytes the provenance line numbers were
   * computed against, which is what makes shipping them worthwhile.
   */
  private readonly inventoryFiles = new Map<ReportPass, Map<string, string>>()

  recordTargetRun(input: { inventory: Inventory; target: Target; comparisonResults: readonly ComparisonResultType[] }): void {
    const { inventory, target, comparisonResults } = input
    const section = this.sectionFor(inventory, target)

    // One resolver per target run: parsing the file and indexing its positions
    // is per-file work, not per-row work.
    const resolveProvenance: ProvenanceResolver | null = createProvenanceResolver(inventory)
    const workflowId = target.workflowId ?? 'default'

    for (const result of comparisonResults) {
      const row = toReportRow(result, inventory, workflowId, resolveProvenance)
      const existing = section.rows.get(row.rowId)

      // A header repeated across responses is one control observed many times,
      // not many findings. Collapse, but keep the count as real signal.
      if (existing) existing.occurrences += 1
      else section.rows.set(row.rowId, row)

      if ('inventoryEntry' in result) {
        if (result.type === 'authorized_script' || result.type === 'known_script_unauthorised_content' || result.type === 'missing_required_script') section.matchedScripts.add(result.inventoryEntry)
        else section.matchedHeaders.add(result.inventoryEntry)
      }
    }

    section.unmatched = this.collectUnmatched(inventory, section.matchedScripts, section.matchedHeaders)

    this.retainInventorySource(inventory, target)
  }

  /**
   * Keep the verbatim file the run read, for copying beside the report.
   *
   * Called on the failure path too: a run that fell over still has to say which
   * baseline it was working against, and that is exactly the run an assessor
   * asks about.
   */
  private retainInventorySource(inventory: Inventory, target: Target): void {
    if (inventory.source === undefined) return

    const pass: ReportPass = target.type === 'inventory' ? 'inventory' : 'detection'
    const files = this.inventoryFiles.get(pass) ?? new Map<string, string>()

    files.set(inventory.source.file, inventory.source.text)
    this.inventoryFiles.set(pass, files)
  }

  getInventoryFiles(pass: ReportPass): InventoryFileCopy[] {
    return [...(this.inventoryFiles.get(pass) ?? new Map<string, string>())].sort(([left], [right]) => collator.compare(left, right)).map(([file, text]) => ({ file, text }))
  }

  recordTargetFailure(input: { inventory: Inventory; target: Target; error: unknown }): void {
    const section = this.sectionFor(input.inventory, input.target)

    section.status = 'failed'
    // Redacted like every other string in the report: Git and network errors
    // routinely echo the authenticated remote, which would put a token into a
    // 90-day CI artefact the document itself promises is credential-free.
    section.error = redactForDisplay(input.error instanceof Error ? input.error.message : String(input.error)).text
    this.retainInventorySource(input.inventory, input.target)
  }

  recordInventoryRef(pass: ReportPass, ref: ReportInventoryRefInput): void {
    this.inventoryRefs.set(pass, ref)
  }

  build(pass: ReportPass, run: ReportRunContext): AuditorReport | null {
    const sections = this.passes.get(pass)

    if (sections === undefined || sections.size === 0) return null

    const targets: ReportTargetSection[] = [...sections.values()]
      .map((section) => {
        const rows = [...section.rows.values()].sort(compareRows)

        return {
          targetKey: section.targetKey,
          inventoryFile: section.inventoryFile,
          workflowId: section.workflowId,
          targetName: section.targetName,
          targetType: section.targetType,
          url: section.url,
          workflowFile: section.workflowFile,
          status: section.status,
          error: section.error,
          counts: countRows(rows),
          scripts: rows.filter((row) => row.kind !== 'header'),
          headers: rows.filter((row) => row.kind === 'header'),
          unmatchedInventoryEntries: [...section.unmatched].sort((left, right) => collator.compare(left.kind, right.kind) || left.index - right.index),
        }
      })
      .sort((left, right) => collator.compare(left.targetKey, right.targetKey))

    const summary = { ...emptyCounts(), targets: targets.length, targetsFailed: targets.filter((target) => target.status === 'failed').length }

    for (const target of targets) addCounts(summary, target.counts)

    const failures = targets.filter((target) => target.status === 'failed').map((target) => ({ targetKey: target.targetKey, message: target.error ?? 'unknown error' }))
    const ref = this.inventoryRefs.get(pass)

    const inventorySources = this.getInventoryFiles(pass).map(({ file, text }) => ({
      file,
      sha256: createSha256Hash(text).value,
      // Sibling of the report document, mirroring the repo layout.
      copiedTo: `inventory/${file}`,
      bytes: Buffer.byteLength(text, 'utf8'),
    }))

    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      generator: { name: GENERATOR_NAME, version: REPORT_SCHEMA_VERSION },
      run: {
        ...run,
        pass,
        // A recorded ref knows the real revision; without one, keep the
        // caller's whole ref rather than synthesising a partial one that
        // silently drops a commit id the caller already had.
        inventoryRef: ref ?? run.inventoryRef,
        status: failures.length > 0 ? 'partial' : 'complete',
        failures,
        inventorySources,
      },
      summary,
      targets,
      notes: this.buildNotes(run, failures.length > 0, inventorySources.length > 0),
    }
  }

  private buildNotes(run: ReportRunContext, partial: boolean, shipsInventoryCopies: boolean): string[] {
    const notes = [
      'Content excerpts are truncated and are for recognition only; the SHA-256 hash is the integrity anchor.',
      // Deliberately scoped to what was observed on the page. The verbatim
      // inventory copies below, when present, are not redacted — they cannot be,
      // without invalidating the line numbers this document cites.
      'Detected URLs — including script names and URLs embedded in header values — are shown without query strings, fragments or credentials, so no signed URL or token observed on the page reaches this document.',
      'Control and bidirectional formatting characters in detected content are replaced with a visible ⟨U+XXXX⟩ token.',
    ]

    if (shipsInventoryCopies) {
      notes.push(
        'This artefact also carries verbatim copies of the inventory files this run read, so the file and line references above stay resolvable. Those copies are reproduced exactly as committed and are NOT redacted: treat this artefact as having the same sensitivity as the inventory repository itself.',
      )
    }

    if (run.targetFilter !== null) notes.push(`PARTIAL CENSUS: this run was filtered to target '${run.targetFilter}' and does not cover every monitored target.`)
    if (partial) notes.push('PARTIAL RUN: one or more targets failed, so their resources are absent from this census.')

    return notes
  }

  /** Inventory entries that nothing observed matched — stale entries, or controls that stopped loading. */
  private collectUnmatched(inventory: Inventory, matchedScripts: ReadonlySet<InventoryScriptInfo>, matchedHeaders: ReadonlySet<InventoryHeaderInfo>): ReportUnmatchedEntry[] {
    const unmatched: ReportUnmatchedEntry[] = []
    // No comparison result exists for an unmatched entry, so there is no
    // authorisation to trace — only the entry's own location in the file.
    const locate = createSourceLocator(inventory)

    const describe = (kind: 'script' | 'header', index: number, entry: InventoryScriptInfo | InventoryHeaderInfo): ReportUnmatchedEntry => ({
      kind,
      index,
      identification: toReportMatcherRef(entry.identifyWith as never),
      authorisation: toReportMatcherRef(entry.authoriseWith.matcher as never),
      effective: toReportAuthorisationInfo(entry.authoriseWith.authorisationInfo),
      source: locate?.(`/${kind}s/${index}`) ?? null,
      raw: kind === 'script' ? inventoryScriptInfoToRawInventoryScriptInfo(entry as InventoryScriptInfo) : inventoryHeaderInfoToRawInventoryHeaderInfo(entry as InventoryHeaderInfo),
    })

    inventory.scripts.forEach((entry, index) => {
      if (!matchedScripts.has(entry)) unmatched.push(describe('script', index, entry))
    })

    inventory.headers.forEach((entry, index) => {
      if (!matchedHeaders.has(entry)) unmatched.push(describe('header', index, entry))
    })

    return unmatched
  }

  private sectionFor(inventory: Inventory, target: Target): TargetSectionState {
    const pass: ReportPass = target.type === 'inventory' ? 'inventory' : 'detection'
    const workflowId = target.workflowId ?? 'default'
    const targetKey = `${inventory.fileName}#${workflowId}`

    let sections = this.passes.get(pass)

    if (sections === undefined) {
      sections = new Map()
      this.passes.set(pass, sections)
    }

    let section = sections.get(targetKey)

    if (section === undefined) {
      section = {
        targetKey,
        inventoryFile: inventory.fileName,
        workflowId,
        targetName: target.name ?? targetKey,
        targetType: pass,
        url: redactUrl(target.url),
        workflowFile: target.workflow.fileName,
        status: 'completed',
        error: null,
        rows: new Map(),
        matchedScripts: new Set(),
        matchedHeaders: new Set(),
        unmatched: [],
      }
      sections.set(targetKey, section)
    }

    return section
  }
}

/**
 * Null object used when `--report-dir` is absent.
 *
 * Lets every call site stay unconditional, and makes the disabled path
 * provably inert rather than a series of `if (collector)` checks that could
 * drift apart.
 */
export class NoopReportCollector implements IReportCollector {
  recordTargetRun(_input: { inventory: Inventory; target: Target; comparisonResults: readonly ComparisonResultType[] }): void {}
  recordTargetFailure(_input: { inventory: Inventory; target: Target; error: unknown }): void {}
  recordInventoryRef(_pass: ReportPass, _ref: ReportInventoryRefInput): void {}
  build(_pass?: ReportPass, _run?: ReportRunContext): null {
    return null
  }
  getInventoryFiles(_pass?: ReportPass): InventoryFileCopy[] {
    return []
  }
}
