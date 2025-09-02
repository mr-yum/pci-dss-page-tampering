import type { Browser, Page } from 'puppeteer'
import type { PuppeteerClickAction, PuppeteerClickPopupAction, PuppeteerInputAction, PuppeteerLocatorAction, PuppeteerNavigateAction } from '../types/puppeteer'
import type { DetectionSummary } from '../types/detection'
import type { IDetectionService } from '../interfaces/detection'
import type { HeaderName, HeaderValues } from '../types/header'
import type { ScriptInfo } from '../types/script'
import type { Target } from '../types/target'

import { getInlineScriptsFromPage } from '../utils/page'
import { getPuppeteerWorkflowFromTarget, stepsToPuppeteerLocatorAction } from '../utils/workflow'
import { scriptResponseHandler } from '../handlers/script'
import { headerResponseHandler } from '../handlers/header'

export class DetectionService implements IDetectionService {
  async detect(browser: Browser, target: Target): Promise<DetectionSummary> {
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []
    const headers = new Map<HeaderName, HeaderValues>()

    const page = await browser.newPage()

    try {
      // Bootstrap page
      page.on('response', (response) => scriptResponseHandler(response, externalScripts)).on('response', (response) => headerResponseHandler(response, headers))

      // Get Puppeteer workflow
      const puppeteerWorkflow = getPuppeteerWorkflowFromTarget(page, target)

      // Navigate to workflow starting url
      await page.goto(puppeteerWorkflow.target.url, {
        waitUntil: 'networkidle2',
      })

      // Execute workflow steps
      for (const [index, step] of puppeteerWorkflow.locatorActions.entries()) {
        const totalStepCount = puppeteerWorkflow.locatorActions.length
        const currentStepIndex = index + 1

        console.log(`[Detection]: (${currentStepIndex}/${totalStepCount}) ${step.description} for target '${puppeteerWorkflow.target.url}'.`)

        // Wait for element to be available
        await step.locator.wait()

        // Execute action
        await this.executeAction(page, step)

        // Detect and add new inline scripts on each workflow action
        const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts)
        newInlineScripts.forEach((script) => internalScripts.push(script))
      }
    } catch (e) {
      console.error(`An error occurred during page processing: ${e}`)
      await Promise.reject(e)
    } finally {
      await page.close()
    }

    return {
      target: target,
      scriptSummary: {
        externalScripts: externalScripts,
        inlineScripts: internalScripts,
      },
      headerSummary: {
        headers: headers,
      },
    }
  }

  private async executeAction(page: Page, step: PuppeteerLocatorAction): Promise<void> {
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

      case 'clickPopup': {
        const action: PuppeteerClickPopupAction = step.action

        // Add popup page handler
        page.on('popup', async (popupPage) => {
          if (popupPage) {
            const innerSteps = stepsToPuppeteerLocatorAction(popupPage, action.steps)
            for (const innerStep of innerSteps) {
              await innerStep.locator.wait()
              await this.executeAction(popupPage, innerStep)
            }
          }
        })

        // 2. Click to pop up new window
        await this.evalClick(page, step)

        if (action.waitForNavigation) {
          await page.waitForNavigation()
        }

        break
      }
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
    return detectedInlineScripts.filter((detectedScript) => !existingScripts.some((existingScript) => existingScript.hash.value === detectedScript.hash.value))
  }
}
