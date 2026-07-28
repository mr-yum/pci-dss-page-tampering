import type { TargetDetection, TargetInventory } from '../target.js'

export type RawTargetInventory = Omit<TargetInventory, 'workflow' | 'workflowId' | 'logger'> & {
  workflow: string
}

export type RawTargetDetection = Omit<TargetDetection, 'workflow' | 'workflowId' | 'logger'> & {
  workflow: string
}
