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
import { renderReportHtml } from './template.js'

describe('renderReportHtml', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z')

  const build = (results = everyResultType(buildInventory()), inventory = buildInventory()): AuditorReport => {
    const collector = new ReportCollector()

    collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: results })

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

    it('links only in-page anchors and https run metadata', () => {
      for (const reference of hrefs(renderReportHtml(build()))) {
        expect(reference.startsWith('#') || reference.startsWith('https://')).toBe(true)
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

      expect(html.match(/<tr data-row/gu)).toHaveLength(7)
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
        expect(reference.startsWith('#') || reference.startsWith('https://')).toBe(true)
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
