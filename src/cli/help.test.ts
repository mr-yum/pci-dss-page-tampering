import { generateHelpText } from './help.js'

describe('CLI help text', () => {
  const helpText = generateHelpText()

  it('documents the rum-compare execution mode', () => {
    expect(helpText).toContain('rum-compare')
    expect(helpText).toContain('RUM Compare Mode (--mode rum-compare)')
  })

  it('documents the --rum-queue-url parameter and its mode binding', () => {
    expect(helpText).toContain('--rum-queue-url <URL>')
    expect(helpText).toContain('Required with --mode rum-compare; rejected in any')
  })

  it('names the three rum_* alert categories in the alerting section', () => {
    expect(helpText).toContain('rum_uninventoried_script_detected')
    expect(helpText).toContain('rum_mismatched_script_detected')
    expect(helpText).toContain('rum_csp_violation_reported')
  })

  it('stays under the 1000-word cap enforced by the help integration test', () => {
    expect(helpText.split(/\s+/).length).toBeLessThan(1000)
  })
})
