import type { Browser, Page } from 'puppeteer'

import { headerResponseHandler } from '../handlers/header'
import { scriptResponseHandler } from '../handlers/script'
import type { IDetectionService } from '../interfaces/detection'
import type { DetectionSummary } from '../types/detection'
import type { HeaderName, HeaderValues } from '../types/header'
import type { ScriptMatcher } from '../types/matcher'
import type { PuppeteerClickAction, PuppeteerClickPopupAction, PuppeteerInputAction, PuppeteerLocatorAction, PuppeteerNavigateAction } from '../types/puppeteer'
import type { ScriptInfo } from '../types/script'
import type { Target } from '../types/target'
import { getInlineScriptsFromPage } from '../utils/page'
import { getPuppeteerWorkflowFromTarget, stepsToPuppeteerLocatorAction } from '../utils/workflow'

export class DetectionService implements IDetectionService {
  async detect(browser: Browser, target: Target, scriptContentMatchers: ScriptMatcher[]): Promise<DetectionSummary> {
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []
    const headers = new Map<HeaderName, HeaderValues>()

    const page = await browser.newPage()
    let puppeteerWorkflow: any = null

    try {
      // Set timeouts to 120 seconds
      page.setDefaultTimeout(120000) // 120 seconds for all operations
      page.setDefaultNavigationTimeout(120000) // 120 seconds for navigation

      // Bootstrap page
      page.on('response', (response) => scriptResponseHandler(response, externalScripts)).on('response', (response) => headerResponseHandler(response, headers))

      // Get Puppeteer workflow
      puppeteerWorkflow = getPuppeteerWorkflowFromTarget(page, target)

      // Navigate to workflow starting url
      try {
        await page.goto(puppeteerWorkflow.target.url, {
          waitUntil: 'networkidle2',
        })
      } catch (navError) {
        if (navError instanceof Error && navError.name === 'TimeoutError') {
          target.logger.error(`NAVIGATION TIMEOUT ERROR`)
          target.logger.error(`Target URL: ${puppeteerWorkflow.target.url}`)
          target.logger.error(`Error message: ${navError.message}`)
          target.logger.error(`Stack trace:`, navError.stack)
        } else {
          target.logger.error(`NAVIGATION ERROR`)
          target.logger.error(`Target URL: ${puppeteerWorkflow.target.url}`)
          target.logger.error(`Error: ${navError}`)
          if (navError instanceof Error) {
            target.logger.error(`Stack trace:`, navError.stack)
          }
        }
        throw navError
      }

      // Execute workflow steps
      for (const [index, step] of puppeteerWorkflow.locatorActions.entries()) {
        const totalStepCount = puppeteerWorkflow.locatorActions.length
        const currentStepIndex = index + 1

        target.logger.log(`(${currentStepIndex}/${totalStepCount}) ${step.description} for target '${puppeteerWorkflow.target.url}'.`)

        try {
          // Wait for element to be available
          await step.locator.wait()

          // Execute action
          await this.executeAction(page, step, target)

          // Detect and add new inline scripts on each workflow action
          const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts, scriptContentMatchers)
          newInlineScripts.forEach((script) => internalScripts.push(script))
        } catch (stepError) {
          // Enhanced error logging for workflow steps
          if (stepError instanceof Error && stepError.name === 'TimeoutError') {
            target.logger.error(`TIMEOUT ERROR in step ${currentStepIndex}/${totalStepCount}`)
            target.logger.error(`Step description: ${step.description}`)
            target.logger.error(`Target URL: ${puppeteerWorkflow.target.url}`)
            target.logger.error(`Element selector: ${step.querySelector}`)
            target.logger.error(`Action type: ${step.action.type}`)
            target.logger.error(`Current page URL: ${page.url()}`)
            target.logger.error(`Error message: ${stepError.message}`)
            target.logger.error(`Stack trace:`, stepError.stack)
          } else {
            target.logger.error(`ERROR in step ${currentStepIndex}/${totalStepCount}`)
            target.logger.error(`Step description: ${step.description}`)
            target.logger.error(`Target URL: ${puppeteerWorkflow.target.url}`)
            target.logger.error(`Element selector: ${step.querySelector}`)
            target.logger.error(`Action type: ${step.action.type}`)
            target.logger.error(`Current page URL: ${page.url()}`)
            target.logger.error(`Error: ${stepError}`)
            if (stepError instanceof Error) {
              target.logger.error(`Stack trace:`, stepError.stack)
            }
          }
          throw stepError // Re-throw to maintain existing error handling
        }
      }
    } catch (e) {
      // Enhanced error logging for the main catch block
      if (e instanceof Error && e.name === 'TimeoutError') {
        target.logger.error(`TIMEOUT ERROR during page processing`)
        target.logger.error(`Target URL: ${puppeteerWorkflow?.target?.url || 'Unknown'}`)
        target.logger.error(`Current page URL: ${page.url()}`)
        target.logger.error(`Error message: ${e.message}`)
        target.logger.error(`Stack trace:`, e.stack)
      } else {
        target.logger.error(`ERROR during page processing`)
        target.logger.error(`Target URL: ${puppeteerWorkflow?.target?.url || 'Unknown'}`)
        target.logger.error(`Current page URL: ${page.url()}`)
        target.logger.error(`Error: ${e}`)
        if (e instanceof Error) {
          target.logger.error(`Stack trace:`, e.stack)
        }
      }
      throw e // Re-throw the error to ensure it's propagated
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

  private async executeAction(page: Page, step: PuppeteerLocatorAction, target: Target): Promise<void> {
    // Delay action
    if (step.delay > 0) {
      await this.sleep(step.delay)
    }

    // Execute action
    switch (step.action.type) {
      case 'click': {
        const action: PuppeteerClickAction = step.action
        await this.evalClick(page, step)

        if (action.waitForNavigation) {
          await page.waitForNavigation()
        }
        break
      }

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
            try {
              const innerSteps = stepsToPuppeteerLocatorAction(popupPage, action.steps)

              for (const [popupIndex, innerStep] of innerSteps.entries()) {
                const popupStepNumber = popupIndex + 1
                target.logger.log(`Popup step ${popupStepNumber}/${innerSteps.length}: ${innerStep.description}`)

                try {
                  await innerStep.locator.wait()
                  await this.executeAction(popupPage, innerStep, target)
                } catch (popupStepError) {
                  if (popupStepError instanceof Error && popupStepError.name === 'TimeoutError') {
                    target.logger.error(`POPUP TIMEOUT ERROR in step ${popupStepNumber}/${innerSteps.length}`)
                    target.logger.error(`Popup step description: ${innerStep.description}`)
                    target.logger.error(`Popup element selector: ${innerStep.querySelector}`)
                    target.logger.error(`Popup action type: ${innerStep.action.type}`)
                    target.logger.error(`Popup page URL: ${popupPage.url()}`)
                    target.logger.error(`Error message: ${popupStepError.message}`)
                    target.logger.error(`Stack trace:`, popupStepError.stack)
                  } else {
                    target.logger.error(`POPUP ERROR in step ${popupStepNumber}/${innerSteps.length}`)
                    target.logger.error(`Popup step description: ${innerStep.description}`)
                    target.logger.error(`Popup element selector: ${innerStep.querySelector}`)
                    target.logger.error(`Popup action type: ${innerStep.action.type}`)
                    target.logger.error(`Popup page URL: ${popupPage.url()}`)
                    target.logger.error(`Error: ${popupStepError}`)
                    if (popupStepError instanceof Error) {
                      target.logger.error(`Stack trace:`, popupStepError.stack)
                    }
                  }
                  throw popupStepError
                }
              }
            } catch (error) {
              target.logger.error(`POPUP HANDLING ERROR`)
              target.logger.error(`Popup page URL: ${popupPage.url()}`)
              target.logger.error(`Error: ${error}`)
              if (error instanceof Error) {
                target.logger.error(`Stack trace:`, error.stack)
              }
              throw error // Re-throw to ensure popup errors are caught
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

  private async detectNewInlineScripts(page: Page, existingScripts: ScriptInfo[], scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
    const detectedInlineScripts = await getInlineScriptsFromPage(page, scriptContentMatchers)
    return detectedInlineScripts.filter((detectedScript) => !existingScripts.some((existingScript) => existingScript.hash.value === detectedScript.hash.value))
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
