import type { Browser } from 'puppeteer'
import type { Target } from '../types/target'
import type { DetectionSummary } from '../types/detection'
import type { ScriptMatcher } from '../types/matcher'

export interface IDetectionService {
  detect(browser: Browser, target: Target, scriptMatchers: ScriptMatcher[]): Promise<DetectionSummary>
}
