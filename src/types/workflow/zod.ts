import { z } from 'zod'

import type { WorkflowActionType, WorkflowDefinition, WorkflowStep, WorkflowWaitForDefinition } from '../workflow.js'

function hasTopLevelAlternation(pattern: string): boolean {
  let escaped = false
  let inCharacterClass = false
  let groupDepth = 0

  for (const character of pattern) {
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '[') {
      inCharacterClass = true
    } else if (character === ']' && inCharacterClass) {
      inCharacterClass = false
    } else if (!inCharacterClass && character === '(') {
      groupDepth += 1
    } else if (!inCharacterClass && character === ')') {
      groupDepth -= 1
    } else if (!inCharacterClass && character === '|' && groupDepth === 0) {
      return true
    }
  }

  return false
}

// Schema for WorkflowWaitForDefinition
export const WorkflowWaitForDefinitionSchema: z.ZodType<WorkflowWaitForDefinition> = z.object({
  type: z.enum(['div', 'button', 'input', 'href', 'h2', 'h3', 'span', 'testid', 'aria']),
  identifier: z.string(),
})

function trustedHttpsPatternSchema(fieldName: 'frameUrl' | 'waitForResponse') {
  return z
    .string()
    .min(1)
    .refine(
      (pattern) => {
        try {
          new RegExp(pattern)
          return true
        } catch {
          return false
        }
      },
      { message: `${fieldName} must be a valid regular expression` },
    )
    .refine(
      (pattern) => {
        const normalizedPattern = pattern.replaceAll('\\/', '/')
        const authority = /^\^https:\/\/([^/]+)\//.exec(normalizedPattern)?.[1]
        if (authority === undefined) return false

        const authorityParts = /^([A-Za-z0-9-]+(?:\\\.[A-Za-z0-9-]+)+)(?::([1-9][0-9]{0,4}))?$/.exec(authority)
        if (authorityParts === null) return false

        const port = authorityParts[2]
        return port === undefined || Number(port) <= 65535
      },
      { message: `${fieldName} must begin with an anchored, exact HTTPS origin` },
    )
    .refine((pattern) => !hasTopLevelAlternation(pattern), {
      message: `${fieldName} must not use top-level alternation that can escape its trusted origin`,
    })
}

export const FrameUrlSchema = trustedHttpsPatternSchema('frameUrl')
export const WaitForResponseSchema = trustedHttpsPatternSchema('waitForResponse')
export const WaitForResponseTimeoutSchema = z.number().int().positive().max(300000)
export const WaitForResponseMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
export const WaitForResponseStatusesSchema = z.array(z.number().int().min(100).max(599)).min(1)
export const WaitForResponseBodySchema = z
  .string()
  .min(1)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern)
        return true
      } catch {
        return false
      }
    },
    { message: 'waitForResponseBody must be a valid regular expression' },
  )
export const PostActionDelaySchema = z.number().int().positive().max(300000)
export const WorkflowRetryMaxAttemptsSchema = z.number().int().min(1).max(3)
export const WorkflowRetryBackoffSchema = z.number().int().nonnegative().max(30000)

// We must use z.lazy() because WorkflowStep and WorkflowActionType refer to each other.
export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z
    .object({
      description: z.string(),
      retryBoundary: z.literal(true).optional(),
      frameUrl: FrameUrlSchema.optional(),
      waitFor: z.array(WorkflowWaitForDefinitionSchema),
      action: z
        .object({
          type: z.enum(['click', 'input', 'escape', 'navigate', 'clickPopup', 'totp']),
          value: z.string().optional(),
          seedRef: z.string().optional(),
          delay: z.number().optional(),
          waitForNavigation: z.literal(true).optional(),
          waitForResponse: WaitForResponseSchema.optional(),
          waitForResponseTimeout: WaitForResponseTimeoutSchema.optional(),
          waitForResponseMethod: WaitForResponseMethodSchema.optional(),
          waitForResponseStatuses: WaitForResponseStatusesSchema.optional(),
          waitForResponseBody: WaitForResponseBodySchema.optional(),
          postActionDelay: PostActionDelaySchema.optional(),
          reloadOnMissingTarget: z.literal(true).optional(),
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
          const hasResponseOptions =
            action.waitForResponse !== undefined || action.waitForResponseTimeout !== undefined || action.waitForResponseMethod !== undefined || action.waitForResponseStatuses !== undefined || action.waitForResponseBody !== undefined
          if (hasResponseOptions && action.type !== 'click') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['waitForResponse'],
              message: "Response waiting options are only supported for workflow actions of type 'click'",
            })
          }
          if (action.waitForResponse === undefined && (action.waitForResponseTimeout !== undefined || action.waitForResponseMethod !== undefined || action.waitForResponseStatuses !== undefined || action.waitForResponseBody !== undefined)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['waitForResponse'],
              message: 'Response waiting options require waitForResponse',
            })
          }
        }) satisfies z.ZodType<WorkflowActionType>, // Ensures this object matches the Action type
    })
    .superRefine((step, ctx) => {
      if (step.action.reloadOnMissingTarget === true && step.frameUrl === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action', 'reloadOnMissingTarget'],
          message: 'reloadOnMissingTarget requires a trusted frameUrl so recovery cannot send input to a redirected top-level page',
        })
      }
    }),
)

// Schema for WorkflowDefinition
export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z.object({
  steps: z.array(WorkflowStepSchema),
  retry: z
    .object({
      maxAttempts: WorkflowRetryMaxAttemptsSchema.optional(),
      backoffMs: WorkflowRetryBackoffSchema.optional(),
    })
    .optional(),
})
