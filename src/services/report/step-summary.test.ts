import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found.js'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import { ReportCollector } from './collector.js'
import { buildStepSummary } from './step-summary.js'
import { buildInventory, detectionTarget, makeScript, OTHER_HASH, runContext } from './test-fixtures.js'

describe('buildStepSummary payment scope', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z')
  const tagManager = () => makeScript({ name: 'https://tagmanager.example/tm.js', url: 'https://tagmanager.example/tm.js', content: 'tm', hash: { value: OTHER_HASH } })

  it('does not list a resource from a page loaded before the payment page as a finding', () => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    collector.recordTargetRun({
      inventory,
      target: detectionTarget,
      comparisonResults: [new AuthorizedScriptFound(detectionTarget, timestamp, makeScript(), inventory.scripts[0]!, [])],
      scope: 'payment',
      paymentScope: { declared: true, paymentDocuments: ['l2'], documents: [] },
    })
    collector.recordTargetRun({ inventory, target: detectionTarget, comparisonResults: [new UnknownScriptFound(detectionTarget, timestamp, tagManager())], scope: 'outside_payment' })

    const markdown = buildStepSummary(collector.build('detection', runContext())!)

    expect(markdown).toContain('No findings: every script and header on the payment page')
    expect(markdown).not.toContain('every observed script and header was authorised')
    expect(markdown).not.toContain('tagmanager.example')
    expect(markdown).toContain('1 resource(s) were observed on pages loaded before the payment page')
  })

  it('still lists the same resource as a finding when it is on the payment page', () => {
    const inventory = buildInventory()
    const collector = new ReportCollector()
    collector.recordTargetRun({
      inventory,
      target: detectionTarget,
      comparisonResults: [new UnknownScriptFound(detectionTarget, timestamp, tagManager())],
      scope: 'payment',
      paymentScope: { declared: true, paymentDocuments: ['l2'], documents: [] },
    })

    const markdown = buildStepSummary(collector.build('detection', runContext())!)

    expect(markdown).toContain('### Findings (1)')
    expect(markdown).toContain('tagmanager.example')
    expect(markdown).not.toContain('pages loaded before the payment page')
  })
})
