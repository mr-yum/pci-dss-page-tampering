import { CliArgsSchema } from './cli.js'

describe('CliArgsSchema', () => {
  const baseArgs = {
    repo: 'https://github.com/org/inventory',
    gitToken: 'ghp_token',
  }

  describe('totpSeed', () => {
    it('defaults to an empty array when omitted', () => {
      const result = CliArgsSchema.parse(baseArgs)
      expect(result.totpSeed).toEqual([])
    })

    it('accepts valid name=base32-seed entries', () => {
      const result = CliArgsSchema.parse({ ...baseArgs, totpSeed: ['checkout=GEZDGNBVGY3TQOJQ', 'admin=mzxw 6ytb-oi'] })
      expect(result.totpSeed).toHaveLength(2)
    })

    it('rejects entries without a name=seed separator', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, totpSeed: ['GEZDGNBVGY3TQOJQ'] })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('must use the format <name>=<base32-seed>')
      }
    })

    it('rejects entries with an empty name or empty seed', () => {
      expect(CliArgsSchema.safeParse({ ...baseArgs, totpSeed: ['=GEZDGNBVGY3TQOJQ'] }).success).toBe(false)
      expect(CliArgsSchema.safeParse({ ...baseArgs, totpSeed: ['checkout='] }).success).toBe(false)
    })

    it('rejects duplicate seed names', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, totpSeed: ['checkout=GEZDGNBVGY3TQOJQ', 'checkout=MZXW6YTBOI'] })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toBe("Duplicate TOTP seed name 'checkout'")
      }
    })

    it('rejects seeds that are not valid base32 without echoing the seed value', () => {
      const invalidSeed = 'not-valid-base32-189!'
      const result = CliArgsSchema.safeParse({ ...baseArgs, totpSeed: [`checkout=${invalidSeed}`] })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message).join('\n')
        expect(messages).toContain("TOTP seed 'checkout' is invalid")
        expect(messages).not.toContain(invalidSeed)
      }
    })
  })

  describe('rumQueueUrl (--mode rum-compare, feature 011)', () => {
    it('accepts rum-compare mode with an https:// queue URL', () => {
      const result = CliArgsSchema.parse({ ...baseArgs, mode: 'rum-compare', rumQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/novel-observations' })
      expect(result.mode).toBe('rum-compare')
      expect(result.rumQueueUrl).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/novel-observations')
    })

    it('accepts rum-compare mode with a file:// queue URL for local development', () => {
      const result = CliArgsSchema.parse({ ...baseArgs, mode: 'rum-compare', rumQueueUrl: 'file:///tmp/queue' })
      expect(result.rumQueueUrl).toBe('file:///tmp/queue')
    })

    it('requires --rum-queue-url when mode is rum-compare', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, mode: 'rum-compare' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.path).toEqual(['rumQueueUrl'])
        expect(result.error.issues[0]!.message).toContain('--rum-queue-url is required with --mode rum-compare')
      }
    })

    it('rejects an empty --rum-queue-url in rum-compare mode', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, mode: 'rum-compare', rumQueueUrl: '   ' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('--rum-queue-url is required with --mode rum-compare')
      }
    })

    it('rejects unsupported queue URL schemes', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, mode: 'rum-compare', rumQueueUrl: 'sqs://queue' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.message).toContain('https:// SQS queue URL or a file:// directory')
      }
    })

    it.each(['inventory', 'detection', 'all', 'validate'] as const)('rejects --rum-queue-url in %s mode', (mode) => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, mode, rumQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/novel-observations' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]!.path).toEqual(['rumQueueUrl'])
        expect(result.error.issues[0]!.message).toBe('--rum-queue-url is only valid with --mode rum-compare')
      }
    })

    it('rejects --rum-queue-url when the mode defaults to all', () => {
      const result = CliArgsSchema.safeParse({ ...baseArgs, rumQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/novel-observations' })
      expect(result.success).toBe(false)
    })
  })
})
