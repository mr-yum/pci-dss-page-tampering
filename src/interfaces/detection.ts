import type { Browser } from 'puppeteer'

import type { DetectionSummary } from '../types/detection'
import type { ScriptMatcher } from '../types/matcher'
import type { Target } from '../types/target'

export interface IDetectionService {
  detect(browser: Browser, target: Target, scriptContentMatchers: ScriptMatcher[]): Promise<DetectionSummary>
}
