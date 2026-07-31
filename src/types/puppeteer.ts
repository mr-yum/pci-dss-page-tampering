import type { Target } from './target.js'
import type { WorkflowStep } from './workflow.js'

export type PuppeteerWorkflow = {
  target: Target
  locatorActions: PuppeteerLocatorAction[]
}

export type PuppeteerLocatorAction = {
  description: string
  querySelector: string
  frameUrl?: string | undefined
  action: PuppeteerAction
  delay: number
  postActionDelay?: number | undefined
}

export type PuppeteerAction = PuppeteerClickAction | PuppeteerInputAction | PuppeteerTotpAction | PuppeteerEscapeAction | PuppeteerNavigateAction | PuppeteerClickPopupAction

export type PuppeteerClickAction = {
  type: 'click'
  waitForNavigation: boolean
  waitForResponse?: string | undefined
  waitForResponseTimeout?: number | undefined
  waitForResponseMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | undefined
  waitForResponseStatuses?: number[] | undefined
  waitForResponseBody?: string | undefined
}

export type PuppeteerInputAction = {
  type: 'input'
  value: string
}

// Types a TOTP code generated at step-execution time from the named seed
// (supplied via --totp-seed). The action carries only the seed's name so
// workflow definitions never contain the secret.
export type PuppeteerTotpAction = {
  type: 'totp'
  seedRef: string
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
