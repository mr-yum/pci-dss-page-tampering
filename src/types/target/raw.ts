import type { TargetDetection, TargetInventory } from '../target'

export type RawTargetInventory = Omit<TargetInventory, 'workflow' | 'logger'> & {
  workflow: string
}

export type RawTargetDetection = Omit<TargetDetection, 'workflow' | 'logger'> & {
  workflow: string
}
