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
  /** Stable identifier for the checkout workflow this target exercises. */
  workflowId?: string | undefined
  name?: string | undefined
  url: string
  workflow: Workflow
  logger: Logger
}

export enum PullTarget {
  Inventory,
  Detection,
}
