import type { Page } from 'puppeteer'
import type { PuppeteerAction, PuppeteerLocatorAction, PuppeteerWorkflow } from 'src/types/puppeteer'
import type { WorkflowActionType, WorkflowDefinition, WorkflowStep, WorkflowWaitForDefinition } from 'src/types/workflow'

export function workflowDefinitionToPuppeteerWorkflow(page: Page, workflowDefinition: WorkflowDefinition): PuppeteerWorkflow {
  return {
    startingUrl: workflowDefinition.startingPoint,
    locatorActions: stepsToPuppeteerLocatorAction(page, workflowDefinition.steps),
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
  }
}

function stepsToPuppeteerLocatorAction(page: Page, steps: WorkflowStep[]): PuppeteerLocatorAction[] {
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
