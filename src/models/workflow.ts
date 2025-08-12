export interface ActionType {
  type: 'click' | 'input'
  value?: string
}

export interface WaitForDefinition {
  type: 'div' | 'button'
  identifier: string
}

export interface WorkflowStep {
  description: string
  waitFor: WaitForDefinition[]
  action: ActionType
}

export interface WorkflowDefinition {
  startingPoint: string
  steps: WorkflowStep[]
}
