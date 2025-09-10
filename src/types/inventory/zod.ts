import type { InventoryAuthorisationInfo, InventoryScriptHashInfo } from './model'
import type { RawInventory, RawInventoryHeaderInfo, RawInventoryScriptInfo, RawInventoryTarget } from './raw'

import { SHA256HashSchema } from '../zod'
import { z } from 'zod'
import type { RawTargetDetection, RawTargetInventory } from '../target/raw'

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
 */
export const RawInventoryScriptInfoSchema: z.ZodType<RawInventoryScriptInfo> = z.object({
  nameMatcher: z.string(),
  contentMatcher: z.optional(z.string()),
  hashes: z.array(InventoryScriptHashInfoSchema),
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

export const RawInventoryHeaderInfoSchema: z.ZodType<RawInventoryHeaderInfo> = z.object({
  nameMatcher: z.string(),
  contentMatcher: z.string(),
  authorisationInfo: InventoryAuthorisationInfoSchema,
})

/**
 * Schema for the complete inventory.
 * This is the top-level schema.
 * Corresponds to `RawInventory`.
 */
export const RawInventorySchema: z.ZodType<RawInventory> = z.object({
  target: RawInventoryTargetSchema,
  scripts: z.array(RawInventoryScriptInfoSchema),
  headers: z.array(RawInventoryHeaderInfoSchema),
})
