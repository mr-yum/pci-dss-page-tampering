import { z } from 'zod'

import type { RawTargetDetection, RawTargetInventory } from '../target/raw'
import { SHA256HashSchema } from '../zod'
import { MatcherConfigSchema } from './matcher-config-schema'
import type { AlertDestination, AlertDetection, AlertInventory, InventoryAlert, InventoryAuthorisationInfo, InventoryScriptHashInfo } from './model'
import type { RawInventory, RawInventoryHeaderInfo, RawInventoryScriptInfo, RawInventoryTarget } from './raw'

export const AlertDestinationSchema: z.ZodType<AlertDestination> = z.object({
  destination: z.string(),
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
})

/**
 * Base schema for a Target.
 * This is used to build the more specific target types.
 * Corresponds to `Target`.
 */
const TargetSchema = z.object({
  type: z.enum(['inventory', 'detection']),
  url: z.url(),
})

/**
 * Schema for an Inventory Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetInventory`.
 */
export const RawTargetInventorySchema: z.ZodType<RawTargetInventory> = TargetSchema.extend({
  type: z.literal('inventory'),
  workflow: z.string(),
})

/**
 * Schema for a Detection Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetDetection`.
 */
export const RawTargetDetectionSchema: z.ZodType<RawTargetDetection> = TargetSchema.extend({
  type: z.literal('detection'),
  workflow: z.string(),
})

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
 * Schema for information about an inventory script.
 * Corresponds to `RawInventoryScriptInfo`.
 *
 * Updated schema (Phase 3):
 * - Replaces nameMatcher/contentMatcher/hashes with identifyWith/authoriseWith
 * - Each field uses MatcherConfig union type (nameMatcher | contentMatcher | hashes)
 * - Old schema format is rejected (no backward compatibility per clarification Q4)
 */
export const RawInventoryScriptInfoSchema: z.ZodType<RawInventoryScriptInfo> = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: MatcherConfigSchema,
  authorisationInfo: InventoryAuthorisationInfoSchema,
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
 * - Each field uses MatcherConfig union type (typically headerNameMatcher | contentMatcher)
 * - Replaces old nameMatcher/contentMatcher RegExp structure
 */
export const RawInventoryHeaderInfoSchema: z.ZodType<RawInventoryHeaderInfo> = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: MatcherConfigSchema,
  authorisationInfo: InventoryAuthorisationInfoSchema,
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
