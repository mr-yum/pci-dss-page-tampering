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
import { capitalise } from '../utils/string'
import axios from 'axios'

export class DetectionService implements IDetectionService {
  async detect(browser: Browser, target: Target): Promise<DetectionSummary> {
    const page = await browser.newPage()
    const headers = new Map<HeaderName, HeaderValues>()
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []

    try {
      // Bootstrap page
      page.on('response', (response) => scriptResponseHandler(response, externalScripts)).on('response', (response) => headerResponseHandler(response, headers))

      // Get Puppeteer workflow
      const puppeteerWorkflow = getPuppeteerWorkflowFromTarget(page, target)

      // Navigate to workflow starting url
      await page.goto(puppeteerWorkflow.target.url, {
        waitUntil: 'networkidle2',
      })

      // // COOKIE AUTH STUFF
      // type AnonymousTokenResponse = {
      //   access_token: string
      //   id_token: string
      //   expires_in: number
      //   is_anonymous: boolean
      // }
      //
      // type MeAndUAuthCookie = {
      //   idToken: string
      //   expiresAt: number
      //   accessToken: string
      //   refreshToken: string | null
      //   isAnonymous: boolean
      //   authProvider: string | undefined
      // }
      //
      // const getAnonymousTokenUrl = new URL('https://app.meandu.com/api/account/anonymoustoken')
      //
      // await page.evaluate(async () => {
      //   const getAnonymousTokenResponse = await axios.get(getAnonymousTokenUrl.toString())
      //   const anonymousToken: AnonymousTokenResponse = getAnonymousTokenResponse.data
      //   const expiresAt = Date.now() + (anonymousToken.expires_in - 60) * 1000
      //   const authCookie: MeAndUAuthCookie = {
      //     idToken: '',
      //     expiresAt: expiresAt,
      //     accessToken: anonymousToken.access_token,
      //     refreshToken: null,
      //     isAnonymous: false,
      //     authProvider: 'meandu',
      //   }
      //
      //   console.log(anonymousToken)
      //
      //   const cookieData = getAnonymousTokenResponse.headers['set-cookie']!
      //   const splitCookies = cookieData
      //     .pop()!
      //     .split(';')
      //     .map((string) => string.trim())
      //   console.log(splitCookies)
      //   const authRestoreCookie = splitCookies.find((cookieStr) => cookieStr.startsWith('authrestore'))!
      //   await browser.setCookie({
      //     sameSite: 'Strict',
      //     httpOnly: true,
      //     name: 'authrestore_au',
      //     value: authRestoreCookie.split('=').pop()!,
      //     domain: 'app.meandu.com',
      //   })
      //
      //   const cookieStr = JSON.stringify(authCookie)
      //   console.log(cookieStr)
      //   localStorage.setItem('auth_au', cookieStr)
      // })

      // Execute workflow steps
      for (const [index, step] of puppeteerWorkflow.locatorActions.entries()) {
        const totalStepCount = puppeteerWorkflow.locatorActions.length
        const currentStepIndex = index + 1
        const url = new URL(puppeteerWorkflow.target.url)
        const targetType = capitalise(target.type)

        console.log(`[${targetType} → ${url.hostname}] (${currentStepIndex}/${totalStepCount}) ${step.description}.`)

        try {
          // Wait for element to be available
          await step.locator.wait()

          // Execute action
          await this.executeAction(page, step)

          // Detect and add new inline scripts on each workflow action
          const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts)
          newInlineScripts.forEach((script) => internalScripts.push(script))
        } catch (e) {
          console.error(`[Error → ${targetType} → ${url.hostname}] Executing step failed '${step.description}'.`)
        }
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
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    if (step.delay > 0) {
      await sleep(step.delay)
    }

    try {
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
          let poppedUpPage: Page | undefined = undefined

          // Add popup page handler
          page.on('popup', async (popupPage) => {
            if (popupPage) {
              poppedUpPage = popupPage
            }
          })

          // Click to pop up new window
          await this.evalClick(page, step)

          // Wait for popup to be available
          while (poppedUpPage === undefined) {
            await sleep(1000)
          }

          // Execute popup steps
          const innerSteps = stepsToPuppeteerLocatorAction(poppedUpPage, action.steps)
          for (const innerStep of innerSteps) {
            await innerStep.locator.wait()
            await this.executeAction(poppedUpPage, innerStep)
          }

          if (action.waitForNavigation) {
            await page.waitForNavigation()
          }

          break
        }
      }
    } catch (e) {
      await Promise.reject(e)
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
