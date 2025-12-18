import { z } from 'zod'

import { createMatcher } from '../matcher/matcher-factory'
import { OrMatcher } from '../matcher/or-matcher'
import type { RawTargetDetection, RawTargetInventory } from '../target/raw'
import { SHA256HashSchema } from '../zod'
import { MatcherConfigSchema } from './matcher-config-schema'
import type { AlertDestination, AlertDetection, AlertInventory, AuthorizeWithConfig, InventoryAlert, InventoryAuthorisationInfo, InventoryScriptHashInfo } from './model'
import type { RawAuthorizeWithConfig, RawInventory, RawInventoryHeaderInfo, RawInventoryScriptInfo, RawInventoryTarget } from './raw'

export const AlertDestinationSchema: z.ZodType<AlertDestination> = z.object({
  destination: z.string().min(1, 'Alert destination cannot be empty'),
})

export const AlertInventorySchema: z.ZodType<AlertInventory> = z.object({
  newScriptIdentified: AlertDestinationSchema,
  newHeaderIdentified: AlertDestinationSchema,
})

export const AlertDetectionSchema: z.ZodType<AlertDetection> = z.object({
  newScriptDetected: AlertDestinationSchema,
  scriptMismatchDetected: AlertDestinationSchema,
  newHeaderDetected: AlertDestinationSchema,
})

export const InventoryAlertSchema: z.ZodType<InventoryAlert> = z.object({
  inventory: AlertInventorySchema,
  detection: AlertDetectionSchema,
  successNotification: AlertDestinationSchema,
})

/**
 * Base schema for a Target.
 * This is used to build the more specific target types.
 * Corresponds to `Target`.
 */
const TargetSchema = z.object({
  type: z.enum(['inventory', 'detection']),
  name: z.string().optional(),
  url: z.url(),
})

/**
 * Schema for an Inventory Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetInventory`.
 */
export const RawTargetInventorySchema = TargetSchema.extend({
  type: z.literal('inventory'),
  workflow: z.string(),
}) satisfies z.ZodType<RawTargetInventory>

/**
 * Schema for a Detection Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetDetection`.
 */
export const RawTargetDetectionSchema = TargetSchema.extend({
  type: z.literal('detection'),
  workflow: z.string(),
}) satisfies z.ZodType<RawTargetDetection>

/**
 * Schema for script authorisation details.
 * Corresponds to `InventoryAuthorisationInfo`.
 */
export const InventoryAuthorisationInfoSchema: z.ZodType<InventoryAuthorisationInfo> = z.object({
  description: z.string(),
  authorised: z.boolean(),
  date: z.coerce.date(),
})

/**
 * Schema for a script hash and its timestamp.
 * Corresponds to `InventoryScriptHashInfo`.
 */
export const InventoryScriptHashInfoSchema: z.ZodType<InventoryScriptHashInfo> = z.object({
  timestamp: z.coerce.date(),
  hash: SHA256HashSchema,
})

/**
 * Schema for authorization info in raw (JSON-serializable) format.
 * Used for nested authorization metadata within RawAuthorizeWithConfig.
 */
export const InventoryAuthorisationInfoRawSchema = z.object({
  description: z.string().min(1),
  authorised: z.boolean(),
  date: z.string().datetime(),
})

/**
 * Schema for the composite authorization structure in raw (JSON-serializable) format.
 * Combines matcher configuration with authorization metadata as siblings.
 *
 * Supports two syntaxes:
 * 1. Single matcher: { nameMatcher: "...", authorisationInfo: {...} }
 * 2. Array syntax (FR-006): [{ contentMatcher: "...", authorisationInfo: {...} }, { contentMatcher: "...", authorisationInfo: {...} }]
 *    - Array syntax is syntactic sugar for OrMatcher
 *    - Each array element must have its own authorisationInfo
 *    - Automatically converted to OrMatcher during inventory loading
 *
 * Corresponds to `RawAuthorizeWithConfig`.
 */
export const RawAuthorizeWithConfigSchema = z.union([
  // Single matcher (existing)
  z.intersection(
    MatcherConfigSchema,
    z.object({
      authorisationInfo: InventoryAuthorisationInfoRawSchema,
    }),
  ),

  // Array of matchers (NEW - syntactic sugar for OR, FR-006)
  // Each element is a matcher config with its own authorisationInfo
  z
    .array(
      z.intersection(
        MatcherConfigSchema,
        z.object({
          authorisationInfo: InventoryAuthorisationInfoRawSchema,
        }),
      ),
    )
    .min(1, 'authoriseWith array must contain at least 1 matcher'),
])

/**
 * Schema for information about an inventory script.
 * Corresponds to `RawInventoryScriptInfo`.
 *
 * Updated schema (Phase 3):
 * - Replaces nameMatcher/contentMatcher/hashes with identifyWith/authoriseWith
 * - authoriseWith uses RawAuthorizeWithConfigSchema (matcher config + authorization metadata)
 * - Old schema format is rejected (no backward compatibility per clarification Q4)
 */
export const RawInventoryScriptInfoSchema: z.ZodType<RawInventoryScriptInfo> = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema,
})

/**
 * Schema for the inventory target, including its workflow.
 * Corresponds to `RawInventoryTarget`.
 */
export const RawInventoryTargetSchema: z.ZodType<RawInventoryTarget> = z.object({
  inventory: RawTargetInventorySchema,
  detection: RawTargetDetectionSchema,
})

/**
 * Schema for information about an inventory header.
 * Corresponds to `RawInventoryHeaderInfo`.
 *
 * Updated schema (Phase 5 - US3):
 * - Uses identifyWith/authoriseWith matcher-based structure (aligned with scripts)
 * - authoriseWith uses RawAuthorizeWithConfigSchema (matcher config + authorization metadata)
 * - Replaces old nameMatcher/contentMatcher RegExp structure
 */
export const RawInventoryHeaderInfoSchema: z.ZodType<RawInventoryHeaderInfo> = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema,
})

/**
 * Schema for the complete inventory.
 * This is the top-level schema.
 * Corresponds to `RawInventory`.
 */
export const RawInventorySchema: z.ZodType<RawInventory> = z.object({
  target: RawInventoryTargetSchema,
  alerts: InventoryAlertSchema,
  scripts: z.array(RawInventoryScriptInfoSchema),
  headers: z.array(RawInventoryHeaderInfoSchema),
})

/**
 * Processes RawAuthorizeWithConfig to convert array syntax to OrMatcher.
 *
 * Handles two cases:
 * 1. Single matcher: Returns AuthorizeWithConfig with matcher and authorisationInfo
 * 2. Array syntax (FR-006): Converts array to OrMatcher automatically
 *    - Each array element becomes a child matcher with its own authorisationInfo preserved
 *    - AuthorisationMatcher design ensures metadata is preserved exactly as specified
 *    - Uses first element's authorisationInfo as the top-level authorization metadata
 *
 * @param rawConfig - Raw authorization configuration (single matcher or array)
 * @returns AuthorizeWithConfig with Matcher instance(s)
 */
export function processAuthorizeWith(rawConfig: RawAuthorizeWithConfig): AuthorizeWithConfig {
  if (Array.isArray(rawConfig)) {
    // Array syntax: Convert to OrMatcher (FR-006)
    // Each array element must have authorisationInfo (validated by Zod schema)
    //
    // With AuthorisationMatcher design, each child preserves its own authorisationInfo
    // The OrMatcher itself does NOT have authorisationInfo (to preserve array syntax on serialization)
    const children = rawConfig.map((element) => createMatcher(element as any))

    // Use first element's authorisationInfo as the AuthorizeWithConfig's authorisationInfo
    // This is separate from the matcher's authorisationInfo
    const firstElementInfo = rawConfig[0].authorisationInfo

    return {
      matcher: new OrMatcher(children), // No authorisationInfo on the matcher itself
      authorisationInfo: {
        description: firstElementInfo.description,
        authorised: firstElementInfo.authorised,
        date: new Date(firstElementInfo.date),
      },
    }
  } else {
    // Single matcher (existing path)
    const { authorisationInfo, ...matcherConfig } = rawConfig

    return {
      matcher: createMatcher(matcherConfig),
      authorisationInfo: {
        description: authorisationInfo.description,
        authorised: authorisationInfo.authorised,
        date: new Date(authorisationInfo.date),
      },
    }
  }
}
