import type { Browser } from 'puppeteer'

import type { DetectionSummary } from '../types/detection.js'
import type { InventoryHeaderInfo } from '../types/inventory/model.js'
import type { Target } from '../types/target.js'

export interface IDetectionService {
  detect(browser: Browser, target: Target, inventoryHeaders?: readonly InventoryHeaderInfo[]): Promise<DetectionSummary>
}
