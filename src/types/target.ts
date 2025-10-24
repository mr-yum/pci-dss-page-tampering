import type { Workflow } from './workflow'
import type { Logger } from '../utils/logger'

export type TargetInventory = Target & {
  type: 'inventory'
}

export type TargetDetection = Target & {
  type: 'detection'
}

export type Target = {
  type: 'inventory' | 'detection'
  url: string
  workflow: Workflow
  logger: Logger
}

export enum PullTarget {
  Inventory,
  Detection,
}
