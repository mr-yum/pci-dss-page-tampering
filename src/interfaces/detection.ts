import type { Browser } from 'puppeteer'
import type { Target } from '../types/target'
import type { Workflow } from '../types/workflow'
import type { ScriptDetectionSummary } from '../types/script'

export interface IScriptDetectionService {
  detectScripts(browser: Browser, target: Target, workflow: Workflow): Promise<ScriptDetectionSummary>
}
