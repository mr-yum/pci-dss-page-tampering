import type { Browser } from 'puppeteer'
import type { Target } from '../types/target'
import type { Workflow } from '../types/workflow'
import type { DetectionSummary } from '../types/detection'

export interface IDetectionService {
  detect(browser: Browser, target: Target, workflow: Workflow): Promise<DetectionSummary>
}
