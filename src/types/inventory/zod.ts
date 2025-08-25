import type { TargetDetection, TargetInventory } from '../target'
import type { InventoryScriptAuthorisationInfo, InventoryScriptHashInfo, InventoryScriptInfo } from './model'
import type { RawInventory, RawInventoryTarget } from './raw'

import { SHA256HashSchema } from '../zod'
import { z } from 'zod'

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
 * Corresponds to `TargetInventory`.
 */
export const TargetInventorySchema: z.ZodType<TargetInventory> = TargetSchema.extend({
  type: z.literal('inventory'),
})

/**
 * Schema for a Detection Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `TargetDetection`.
 */
export const TargetDetectionSchema: z.ZodType<TargetDetection> = TargetSchema.extend({
  type: z.literal('detection'),
})

/**
 * Schema for script authorisation details.
 * Corresponds to `InventoryScriptAuthorisationInfo`.
 */
export const InventoryScriptAuthorisationInfoSchema: z.ZodType<InventoryScriptAuthorisationInfo> = z.object({
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
 * Corresponds to `InventoryScriptInfo`.
 */
export const InventoryScriptInfoSchema: z.ZodType<InventoryScriptInfo> = z.object({
  matcher: z.preprocess(
    (matcherValue) => {
      return RegExp(matcherValue as string)
    },
    z.instanceof(RegExp, { message: 'Invalid RegExp' }),
  ),
  hashes: z.array(InventoryScriptHashInfoSchema),
  authorisationInfo: InventoryScriptAuthorisationInfoSchema,
})

/**
 * Schema for the inventory target, including its workflow.
 * Corresponds to `RawInventoryTarget`.
 */
export const RawInventoryTargetSchema: z.ZodType<RawInventoryTarget> = z.object({
  inventory: TargetInventorySchema,
  detection: TargetDetectionSchema,
  workflow: z.string(),
})

/**
 * Schema for the complete inventory.
 * This is the top-level schema.
 * Corresponds to `RawInventory`.
 */
export const RawInventorySchema: z.ZodType<RawInventory> = z.object({
  target: RawInventoryTargetSchema,
  scripts: z.array(InventoryScriptInfoSchema),
})
