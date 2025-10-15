/**
 * MatcherConfig Zod Schema
 *
 * Validates matcher configuration from inventory JSON files.
 * Supports three matcher types: nameMatcher, contentMatcher, and hashes.
 *
 * @see ../matcher/matcher-factory.ts for matcher creation from validated config
 * @see ../../../specs/001-refactor-script-identification/research.md R2 and R6 for validation strategy
 */

import { z } from 'zod'
import { SHA256HashSchema } from '../zod'

/**
 * Schema for a script hash and its timestamp.
 * Inline definition to avoid circular dependency with zod.ts
 */
const InventoryScriptHashInfoSchema = z.object({
  timestamp: z.coerce.date(),
  hash: SHA256HashSchema,
})

/**
 * Zod schema for MatcherConfig union type.
 *
 * Validates:
 * - Exactly one variant must be present (union enforces this)
 * - Regex patterns are syntactically valid (custom refinement)
 * - Hash arrays have at least 1 element
 *
 * Error messages include:
 * - Which field has the invalid regex (nameMatcher vs contentMatcher)
 * - The invalid pattern itself
 * - JavaScript RegExp error message
 * - Suggestion to check bracket matching and escape sequences
 */
export const MatcherConfigSchema = z
  .union([
    z.object({ nameMatcher: z.string().min(1, 'nameMatcher must not be empty') }),
    z.object({ contentMatcher: z.string().min(1, 'contentMatcher must not be empty') }),
    z.object({ hashes: z.array(InventoryScriptHashInfoSchema).min(1, 'hashes array must contain at least 1 hash') }),
  ])
  .superRefine((val, ctx) => {
    // Validate regex syntax for nameMatcher
    if ('nameMatcher' in val) {
      try {
        new RegExp(val.nameMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in nameMatcher: "${val.nameMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['nameMatcher'],
        })
      }
    }

    // Validate regex syntax for contentMatcher
    if ('contentMatcher' in val) {
      try {
        new RegExp(val.contentMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in contentMatcher: "${val.contentMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['contentMatcher'],
        })
      }
    }
  })

/**
 * TypeScript type inferred from Zod schema.
 * Use this type for raw JSON data before matcher creation.
 */
export type RawMatcherConfig = z.infer<typeof MatcherConfigSchema>
