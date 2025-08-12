import type { Browser } from 'puppeteer'
import { PuppeteerInputAction } from 'src/types/puppeteer'
import { workflowDefinitionToPuppeteerWorkflow } from 'src/utils/workflow'
import { legacyWorkflow } from 'src/workflows/1.0'

import { scriptResponseHandler } from '../handlers/script'
import type { ScriptInfo } from '../types/scriptInfo'

interface ScriptDetectionArgs {
  browser: Browser
}

interface IScriptDetectionService {
  getPageScripts(url: string): Promise<ScriptInfo[]>
}

export class ScriptDetectionService implements IScriptDetectionService {
  private _browser: Browser

  constructor(args: ScriptDetectionArgs) {
    this._browser = args.browser
  }

  async getPageScripts(_url: string): Promise<ScriptInfo[]> {
    const detectedScripts: ScriptInfo[] = []
    const workflow = legacyWorkflow

    try {
      // Bootstrap page
      const page = await this._browser.newPage()
      page.on('response', (response) =>
        scriptResponseHandler(response, detectedScripts),
      )

      // Get Puppeteer workflow
      const puppeteerWorkflow = workflowDefinitionToPuppeteerWorkflow(
        page,
        workflow,
      )

      // Navigate to workflow starting url
      await page.goto(puppeteerWorkflow.startingUrl, {
        waitUntil: 'networkidle0',
      })

      // Execute workflow steps
      for (const step of puppeteerWorkflow.locatorActions) {
        switch (step.action.type) {
          case 'click':
            await step.locator.click()
            break
          case 'input': {
            const action: PuppeteerInputAction = step.action
            await step.locator
              .click()
              .then(() => page.type(step.querySelector, action.value))
            break
          }
        }
      }
    } catch (e) {
      console.error(`An error occurred during page processing: ${e}`)
    } finally {
      // await this._browser.close()
    }

    return detectedScripts
  }
}
