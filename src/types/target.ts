import type { Logger } from '../utils/logger.js'
import type { Workflow } from './workflow.js'

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
