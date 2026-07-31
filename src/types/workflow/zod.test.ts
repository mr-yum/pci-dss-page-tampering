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

  it('accepts an anchored HTTPS response matcher on a click action', () => {
    const result = WorkflowStepSchema.safeParse(step({ type: 'click', waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods(?:\\?.*)?$' }))
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
})
