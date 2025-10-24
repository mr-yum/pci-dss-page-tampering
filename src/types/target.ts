import type { Logger } from '../utils/logger'
import type { Workflow } from './workflow'

export type TargetInventory = Target & {
  type: 'inventory'
}

export type TargetDetection = Target & {
  type: 'detection'
}

export type Target = {
  type: 'inventory' | 'detection'
  name?: string | undefined
  url: string
  workflow: Workflow
  logger: Logger
}

export enum PullTarget {
  Inventory,
  Detection,
}
