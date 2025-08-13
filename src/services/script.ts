import type { Browser } from 'puppeteer'
import type { PuppeteerInputAction } from 'src/types/puppeteer'
import type { ScriptInfo, ScriptSummary } from 'src/types/script'
import { getInlineScriptsFromPage } from 'src/utils/page'
import { workflowDefinitionToPuppeteerWorkflow } from 'src/utils/workflow'
import { uatWorkflow } from 'src/workflows/2.0'

import { scriptResponseHandler } from '../handlers/script'

interface ScriptDetectionArgs {
  browser: Browser
}

interface IScriptDetectionService {
  getPageScripts(): Promise<ScriptSummary>
}

export class ScriptDetectionService implements IScriptDetectionService {
  private _browser: Browser

  constructor(args: ScriptDetectionArgs) {
    this._browser = args.browser
  }

  async getPageScripts(): Promise<ScriptSummary> {
    const workflow = uatWorkflow

    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []

    try {
      // Bootstrap page
      const page = await this._browser.newPage()
      page.on('response', (response) => scriptResponseHandler(response, externalScripts))

      // Get Puppeteer workflow
      const puppeteerWorkflow = workflowDefinitionToPuppeteerWorkflow(page, workflow)

      // Navigate to workflow starting url
      await page.goto(puppeteerWorkflow.startingUrl, {
        waitUntil: 'networkidle2',
      })

      // Execute workflow steps
      for (const step of puppeteerWorkflow.locatorActions) {
        // Wait for element to be available
        await step.locator.wait()

        // Execute action
        switch (step.action.type) {
          case 'click':
            await step.locator.click()
            await page.waitForNavigation()
            break

          case 'input': {
            const action: PuppeteerInputAction = step.action
            await step.locator.click()
            await page.type(step.querySelector, action.value)
            break
          }

          case 'escape': {
            await page.keyboard.press('Escape')
            break
          }

          case 'navigate': {
            await page.$eval(step.querySelector, (element) => (element as HTMLElement).click())
            await page.waitForNavigation()
          }
        }

        // Detect and add new inline scripts on each workflow action
        const detectedInlineScripts = await getInlineScriptsFromPage(page)
        const newInlineScripts = detectedInlineScripts.filter((detectedScript) => !internalScripts.some((existingScript) => existingScript.sha256 === detectedScript.sha256))
        newInlineScripts.forEach((script) => internalScripts.push(script))
      }
    } catch (e) {
      console.error(`An error occurred during page processing: ${e}`)
    } finally {
      // await this._browser.close()
    }

    return {
      external: externalScripts,
      internal: internalScripts,
    }
  }
}
