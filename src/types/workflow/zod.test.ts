import { WorkflowStepSchema } from './zod.js'

describe('WorkflowStepSchema', () => {
  const step = (action: object) => ({
    description: 'Enter one-time code',
    waitFor: [{ type: 'input', identifier: 'otp' }],
    action,
  })

  it('accepts a totp action with a seedRef', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'totp', seedRef: 'checkout-user' }))
    expect(result.success).toBe(true)
  })

  it('rejects a totp action without a seedRef', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'totp' }))
    expect(result.success).toBe(false)
  })

  it('rejects a totp action with a whitespace-only seedRef', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'totp', seedRef: '   ' }))
    expect(result.success).toBe(false)
  })

  it('still accepts an input action without a seedRef', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'input', value: 'guest@example.com' }))
    expect(result.success).toBe(true)
  })

  it('accepts a testid waitFor definition', () => {
    const result = WorkflowStepSchema.safeParse({
      description: 'Enter one-time code',
      waitFor: [{ type: 'testid', identifier: 'otp-input' }],
      action: { type: 'totp', seedRef: 'checkout-user' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts an id waitFor definition', () => {
    const result = WorkflowStepSchema.safeParse({
      description: 'Enter the card number in the provider iframe',
      waitFor: [{ type: 'id', identifier: 'credit_card_number' }],
      action: { type: 'input', value: 'card-number-sentinel' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown waitFor type', () => {
    const result = WorkflowStepSchema.safeParse({
      description: 'Enter the card number',
      waitFor: [{ type: 'cssSelector', identifier: '.card input' }],
      action: { type: 'input', value: 'card-number-sentinel' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts an aria waitFor definition', () => {
    const result = WorkflowStepSchema.safeParse({
      description: 'Add upgrade via icon button',
      waitFor: [{ type: 'aria', identifier: 'Add Cake' }],
      action: { type: 'click' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid frame URL matcher', () => {
    const result = WorkflowStepSchema.safeParse({
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl: '^https://payments\\.example\\.com/card-frame',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid frame URL matcher', () => {
    const result = WorkflowStepSchema.safeParse({
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl: '[',
    })
    expect(result.success).toBe(false)
  })

  it.each(['.*', 'payments\\.example\\.com', '^http://payments\\.example\\.com/', '^https://.*/', '^https://payments\\.example\\.com', '^https://payments\\.example\\.com:65536/'])(
    'rejects an untrusted frame URL matcher: %s',
    (frameUrl) => {
      const result = WorkflowStepSchema.safeParse({
        ...step({ type: 'input', value: '4242424242424242' }),
        frameUrl,
      })
      expect(result.success).toBe(false)
    },
  )

  it.each(['^https://payments\\.example\\.com/|.*', '^https://payments\\.example\\.com/|^https://attacker\\.example/'])('rejects top-level alternation that escapes the trusted frame origin: %s', (frameUrl) => {
    const result = WorkflowStepSchema.safeParse({
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl,
    })
    expect(result.success).toBe(false)
  })

  it('accepts grouped path alternation within the trusted frame origin', () => {
    const result = WorkflowStepSchema.safeParse({
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl: '^https://payments\\.example\\.com/card-frame(?:[?#]|$)',
    })
    expect(result.success).toBe(true)
  })

  it('accepts the highest valid HTTPS port', () => {
    const result = WorkflowStepSchema.safeParse({
      ...step({ type: 'input', value: '4242424242424242' }),
      frameUrl: '^https://payments\\.example\\.com:65535/card-frame',
    })
    expect(result.success).toBe(true)
  })

  it('accepts opt-in recovery for a missing pre-action target', () => {
    expect(
      WorkflowStepSchema.safeParse({
        ...step({ type: 'input', value: 'value', reloadOnMissingTarget: true }),
        frameUrl: '^https://payments\\.example\\.com/card-frame',
      }).success,
    ).toBe(true)
    expect(WorkflowStepSchema.safeParse(step({ type: 'input', value: 'value', reloadOnMissingTarget: true })).success).toBe(false)
    expect(WorkflowStepSchema.safeParse(step({ type: 'input', value: 'value', reloadOnMissingTarget: false as never })).success).toBe(false)
  })

  it('accepts an anchored HTTPS response matcher on a click action', () => {
    const result = WorkflowStepSchema.safeParse(
      step({
        type: 'click',
        waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods(?:\\?.*)?$',
        waitForResponseTimeout: 240000,
        waitForResponseMethod: 'POST',
        waitForResponseStatuses: [200, 402],
        waitForResponseBody: '"code"\\s*:\\s*"card_declined"',
        postActionDelay: 2500,
      }),
    )
    expect(result.success).toBe(true)
  })

  it.each(['.*', 'api\\.payments\\.example', '^http://api\\.payments\\.example/', '^https://.*/'])('rejects an untrusted response matcher: %s', (waitForResponse) => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'click', waitForResponse }))
    expect(result.success).toBe(false)
  })

  it('rejects a response matcher on a non-click action', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'input', value: 'value', waitForResponse: '^https://api\\.payments\\.example/v1/complete$' }))
    expect(result.success).toBe(false)
  })

  it('rejects a response timeout without a response matcher', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'click', waitForResponseTimeout: 240000 }))
    expect(result.success).toBe(false)
  })

  it.each([{ waitForResponseMethod: 'POST' }, { waitForResponseStatuses: [200] }, { waitForResponseBody: '"code"' }])('rejects response constraints without a response matcher', (responseConstraint) => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'click', ...responseConstraint }))
    expect(result.success).toBe(false)
  })

  it.each([{ statuses: [] }, { statuses: [99] }, { statuses: [600] }, { statuses: [200.5] }])('rejects invalid response statuses: $statuses', ({ statuses: waitForResponseStatuses }) => {
    const result = WorkflowStepSchema.safeParse(
      step({
        type: 'click',
        waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
        waitForResponseStatuses,
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects an invalid response method', () => {
    const result = WorkflowStepSchema.safeParse(
      step({
        type: 'click',
        waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
        waitForResponseMethod: 'TRACE',
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects an invalid response body matcher', () => {
    const result = WorkflowStepSchema.safeParse(
      step({
        type: 'click',
        waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods$',
        waitForResponseBody: '[',
      }),
    )
    expect(result.success).toBe(false)
  })

  it.each([0, -1, 1.5, 300001])('rejects an invalid post-action delay: %s', (postActionDelay) => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'click', postActionDelay }))
    expect(result.success).toBe(false)
  })
})
