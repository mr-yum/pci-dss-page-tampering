export type WorkflowActionType = {
  type: 'click' | 'input' | 'escape' | 'navigate'
  value?: string
  waitForNavigation?: true
}

export type WorkflowWaitForDefinition = {
  type: 'div' | 'button' | 'input' | 'href' | 'h2' | 'h3'
  identifier: string
}

export type WorkflowStep = {
  description: string
  waitFor: WorkflowWaitForDefinition[]
  action: WorkflowActionType
}

export type WorkflowDefinition = {
  steps: WorkflowStep[]
}
