import type { Locator } from 'puppeteer'

export type PuppeteerWorkflow = {
  startingUrl: string
  locatorActions: PuppeteerLocatorAction[]
}

export type PuppeteerLocatorAction = {
  description: string
  querySelector: string
  locator: Locator<Element>
  action: PuppeteerAction
}

export type PuppeteerAction = PuppeteerClickAction | PuppeteerInputAction | PuppeteerEscapeAction | PuppeteerNavigateAction

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
