import type { PuppeteerAction, PuppeteerLocatorAction, PuppeteerWorkflow } from '../types/puppeteer.js'
import type { Target } from '../types/target.js'
import type { Workflow, WorkflowActionType, WorkflowStep, WorkflowWaitForDefinition } from '../types/workflow.js'
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
  return {
    target: target,
    locatorActions: stepsToPuppeteerLocatorAction(target.workflow.definition.steps),
  }
}

function waitForDefinitionToQuerySelector(waitForDefinition: WorkflowWaitForDefinition): string {
  switch (waitForDefinition.type) {
    case 'div':
      return `div.${waitForDefinition.identifier}`
    case 'button':
      return `button:enabled ::-p-text(${waitForDefinition.identifier})`
    case 'input':
      return `input[name="${waitForDefinition.identifier}"]`
    case 'href':
      return `a[href$="${waitForDefinition.identifier}"]`
    case 'h2':
      return `h2 ::-p-text(${waitForDefinition.identifier})`
    case 'h3':
      return `h3 ::-p-text(${waitForDefinition.identifier})`
    case 'span':
      return `span ::-p-text(${waitForDefinition.identifier})`
    case 'testid':
      return `[data-testid="${waitForDefinition.identifier}"]`
    case 'aria':
      return `[aria-label="${waitForDefinition.identifier}"]`
  }
}

function waitForToQuerySelector(waitFor: WorkflowWaitForDefinition[]): string {
  return waitFor.map(waitForDefinitionToQuerySelector).join(' ')
}

function actionToPuppeteerAction(action: WorkflowActionType): PuppeteerAction {
  switch (action.type) {
    case 'click': {
      return {
        type: 'click',
        waitForNavigation: action.waitForNavigation ?? false,
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
      frameUrl: step.frameUrl,
      action: actionToPuppeteerAction(step.action),
      delay: step.action.delay ?? 0,
    }
  })
}
