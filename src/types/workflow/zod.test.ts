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
})
