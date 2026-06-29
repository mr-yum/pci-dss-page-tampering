/**
 * Header Inventory Entry Schema
 *
 * Defines Zod schema for header inventory entries with matcher-based identification and authorization.
 * Extends the matcher architecture from scripts to headers with domain-appropriate matching semantics.
 *
 * @see ../../../specs/002-continuing-our-refactor/data-model.md for BR-3, BR-4, BR-5
 * @see ../../../specs/002-continuing-our-refactor/spec.md for FR-010a
 */

import { z } from 'zod'

import type { Matcher } from '../matcher/matcher.interface.js'
import { createMatcher } from '../matcher/matcher-factory.js'
import { MatcherConfigSchema } from './matcher-config-schema.js'

/**
 * Zod schema for authorization metadata (shared with script entries)
 */
const InventoryAuthorisationInfoSchema = z.object({
  description: z.string(),
  authorised: z.boolean(),
  date: z.coerce.date(),
})

/**
 * Zod schema for header inventory entry (T059).
 *
 * Structure (per FR-010a):
 * - identifyWith: MatcherConfig for header name identification (typically HeaderNameMatcher)
 * - authoriseWith: MatcherConfig for header value authorization (typically ContentMatcher)
 * - authorisationInfo: Metadata about the header's authorization status
 *
 * Recommended Matcher Combinations:
 * - identifyWith: { headerNameMatcher: "^content-type$" } (case-insensitive name matching)
 * - authoriseWith: { contentMatcher: "^application/json$" } (case-sensitive value matching)
 *
 * Edge Cases:
 * - Empty values are valid per BR-5 (ContentMatcher decides authorization)
 * - First-match-wins applies when multiple entries could match (BR-2)
 * - Authorization requires both authorisationInfo.authorised=true AND authoriseWith.authorize()=true
 *
 * Example:
 * ```json
 * {
 *   "identifyWith": { "headerNameMatcher": "^x-frame-options$" },
 *   "authoriseWith": { "contentMatcher": "^(DENY|SAMEORIGIN)$" },
 *   "authorisationInfo": {
 *     "description": "Prevents clickjacking attacks",
 *     "authorised": true,
 *     "date": "2024-01-01"
 *   }
 * }
 * ```
 */
export const InventoryHeaderInfoSchema = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: MatcherConfigSchema,
  authorisationInfo: InventoryAuthorisationInfoSchema,
})

/**
 * TypeScript type inferred from Zod schema (T060).
 * Raw structure before matcher instantiation.
 *
 * Note: This is primarily for Zod schema validation. The canonical RawInventoryHeaderInfo
 * type is defined in ./raw.ts to align with the overall inventory structure.
 */
type ZodRawInventoryHeaderInfo = z.infer<typeof InventoryHeaderInfoSchema>

/**
 * Helper function to convert raw inventory header to processed type with Matcher instances.
 *
 * @param raw - Raw header entry from JSON (validated by Zod schema)
 * @returns Processed entry with Matcher instances
 *
 * Example:
 * ```typescript
 * const raw = {
 *   identifyWith: { headerNameMatcher: "^content-type$" },
 *   authoriseWith: { contentMatcher: "^application/json$" },
 *   authorisationInfo: { description: "...", authorised: true, date: new Date() }
 * }
 * const processed = processHeaderEntry(raw)
 * // processed.identifyWith is now a HeaderNameMatcher instance
 * // processed.authoriseWith is now a ContentMatcher instance
 * ```
 */
export function processHeaderEntry(raw: ZodRawInventoryHeaderInfo): {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: {
    description: string
    authorised: boolean
    date: Date
  }
} {
  return {
    identifyWith: createMatcher(raw.identifyWith),
    authoriseWith: createMatcher(raw.authoriseWith),
    authorisationInfo: raw.authorisationInfo,
  }
}
