/**
 * Rendering and cross-site-scripting tests for the HTML report.
 *
 * Everything the report says about a detected resource is attacker-supplied —
 * script URLs, inline bodies and header values are exactly what an e-skimmer
 * leaves behind. These tests exist so that an escaping regression fails here
 * rather than in an assessor's browser.
 *
 * @see ./template.ts
 * @see ./escape.ts
 */

import { AuthorizedScriptFound } from '../../../types/comparison/authorized-script-found.js'
import { UnknownHeaderFound } from '../../../types/comparison/unknown-header-found.js'
import { UnknownScriptFound } from '../../../types/comparison/unknown-script-found.js'
import type { AuditorReport } from '../../../types/report.js'
import { ReportCollector } from '../collector.js'
import { buildInventory, detectionTarget, everyResultType, makeHeader, makeScript, runContext } from '../test-fixtures.js'
import { artefactRelativeHref, escapeHtml } from './escape.js'
import { renderReportHtml } from './template.js'

describe('renderReportHtml', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z')

  const build = (results?: ReturnType<typeof everyResultType>, inventory?: ReturnType<typeof buildInventory>): AuditorReport => {
    // One inventory serves both defaults: results built from a different
    // instance would fail entry-identity lookups and quietly test rows with
    // null provenance.
    const owner = inventory ?? buildInventory()
    const collector = new ReportCollector()

    collector.recordTargetRun({ inventory: owner, target: detectionTarget, comparisonResults: results ?? everyResultType(owner) })

    return collector.build('detection', runContext())!
  }

  /**
   * Every `href` in the document, with entities decoded.
   *
   * Decoding matters: the renderer escapes `/` to `&#x2F;`, which a browser
   * resolves back — so a check against the raw attribute text would miss a
   * `javascript&#x3A;` payload.
   */
  const hrefs = (html: string): string[] =>
    [...html.matchAll(/href="([^"]*)"/gu)].map((match) =>
      match[1]!
        .replace(/&#x([0-9a-f]+);/giu, (_full, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/gu, (_full, dec: string) => String.fromCharCode(Number(dec)))
        .replace(/&amp;/gu, '&'),
    )

  /**
   * A link is safe if it is an in-page anchor, an https run-metadata link, or a
   * relative path to a file inside the artefact (the inventory copies). It must
   * never carry a scheme, be absolute, or climb out of the directory.
   */
  const isSafeHref = (href: string): boolean => {
    if (href.startsWith('#') || href.startsWith('https://')) return true
    if (href.startsWith('/') || href.startsWith('\\')) return false
    if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return false

    return !href.split('/').includes('..')
  }

  /** Build a report whose detected content carries `payload` in every field an attacker controls. */
  const buildWithPayload = (payload: string): AuditorReport => {
    const inventory = buildInventory()

    return build(
      [
        new UnknownScriptFound(detectionTarget, timestamp, makeScript({ name: payload, content: payload, url: `https://evil.example.test/${encodeURIComponent(payload)}`, hash: { value: payload } })),
        new UnknownHeaderFound(detectionTarget, timestamp, makeHeader({ name: 'x-evil', value: payload })),
        new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [{ description: payload, authorised: true, date: timestamp }]),
      ],
      inventory,
    )
  }

  describe('document structure', () => {
    it('renders a complete standalone document', () => {
      const html = renderReportHtml(build())

      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(html).toContain('<html lang="en">')
      expect(html.trimEnd().endsWith('</html>')).toBe(true)
    })

    it('declares a Content-Security-Policy that hashes its own script', () => {
      const html = renderReportHtml(build())

      expect(html).toMatch(/content="default-src 'none';[^"]*script-src 'sha256-[A-Za-z0-9+/=]+'/u)
      expect(html).not.toContain("script-src 'unsafe-inline'")
    })

    it('contains exactly one script element', () => {
      expect(renderReportHtml(build()).match(/<script/gu)).toHaveLength(1)
    })

    it('loads no external resources, so the page works offline', () => {
      // No `src` at all: nothing is fetched when the document opens. The one
      // permitted external `href` (the inventory repository) is only followed
      // if a human clicks it, so it cannot leak that the artefact was opened.
      expect(renderReportHtml(build())).not.toMatch(/\ssrc="/u)
    })

    it('links only in-page anchors, https run metadata, or files inside the artefact', () => {
      for (const reference of hrefs(renderReportHtml(build()))) {
        expect({ href: reference, safe: isSafeHref(reference) }).toEqual({ href: reference, safe: true })
      }
    })

    it('offers a type filter alongside the status filter', () => {
      const html = renderReportHtml(build())

      for (const kind of ['external_script', 'inline_script', 'header']) {
        expect(html).toContain(`data-kind="${kind}"`)
      }

      // Every row must be filterable, or the checkbox silently does nothing.
      expect(html.match(/<tr data-row[^>]*data-kind="/gu)).toHaveLength(7)
    })

    it('leads each row with the human-readable justification', () => {
      // "What is this script and why is it here" is the question an assessor
      // opens the report to answer; it gets its own column, not a footnote.
      const html = renderReportHtml(build())
      const headings = [...html.matchAll(/<th scope="col">([^<]*)<\/th>/gu)].map((match) => match[1]!.trim())

      expect(headings.slice(0, 5)).toEqual(['Status', 'Resource', 'What it is', 'Integrity', 'Inventory source'])
      expect(html).toContain('Analytics, approved by security')
    })

    it('does not repeat a header value as a content excerpt', () => {
      // For a header the excerpt IS the value, already shown in the row.
      const html = renderReportHtml(build())
      const headerRows = [...html.matchAll(/<tr data-row[^>]*data-kind="header"[\s\S]*?<\/tr>/gu)].map((match) => match[0])

      expect(headerRows.length).toBeGreaterThan(0)
      for (const row of headerRows) expect(row).not.toContain('Content excerpt')
    })

    it('pins the column headers so they survive a long table', () => {
      expect(renderReportHtml(build())).toMatch(/th \{[^}]*position: sticky/u)
    })

    it('renders every row of the census', () => {
      const html = renderReportHtml(build())

      // The census is what was observed. Unmatched inventory entries are rows
      // too, but they are counted separately below.
      expect(html.match(/<tr data-row[^>]*data-kind=/gu)).toHaveLength(7)
    })

    it('lists each shipped inventory copy, linked at the path it was written to', () => {
      const report = build()
      const html = renderReportHtml(report)

      expect(report.run.inventorySources.length).toBeGreaterThan(0)
      expect(html).toContain('Inventory as scanned')

      for (const source of report.run.inventorySources) {
        // The href must be the artefact-relative `copiedTo`, or the link points
        // at evidence that is not where the document says it is.
        expect(html).toContain(`href="${escapeHtml(artefactRelativeHref(source.copiedTo)!)}"`)
        expect(html).toContain(escapeHtml(source.copiedTo))
        // The digest is what an auditor verifies the copy against.
        expect(html).toContain(source.sha256.slice(0, 16))
      }
    })

    it('renders unmatched inventory entries as filterable rows, off by default', () => {
      const html = renderReportHtml(build())

      expect(html.match(/data-status="not_observed"/gu)!.length).toBeGreaterThan(1)

      // The checkbox ships unchecked, so the block starts hidden once the
      // filter script runs...
      expect(html).toContain('<input type="checkbox" data-status="not_observed" />')
      expect(html).not.toContain('data-status="not_observed" checked')

      // ...but the markup itself is complete, so JS-off readers still see it.
      expect(html).toContain('<div data-block>')
      expect(html).toContain('Inventory entries not observed in this run')
    })

    it('exempts unmatched entries from the Type filter rather than mislabelling their kind', () => {
      // An inventory entry for a script may match an external or an inline one;
      // claiming either bucket would hide the row for the wrong reason.
      const unmatchedRows = renderReportHtml(build()).match(/<tr data-row[^>]*data-status="not_observed"[^>]*>/gu)!

      expect(unmatchedRows.length).toBeGreaterThan(0)
      for (const row of unmatchedRows) expect(row).not.toContain('data-kind=')
    })

    it('ships every row visible, so the page is complete without JavaScript', () => {
      const html = renderReportHtml(build())

      expect(html).not.toMatch(/<tr data-row[^>]*\shidden/u)
    })

    it('uses real table semantics for assistive technology', () => {
      const html = renderReportHtml(build())

      expect(html).toContain('<caption>')
      expect(html).toContain('<th scope="col">')
      expect(html).toContain('aria-live="polite"')
    })

    it('shows the inventory revision the run compared against', () => {
      const html = renderReportHtml(build())

      expect(html).toContain('abc1234def5678')
    })

    it('warns prominently when the census was filtered', () => {
      const collector = new ReportCollector()
      const inventory = buildInventory()

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: everyResultType(inventory) })

      const html = renderReportHtml(collector.build('detection', runContext({ targetFilter: '1.0' }))!)

      expect(html).toContain('PARTIAL CENSUS')
    })
  })

  describe('cross-site scripting', () => {
    const PAYLOADS = ['"><script>alert(1)</script>', '</script><img src=x onerror=alert(1)>', '" onmouseover="alert(1)', "'; alert(1); //", '<svg/onload=alert(1)>', '</style><script>alert(1)</script>', ' alert(1) ', '`${alert(1)}`']

    it.each(PAYLOADS)('neutralises %j wherever it appears in detected content', (payload) => {
      const html = renderReportHtml(buildWithPayload(payload))

      // Still exactly one script element — ours.
      expect(html.match(/<script/gu)).toHaveLength(1)
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).not.toContain('<img src=x onerror=alert(1)>')
      expect(html).not.toContain('<svg/onload=alert(1)>')
      expect(html).not.toMatch(/\son(?:error|load|mouseover|click)\s*=/iu)
    })

    it.each(PAYLOADS)('keeps %j out of every href, and emits no src at all', (payload) => {
      const html = renderReportHtml(buildWithPayload(payload))

      expect(html).not.toMatch(/\ssrc="/u)

      for (const reference of hrefs(html)) {
        expect({ href: reference, safe: isSafeHref(reference) }).toEqual({ href: reference, safe: true })
        expect(reference.toLowerCase()).not.toContain('javascript:')
        expect(reference.toLowerCase()).not.toContain('data:')
      }
    })

    it('renders a javascript: script URL as text, never as a link', () => {
      const html = renderReportHtml(buildWithPayload('javascript:alert(document.cookie)'))

      // Present as evidence…
      expect(html).toContain('javascript:alert(document.cookie)')
      // …but never as something clickable.
      expect(html).not.toMatch(/href="javascript:/iu)
      expect(html).not.toMatch(/src="javascript:/iu)
    })

    it('does not link a non-https repository URL', () => {
      const collector = new ReportCollector()
      const inventory = buildInventory()

      collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [] })
      collector.recordInventoryRef('detection', { branch: 'main', commitSha: null, commitIsoDate: null, repositoryUrl: 'javascript:alert(1)' })

      const html = renderReportHtml(collector.build('detection', runContext())!)

      expect(html).not.toMatch(/href="javascript:/iu)
    })

    it('embeds no JSON island an attacker could break out of', () => {
      // The sibling report.json is the machine-readable form; embedding it here
      // would reintroduce the </script> breakout this design avoids.
      expect(renderReportHtml(buildWithPayload('</script>'))).not.toContain('application/json')
    })
  })
})
