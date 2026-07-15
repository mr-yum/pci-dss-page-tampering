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
})
