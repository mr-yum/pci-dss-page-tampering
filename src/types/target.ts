import type { Logger } from '../utils/logger.js'
import type { Workflow } from './workflow.js'

export type TargetInventory = Target & {
  type: 'inventory'
}

export type TargetDetection = Target & {
  type: 'detection'
}

/**
 * Runtime counterpart to `Target['type']` for inventory validation — the two
 * passes a script entry's `requiredOn` clause can pin presence to.
 */
export const TARGET_TYPES = ['inventory', 'detection'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

export type Target = {
  type: TargetType
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
