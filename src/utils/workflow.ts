import type { PuppeteerAction, PuppeteerLocatorAction, PuppeteerWorkflow } from '../types/puppeteer.js'
import type { Target } from '../types/target.js'
import type { Workflow, WorkflowActionType, WorkflowStep, WorkflowWaitForDefinition } from '../types/workflow.js'
import {
  FrameUrlSchema,
  PostActionDelaySchema,
  WaitForResponseBodySchema,
  WaitForResponseMethodSchema,
  WaitForResponseSchema,
  WaitForResponseStatusesSchema,
  WaitForResponseTimeoutSchema,
  WorkflowRetryBackoffSchema,
  WorkflowRetryMaxAttemptsSchema,
} from '../types/workflow/zod.js'
import { WORKFLOW_PATH } from './constants.js'
import { getWorkflowDefinitionFromFile } from './file.js'

export async function getWorkflowFromFile(fileName: string): Promise<Workflow> {
  const workflowFilePath = `${WORKFLOW_PATH}/${fileName}`
  const workflowDefinition = await getWorkflowDefinitionFromFile(workflowFilePath)

  return {
    fileName: fileName,
    definition: workflowDefinition,
  }
}

/**
 * Collect every TOTP seed name referenced by the given steps, recursing into
 * clickPopup sub-steps. Lets callers fail fast — before launching a browser
 * session — when a workflow references a seed not supplied via --totp-seed.
 */
export function collectTotpSeedRefs(steps: WorkflowStep[]): Set<string> {
  const seedRefs = new Set<string>()
  for (const step of steps) {
    const trimmedSeedRef = step.action.seedRef?.trim()
    if (step.action.type === 'totp' && trimmedSeedRef) {
      seedRefs.add(trimmedSeedRef)
    }
    if (step.action.steps) {
      collectTotpSeedRefs(step.action.steps).forEach((seedRef) => seedRefs.add(seedRef))
    }
  }
  return seedRefs
}

export function getPuppeteerWorkflowFromTarget(target: Target): PuppeteerWorkflow {
  const retry = target.workflow.definition.retry
  return {
    target: target,
    locatorActions: stepsToPuppeteerLocatorAction(target.workflow.definition.steps),
    retry: {
      maxAttempts: WorkflowRetryMaxAttemptsSchema.parse(retry?.maxAttempts ?? 1),
      backoffMs: WorkflowRetryBackoffSchema.parse(retry?.backoffMs ?? 1000),
    },
  }
}

/**
 * Escape an inventory-supplied identifier for use inside a double-quoted CSS
 * attribute value. An unescaped `"` ends the string early and yields an invalid
 * selector; an unescaped `\` silently changes which element the selector
 * decodes to; a raw line break is not permitted in a CSS string at all. All
 * three are author errors rather than attacks -- identifiers come from the
 * PR-reviewed inventory repo -- but a selector that quietly matches the wrong
 * element is exactly the failure this tool must not have.
 *
 * Line breaks use full six-digit hex escapes so no whitespace terminator is
 * needed and a following hex digit cannot be absorbed into the escape.
 */
function escapeCssStringValue(identifier: string): string {
  return identifier.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\00000a').replaceAll('\r', '\\00000d').replaceAll('\f', '\\00000c')
}

function waitForDefinitionToQuerySelector(waitForDefinition: WorkflowWaitForDefinition): string {
  const attributeValue = escapeCssStringValue(waitForDefinition.identifier)
  switch (waitForDefinition.type) {
    case 'div':
      return `div.${waitForDefinition.identifier}`
    case 'button':
      return `button:enabled ::-p-text(${waitForDefinition.identifier})`
    case 'input':
      return `input[name="${attributeValue}"]`
    case 'href':
      return `a[href$="${attributeValue}"]`
    case 'h2':
      return `h2 ::-p-text(${waitForDefinition.identifier})`
    case 'h3':
      return `h3 ::-p-text(${waitForDefinition.identifier})`
    case 'span':
      return `span ::-p-text(${waitForDefinition.identifier})`
    case 'testid':
      return `[data-testid="${attributeValue}"]`
    case 'aria':
      return `[aria-label="${attributeValue}"]`
    // Attribute form rather than `#id`: hosted payment iframes routinely use ids
    // containing characters that are not valid in a CSS id selector without
    // escaping, and this keeps the mapping consistent with testid/aria.
    case 'id':
      return `[id="${attributeValue}"]`
  }
}

function waitForToQuerySelector(waitFor: WorkflowWaitForDefinition[]): string {
  return waitFor.map(waitForDefinitionToQuerySelector).join(' ')
}

function actionToPuppeteerAction(action: WorkflowActionType): PuppeteerAction {
  // Deserialized workflows are protected by Zod; retain the same fail-secure
  // behaviour for JavaScript callers or TypeScript casts that bypass it.
  const hasResponseOptions =
    action.waitForResponse !== undefined || action.waitForResponseTimeout !== undefined || action.waitForResponseMethod !== undefined || action.waitForResponseStatuses !== undefined || action.waitForResponseBody !== undefined
  if (action.type !== 'click' && hasResponseOptions) {
    throw new Error("Response waiting options are only supported for workflow actions of type 'click'")
  }
  if (
    action.type === 'click' &&
    action.waitForResponse === undefined &&
    (action.waitForResponseTimeout !== undefined || action.waitForResponseMethod !== undefined || action.waitForResponseStatuses !== undefined || action.waitForResponseBody !== undefined)
  ) {
    throw new Error('Response waiting options require waitForResponse')
  }

  switch (action.type) {
    case 'click': {
      return {
        type: 'click',
        waitForNavigation: action.waitForNavigation ?? false,
        waitForResponse: action.waitForResponse === undefined ? undefined : WaitForResponseSchema.parse(action.waitForResponse),
        ...(action.waitForResponseTimeout === undefined ? {} : { waitForResponseTimeout: WaitForResponseTimeoutSchema.parse(action.waitForResponseTimeout) }),
        ...(action.waitForResponseMethod === undefined ? {} : { waitForResponseMethod: WaitForResponseMethodSchema.parse(action.waitForResponseMethod) }),
        ...(action.waitForResponseStatuses === undefined ? {} : { waitForResponseStatuses: WaitForResponseStatusesSchema.parse(action.waitForResponseStatuses) }),
        ...(action.waitForResponseBody === undefined ? {} : { waitForResponseBody: WaitForResponseBodySchema.parse(action.waitForResponseBody) }),
      }
    }
    case 'input': {
      return {
        type: 'input',
        value: action.value!,
      }
    }
    case 'totp': {
      // The Zod schema guarantees a non-empty seedRef for deserialized
      // workflows; this guard covers programmatically-built definitions that
      // bypass it. Trimmed to match the trimmed --totp-seed names.
      const seedRef = action.seedRef?.trim()
      if (!seedRef) {
        throw new Error("Workflow action of type 'totp' is missing its seedRef")
      }
      return {
        type: 'totp',
        seedRef: seedRef,
      }
    }

    case 'escape': {
      return {
        type: 'escape',
      }
    }
    case 'navigate': {
      return {
        type: 'navigate',
        waitForNavigation: action.waitForNavigation ?? false,
      }
    }
    case 'clickPopup': {
      return {
        type: 'clickPopup',
        waitForNavigation: action.waitForNavigation ?? false,
        steps: action.steps ?? [],
      }
    }
  }
}

export function stepsToPuppeteerLocatorAction(steps: WorkflowStep[]): PuppeteerLocatorAction[] {
  return steps.map((step) => {
    const querySelector = waitForToQuerySelector(step.waitFor)

    return {
      description: step.description,
      querySelector: querySelector,
      frameUrl: step.frameUrl === undefined ? undefined : FrameUrlSchema.parse(step.frameUrl),
      action: actionToPuppeteerAction(step.action),
      delay: step.action.delay ?? 0,
      ...(step.retryBoundary === true ? { retryBoundary: true } : {}),
      ...(step.action.postActionDelay === undefined ? {} : { postActionDelay: PostActionDelaySchema.parse(step.action.postActionDelay) }),
      ...(step.action.reloadOnMissingTarget === true ? { reloadOnMissingTarget: true } : {}),
    }
  })
}
