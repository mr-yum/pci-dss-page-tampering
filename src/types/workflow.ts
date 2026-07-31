export type WorkflowActionType = {
  type: 'click' | 'input' | 'escape' | 'navigate' | 'clickPopup' | 'totp'
  value?: string | undefined
  // Name of a TOTP seed supplied at runtime via --totp-seed <name>=<seed>.
  // The seed itself must never appear in workflow files (they live in Git).
  seedRef?: string | undefined
  delay?: number | undefined
  waitForNavigation?: true | undefined
  // For click actions, wait for a response whose URL matches this regular
  // expression. Deserialized workflows require an anchored HTTPS origin.
  waitForResponse?: string | undefined
  // Optional timeout for waitForResponse. Omit to use the page default.
  waitForResponseTimeout?: number | undefined
  steps?: WorkflowStep[] | undefined
}

export type WorkflowWaitForDefinition = {
  type: 'div' | 'button' | 'input' | 'href' | 'h2' | 'h3' | 'span' | 'testid' | 'aria'
  identifier: string
}

export type WorkflowStep = {
  description: string
  // When set, resolve the step inside the first child frame whose URL matches
  // this regular expression. Omit it to act on the top-level page.
  frameUrl?: string | undefined
  waitFor: WorkflowWaitForDefinition[]
  action: WorkflowActionType
}

export type WorkflowDefinition = {
  steps: WorkflowStep[]
}

export type Workflow = {
  fileName: string
  definition: WorkflowDefinition
}
