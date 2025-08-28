import { z } from 'zod'
import type { WorkflowActionType, WorkflowDefinition, WorkflowStep, WorkflowWaitForDefinition } from '../workflow'

// Schema for WorkflowWaitForDefinition
export const WorkflowWaitForDefinitionSchema: z.ZodType<WorkflowWaitForDefinition> = z.object({
  type: z.enum(['div', 'button', 'input', 'href', 'h2', 'h3']),
  identifier: z.string(),
})

// We must use z.lazy() because WorkflowStep and WorkflowActionType refer to each other.
export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.object({
    description: z.string(),
    waitFor: z.array(WorkflowWaitForDefinitionSchema),
    action: z.object({
      type: z.enum(['click', 'input', 'escape', 'navigate', 'clickPopup']),
      value: z.string().optional(),
      waitForNavigation: z.literal(true).optional(),
      // This is the recursive part, referring back to workflowStepSchema
      steps: z.array(WorkflowStepSchema).optional(),
    }) satisfies z.ZodType<WorkflowActionType>, // Ensures this object matches the Action type
  }),
)

// Schema for WorkflowDefinition
export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  steps: z.array(WorkflowStepSchema),
})
