import { z } from 'zod'

import type { SHA256Hash } from './hash'

/**
 * Schema for a SHA256 hash object.
 * Corresponds to `SHA256Hash`.
 */
export const SHA256HashSchema: z.ZodType<SHA256Hash> = z.object({
  value: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA256 hash format'),
})
