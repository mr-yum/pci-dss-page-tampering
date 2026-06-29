import type { Locator } from 'puppeteer'

import type { Target } from './target.js'
import type { WorkflowStep } from './workflow.js'

export type PuppeteerWorkflow = {
  target: Target
  locatorActions: PuppeteerLocatorAction[]
}

export type PuppeteerLocatorAction = {
  description: string
  querySelector: string
  locator: Locator<Element>
  action: PuppeteerAction
  delay: number
}

export type PuppeteerAction = PuppeteerClickAction | PuppeteerInputAction | PuppeteerEscapeAction | PuppeteerNavigateAction | PuppeteerClickPopupAction

export type PuppeteerClickAction = {
  type: 'click'
  waitForNavigation: boolean
}

export type PuppeteerInputAction = {
  type: 'input'
  value: string
}

export type PuppeteerEscapeAction = {
  type: 'escape'
}

export type PuppeteerNavigateAction = {
  type: 'navigate'
  waitForNavigation: boolean
}

export type PuppeteerClickPopupAction = {
  type: 'clickPopup'
  waitForNavigation: boolean
  steps: WorkflowStep[]
}
