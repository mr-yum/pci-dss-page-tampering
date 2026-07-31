import type { WorkflowStep } from '../types/workflow.js'
import { collectTotpSeedRefs, stepsToPuppeteerLocatorAction } from './workflow.js'

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

  it('preserves a frame URL matcher for execution-time frame resolution', () => {
    const frameStep: WorkflowStep = {
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl: '^https://payments\\.example\\.com/card-frame',
    }

    expect(stepsToPuppeteerLocatorAction([frameStep])).toEqual([
      {
        description: 'step',
        querySelector: 'input[name="field"]',
        frameUrl: '^https://payments\\.example\\.com/card-frame',
        action: { type: 'input', value: '4242424242424242' },
        delay: 0,
      },
    ])
  })

  it('preserves a click response matcher for execution-time synchronization', () => {
    const responseStep = step({
      type: 'click',
      waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods(?:\\?.*)?$',
      waitForResponseTimeout: 240000,
      waitForResponseMethod: 'POST',
      waitForResponseStatuses: [200, 402],
      postActionDelay: 2500,
    })

    expect(stepsToPuppeteerLocatorAction([responseStep])).toEqual([
      {
        description: 'step',
        querySelector: 'input[name="field"]',
        frameUrl: undefined,
        action: {
          type: 'click',
          waitForNavigation: false,
          waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods(?:\\?.*)?$',
          waitForResponseTimeout: 240000,
          waitForResponseMethod: 'POST',
          waitForResponseStatuses: [200, 402],
        },
        delay: 0,
        postActionDelay: 2500,
      },
    ])
  })

  it('rejects response synchronization on a programmatically constructed non-click action', () => {
    const invalidStep = step({ type: 'input', value: 'value', waitForResponse: '^https://api\\.payments\\.example/' })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow("Response waiting options are only supported for workflow actions of type 'click'")
  })

  it('rejects an untrusted response matcher in a programmatically constructed click action', () => {
    const invalidStep = step({ type: 'click', waitForResponse: '.*' })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow('waitForResponse must begin with an anchored, exact HTTPS origin')
  })

  it('rejects a programmatic response timeout without a response matcher', () => {
    const invalidStep = step({ type: 'click', waitForResponseTimeout: 240000 })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow('Response waiting options require waitForResponse')
  })

  it.each([0, -1, 1.5, 300001, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid programmatic response timeout: %s', (waitForResponseTimeout) => {
    const invalidStep = step({
      type: 'click',
      waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
      waitForResponseTimeout,
    })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow()
  })

  it.each([{ statuses: [] }, { statuses: [99] }, { statuses: [600] }, { statuses: [200.5] }])('rejects invalid programmatic response statuses: $statuses', ({ statuses: waitForResponseStatuses }) => {
    const invalidStep = step({
      type: 'click',
      waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
      waitForResponseStatuses,
    })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow()
  })

  it('rejects an invalid programmatic response method', () => {
    const invalidStep = step({
      type: 'click',
      waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
      waitForResponseMethod: 'TRACE',
    } as unknown as WorkflowStep['action'])

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow()
  })

  it.each([0, -1, 1.5, 300001, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid programmatic post-action delay: %s', (postActionDelay) => {
    const invalidStep = step({ type: 'click', postActionDelay })

    expect(() => stepsToPuppeteerLocatorAction([invalidStep])).toThrow()
  })
})
