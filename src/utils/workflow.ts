import type { Page } from 'puppeteer'
import type { PuppeteerAction, PuppeteerLocatorAction, PuppeteerWorkflow } from '../types/puppeteer'
import type { Workflow, WorkflowActionType, WorkflowStep, WorkflowWaitForDefinition } from '../types/workflow'
import type { Target } from '../types/target'
import { getWorkflowDefinitionFromFile } from './file'
import { WORKFLOW_PATH } from './constants'

export async function getWorkflowFromFile(fileName: string): Promise<Workflow> {
  const workflowFilePath = `${WORKFLOW_PATH}/${fileName}`
  const workflowDefinition = await getWorkflowDefinitionFromFile(workflowFilePath)

  return {
    fileName: fileName,
    definition: workflowDefinition,
  }
}

export function getPuppeteerWorkflowFromTarget(page: Page, target: Target): PuppeteerWorkflow {
  return {
    target: target,
    locatorActions: stepsToPuppeteerLocatorAction(page, target.workflow.definition.steps),
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

export function stepsToPuppeteerLocatorAction(page: Page, steps: WorkflowStep[]): PuppeteerLocatorAction[] {
  return steps.map((step) => {
    const querySelector = waitForToQuerySelector(step.waitFor)
    return {
      description: step.description,
      querySelector: querySelector,
      locator: page.locator(querySelector),
      action: actionToPuppeteerAction(step.action),
    }
  })
}
