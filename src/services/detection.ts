import type { Browser, Page } from 'puppeteer'
import type { PuppeteerClickAction, PuppeteerInputAction, PuppeteerLocatorAction, PuppeteerNavigateAction } from 'src/types/puppeteer'
import type { ScriptInfo, ScriptSummary } from 'src/types/script'
import { getInlineScriptsFromPage } from 'src/utils/page'
import { workflowDefinitionToPuppeteerWorkflow } from 'src/utils/workflow'

import { scriptResponseHandler } from '../handlers/script'
import type { WorkflowDefinition } from '../types/workflow'

interface ScriptDetectionArgs {
  browser: Browser
}

interface IScriptDetectionService {
  detectScripts(workflow: WorkflowDefinition): Promise<ScriptSummary>
}

export class ScriptDetectionService implements IScriptDetectionService {
  private _browser: Browser

  constructor(args: ScriptDetectionArgs) {
    this._browser = args.browser
  }

  async detectScripts(workflow: WorkflowDefinition): Promise<ScriptSummary> {
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []

    const page = await this._browser.newPage()

    try {
      // Bootstrap page
      page.on('response', (response) => scriptResponseHandler(response, externalScripts))

      // Get Puppeteer workflow
      const puppeteerWorkflow = workflowDefinitionToPuppeteerWorkflow(page, workflow)

      // Navigate to workflow starting url
      await page.goto(puppeteerWorkflow.startingUrl, {
        waitUntil: 'networkidle2',
      })

      // Execute workflow steps
      for (const [index, step] of puppeteerWorkflow.locatorActions.entries()) {
        const totalStepCount = puppeteerWorkflow.locatorActions.length
        const currentStepIndex = index + 1

        console.log(`[${puppeteerWorkflow.startingUrl}][${currentStepIndex}/${totalStepCount}]: ${step.description}`)

        // Wait for element to be available
        await step.locator.wait()

        // Execute action
        switch (step.action.type) {
          case 'click':
            const action: PuppeteerClickAction = step.action
            await this.evalClick(page, step)

            if (action.waitForNavigation) {
              await page.waitForNavigation()
            }
            break

          case 'input': {
            const action: PuppeteerInputAction = step.action
            await this.evalClick(page, step)
            await page.type(step.querySelector, action.value)
            break
          }

          case 'escape': {
            await page.keyboard.press('Escape')
            break
          }

          case 'navigate': {
            const action: PuppeteerNavigateAction = step.action
            await this.evalClick(page, step)

            if (action.waitForNavigation) {
              await page.waitForNavigation()
            }
            break
          }
        }

        // Detect and add new inline scripts on each workflow action
        const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts)
        newInlineScripts.forEach((script) => internalScripts.push(script))
      }
    } catch (e) {
      console.error(`An error occurred during page processing: ${e}`)
    } finally {
      await page.close()
    }

    return {
      external: externalScripts,
      internal: internalScripts,
    }
  }

  /*
   This results in a high success rate than using Locator.click() when element is visible via Locator.wait().
   Only call this function if you are sure that the element is visible, otherwise it will error.
   */
  private async evalClick(page: Page, step: PuppeteerLocatorAction): Promise<void> {
    await page.$eval(step.querySelector, (element) => (element as HTMLElement)?.click())
  }

  private async detectNewInlineScripts(page: Page, existingScripts: ScriptInfo[]): Promise<ScriptInfo[]> {
    const detectedInlineScripts = await getInlineScriptsFromPage(page)
    return detectedInlineScripts.filter((detectedScript) => !existingScripts.some((existingScript) => existingScript.hash === detectedScript.hash))
  }
}
