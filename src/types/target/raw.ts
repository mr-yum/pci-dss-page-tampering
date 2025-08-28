import type { TargetDetection, TargetInventory } from '../target'

export type RawTargetInventory = Omit<TargetInventory, 'workflow'> & {
  workflow: string
}

export type RawTargetDetection = Omit<TargetDetection, 'workflow'> & {
  workflow: string
}
