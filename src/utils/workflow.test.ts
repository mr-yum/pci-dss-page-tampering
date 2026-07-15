import type { WorkflowStep } from '../types/workflow.js'
import { collectTotpSeedRefs } from './workflow.js'

describe('collectTotpSeedRefs', () => {
  const step = (action: WorkflowStep['action']): WorkflowStep => ({
    description: 'step',
    waitFor: [{ type: 'input', identifier: 'field' }],
    action,
  })

  it('collects seedRefs from totp steps', () => {
    const steps = [step({ type: 'input', value: 'user@example.com' }), step({ type: 'totp', seedRef: 'checkout' })]
    expect(collectTotpSeedRefs(steps)).toEqual(new Set(['checkout']))
  })

  it('recurses into clickPopup sub-steps', () => {
    const steps = [step({ type: 'clickPopup', steps: [step({ type: 'totp', seedRef: 'popup-login' })] })]
    expect(collectTotpSeedRefs(steps)).toEqual(new Set(['popup-login']))
  })

  it('trims seedRefs to match the trimmed --totp-seed names', () => {
    const steps = [step({ type: 'totp', seedRef: ' checkout ' })]
    expect(collectTotpSeedRefs(steps)).toEqual(new Set(['checkout']))
  })

  it('deduplicates repeated seedRefs and returns an empty set when no totp steps exist', () => {
    expect(collectTotpSeedRefs([step({ type: 'totp', seedRef: 'a' }), step({ type: 'totp', seedRef: 'a' })])).toEqual(new Set(['a']))
    expect(collectTotpSeedRefs([step({ type: 'click' })])).toEqual(new Set())
  })
})
