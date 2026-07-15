import { z } from 'zod'

import type { WorkflowActionType, WorkflowDefinition, WorkflowStep, WorkflowWaitForDefinition } from '../workflow.js'

// Schema for WorkflowWaitForDefinition
export const WorkflowWaitForDefinitionSchema: z.ZodType<WorkflowWaitForDefinition> = z.object({
  type: z.enum(['div', 'button', 'input', 'href', 'h2', 'h3', 'span', 'testid', 'aria']),
  identifier: z.string(),
})

// We must use z.lazy() because WorkflowStep and WorkflowActionType refer to each other.
export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.object({
    description: z.string(),
    waitFor: z.array(WorkflowWaitForDefinitionSchema),
    action: z
      .object({
        type: z.enum(['click', 'input', 'escape', 'navigate', 'clickPopup', 'totp']),
        value: z.string().optional(),
        seedRef: z.string().optional(),
        delay: z.number().optional(),
        waitForNavigation: z.literal(true).optional(),
        // This is the recursive part, referring back to workflowStepSchema
        steps: z.array(WorkflowStepSchema).optional(),
      })
      .superRefine((action, ctx) => {
        // Fail-secure: a totp action without a seed reference cannot be
        // executed, so reject it at deserialization (and in --mode validate).
        if (action.type === 'totp' && (action.seedRef === undefined || action.seedRef.trim() === '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['seedRef'],
            message: "Workflow actions of type 'totp' require a non-empty seedRef naming a seed passed via --totp-seed",
          })
        }
      }) satisfies z.ZodType<WorkflowActionType>, // Ensures this object matches the Action type
  }),
)

// Schema for WorkflowDefinition
export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  steps: z.array(WorkflowStepSchema),
})
