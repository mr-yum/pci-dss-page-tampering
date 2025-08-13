export type ActionType = {
  type: 'click' | 'input' | 'escape' | 'navigate'
  value?: string
}

export type WaitForDefinition = {
  type: 'div' | 'button' | 'input' | 'href'
  identifier: string
}

export type WorkflowStep = {
  description: string
  waitFor: WaitForDefinition[]
  action: ActionType
}

export type WorkflowDefinition = {
  startingPoint: string
  steps: WorkflowStep[]
}
