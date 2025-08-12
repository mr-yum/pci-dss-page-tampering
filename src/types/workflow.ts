export type ActionType = {
  type: 'click' | 'input'
  value?: string
}

export type WaitForDefinition = {
  type: 'div' | 'button'
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
