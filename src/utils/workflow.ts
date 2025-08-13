import type { Page } from 'puppeteer'
import type { PuppeteerAction, PuppeteerLocatorAction, PuppeteerWorkflow } from 'src/types/puppeteer'
import type { ActionType, WaitForDefinition, WorkflowDefinition, WorkflowStep } from 'src/types/workflow'

export function workflowDefinitionToPuppeteerWorkflow(page: Page, workflowDefinition: WorkflowDefinition): PuppeteerWorkflow {
  return {
    startingUrl: workflowDefinition.startingPoint,
    locatorActions: stepsToPuppeteerLocatorAction(page, workflowDefinition.steps),
  }
}

function waitForDefinitionToQuerySelector(waitForDefinition: WaitForDefinition): string {
  switch (waitForDefinition.type) {
    case 'div':
      return `div.${waitForDefinition.identifier}`
    case 'button':
      return `button ::-p-text(${waitForDefinition.identifier})`
    case 'input':
      return `input[name="${waitForDefinition.identifier}"]`
    case 'href':
      return `a[href$="${waitForDefinition.identifier}"]`
  }
}

function waitForToQuerySelector(waitFor: WaitForDefinition[]): string {
  return waitFor.map(waitForDefinitionToQuerySelector).join(' ')
}

function actionToPuppeteerAction(action: ActionType): PuppeteerAction {
  switch (action.type) {
    case 'click': {
      return {
        type: 'click',
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
      }
    }
  }
}

function stepsToPuppeteerLocatorAction(page: Page, steps: WorkflowStep[]): PuppeteerLocatorAction[] {
  return steps.map((step) => {
    const querySelector = waitForToQuerySelector(step.waitFor)
    return {
      querySelector: querySelector,
      locator: page.locator(querySelector),
      action: actionToPuppeteerAction(step.action),
    }
  })
}
