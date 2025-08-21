import { z } from 'zod'
import type { WorkflowActionType, WorkflowDefinition, WorkflowStep, WorkflowWaitForDefinition } from './workflow'
import type { Inventory, InventoryScriptAuthorisationInfo, InventoryScriptHashInfo, InventoryScriptInfo, InventoryTarget } from './inventory'
import type { SHA256Hash } from './hash'
import type { TargetDetection, TargetInventory } from './target'

// --- Zod Schema Definitions ---

/**
 * Schema for a single action to be performed in a workflow step.
 * Corresponds to the `WorkflowActionType` type.
 */
export const WorkflowActionTypeSchema: z.ZodType<WorkflowActionType> = z.object({
  // Use z.enum for a union of string literals
  type: z.enum(['click', 'input', 'escape', 'navigate']),

  // .optional() marks a property as not required
  value: z.string().optional(),

  // For a property that must be `true` if it exists
  waitForNavigation: z.literal(true).optional(),
})

/**
 * Schema for an element to wait for before executing an action.
 * Corresponds to the `WorkflowWaitForDefinition` type.
 */
export const WorkflowWaitForDefinitionSchema: z.ZodType<WorkflowWaitForDefinition> = z.object({
  type: z.enum(['div', 'button', 'input', 'href', 'h2', 'h3']),
  identifier: z.string(),
})

/**
 * Schema for a single step in a workflow.
 * This schema is composed of the smaller schemas defined above.
 * Corresponds to the `WorkflowStep` type.
 */
export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.object({
  description: z.string(),

  // Use z.array() to define an array of a specific schema type
  waitFor: z.array(WorkflowWaitForDefinitionSchema),

  // Reuse the action schema
  action: WorkflowActionTypeSchema,
})

/**
 * Schema for the entire workflow definition.
 * The top-level object containing an array of steps.
 * Corresponds to the `WorkflowDefinition` type.
 */
export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  steps: z.array(WorkflowStepSchema),
})

/**
 * Schema for a SHA256 hash object.
 * Corresponds to `SHA256Hash`.
 */
export const SHA256HashSchema: z.ZodType<SHA256Hash> = z.object({
  value: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA256 hash format'),
})

/**
 * Base schema for a Target.
 * This is used to build the more specific target types.
 * Corresponds to `Target`.
 */
const TargetSchema = z.object({
  type: z.enum(['inventory', 'detection']),
  url: z.string().url(),
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
  date: z.date(),
})

/**
 * Schema for a script hash and its timestamp.
 * Corresponds to `InventoryScriptHashInfo`.
 */
export const InventoryScriptHashInfoSchema: z.ZodType<InventoryScriptHashInfo> = z.object({
  timestamp: z.date(),
  hash: SHA256HashSchema,
})

/**
 * Schema for information about an inventory script.
 * Corresponds to `InventoryScriptInfo`.
 */
export const InventoryScriptInfoSchema: z.ZodType<InventoryScriptInfo> = z.object({
  matcher: z.instanceof(RegExp),
  hashes: z.array(InventoryScriptHashInfoSchema),
  authorisationInfo: InventoryScriptAuthorisationInfoSchema,
})

/**
 * Schema for the inventory target, including its workflow.
 * Corresponds to `InventoryTarget`.
 */
export const InventoryTargetSchema: z.ZodType<InventoryTarget> = z.object({
  inventory: TargetInventorySchema,
  detection: TargetDetectionSchema,
  workflow: z.string(),
})

/**
 * Schema for the complete inventory.
 * This is the top-level schema.
 * Corresponds to `Inventory`.
 */
export const InventorySchema: z.ZodType<Inventory> = z.object({
  target: InventoryTargetSchema,
  scripts: z.array(InventoryScriptInfoSchema),
})
