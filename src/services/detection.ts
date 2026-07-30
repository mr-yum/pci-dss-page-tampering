import type { Browser, ElementHandle, Frame, HTTPResponse, Page } from 'puppeteer'
import { TimeoutError } from 'puppeteer'

import { headerResponseHandler } from '../handlers/header.js'
import { scriptResponseHandler } from '../handlers/script.js'
import type { IDetectionService } from '../interfaces/detection.js'
import type { DetectionSummary } from '../types/detection.js'
import type { DetectedResponse, HeaderName, HeaderUrl } from '../types/header.js'
import type { InventoryHeaderInfo } from '../types/inventory/model.js'
import type { ScriptMatcher } from '../types/matcher.js'
import type { PuppeteerClickAction, PuppeteerClickPopupAction, PuppeteerInputAction, PuppeteerLocatorAction, PuppeteerNavigateAction, PuppeteerTotpAction } from '../types/puppeteer.js'
import type { ScriptInfo } from '../types/script.js'
import type { Target } from '../types/target.js'
import { resolveDateTemplates } from '../utils/date-template.js'
import { getInlineScriptsFromPage } from '../utils/page.js'
import { INLINE_SCRIPT_ATTRIBUTION_SCRIPT } from '../utils/page-attribution.js'
import { generateTotp, millisecondsRemainingInTotpWindow } from '../utils/totp.js'
import { redactUrl } from '../utils/url.js'
import { deriveUserAgentMetadata, normaliseHeadlessUserAgent } from '../utils/user-agent.js'
import { getPuppeteerWorkflowFromTarget, stepsToPuppeteerLocatorAction } from '../utils/workflow.js'

// If fewer than this many milliseconds remain in the current TOTP window,
// wait for the next window before generating the code, so it cannot expire
// between being typed and being verified server-side.
const TOTP_WINDOW_SAFETY_MARGIN_MS = 5000

// Per-keystroke delay when typing the TOTP code. The segmented OTP field
// (input-otp) re-renders per digit; typing with no delay drops or mangles
// digits on heavier pages (observed ~2/3 of the time on Tables production,
// yielding a wrong code that fails verification), so pace the keystrokes so
// the component registers each one.
const TOTP_TYPING_DELAY_MS = 100

type ActionTarget = {
  context: Page | Frame
  element?: ElementHandle<Element>
}

export class DetectionService implements IDetectionService {
  private readonly totpSeeds: ReadonlyMap<string, string>

  constructor(options: { totpSeeds?: ReadonlyMap<string, string> } = {}) {
    this.totpSeeds = options.totpSeeds ?? new Map()
  }
  async detect(browser: Browser, target: Target, scriptContentMatchers: ScriptMatcher[], inventoryHeaders: readonly InventoryHeaderInfo[] = []): Promise<DetectionSummary> {
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []
    const headers = new Map<HeaderName, Map<string, Set<HeaderUrl>>>()
    const responses: DetectedResponse[] = []

    // Isolated context per run: cookies and storage must not leak between
    // the inventory and detection phases (a session persisted from the
    // inventory run skips the sign-in flow and strands the detection
    // workflow) or between targets running in parallel.
    const context = await browser.createBrowserContext()
    let page: Page
    try {
      page = await context.newPage()
    } catch (error) {
      // The finally below only runs once the workflow try is entered; close
      // the context here so a failed page creation cannot leak it. Never let
      // a cleanup failure mask the original error.
      await context.close().catch(() => undefined)
      throw error
    }
    let puppeteerWorkflow: any
    // Resolved from the target's template URL before navigation; hoisted so
    // every error path can log the URL that was actually navigated.
    let navigationUrl: string | undefined

    try {
      // Set timeouts to 120 seconds
      page.setDefaultTimeout(120000) // 120 seconds for all operations
      page.setDefaultNavigationTimeout(120000) // 120 seconds for navigation

      // Present the regular Chrome user agent instead of HeadlessChrome (see
      // applyRealisticUserAgent). Popups opened by clickPopup steps get the
      // same treatment in their handler.
      await this.applyRealisticUserAgent(page, browser)

      // Install the inline-script attribution shim before any page script
      // runs so we can tag each inserted <script> element with the URL of
      // the script that initiated the insertion (see src/utils/page-attribution.ts).
      await page.evaluateOnNewDocument(INLINE_SCRIPT_ATTRIBUTION_SCRIPT)

      // Bootstrap page
      page.on('response', (response) => scriptResponseHandler(response, externalScripts)).on('response', (response) => headerResponseHandler(response, headers, responses, target.url, inventoryHeaders, target.workflowId ?? 'default'))

      // Surface blocked requests with their Cloudflare ray ID. Bot mitigation
      // (managed challenge, Turnstile, rate limit) usually manifests downstream
      // as an opaque step timeout; logging the 403/429 and its `cf-ray` here
      // gives an operator the exact identifier to hand the platform team so a
      // zone-side block can be looked up in Cloudflare's Security Events.
      page.on('response', (response) => this.logIfBlocked(response, target))

      // Get Puppeteer workflow
      puppeteerWorkflow = getPuppeteerWorkflowFromTarget(target)

      // Navigate to workflow starting url, resolving any {{date+Nd}}
      // placeholders at run time so booking-style targets always request a
      // date with availability.
      navigationUrl = resolveDateTemplates(puppeteerWorkflow.target.url)
      try {
        await page.goto(navigationUrl, {
          waitUntil: 'networkidle2',
        })
      } catch (navError) {
        if (navError instanceof Error && navError.name === 'TimeoutError') {
          target.logger.error(`NAVIGATION TIMEOUT ERROR`)
          target.logger.error(`Target URL: ${navigationUrl}`)
          target.logger.error(`Error message: ${navError.message}`)
          target.logger.error(`Stack trace:`, navError.stack)
        } else {
          target.logger.error(`NAVIGATION ERROR`)
          target.logger.error(`Target URL: ${navigationUrl}`)
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
          if (step.delay > 0) {
            await this.sleep(step.delay)
          }
          const actionTarget = await this.waitForActionTarget(page, step)

          // Execute action
          await this.executeAction(page, actionTarget, step, target, browser)

          // Detect and add new inline scripts on each workflow action
          const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts, scriptContentMatchers)
          newInlineScripts.forEach((script) => internalScripts.push(script))
        } catch (stepError) {
          // Enhanced error logging for workflow steps
          if (stepError instanceof Error && stepError.name === 'TimeoutError') {
            target.logger.error(`TIMEOUT ERROR in step ${currentStepIndex}/${totalStepCount}`)
            target.logger.error(`Step description: ${step.description}`)
            target.logger.error(`Target URL: ${navigationUrl ?? puppeteerWorkflow.target.url}`)
            target.logger.error(`Element selector: ${step.querySelector}`)
            if (step.frameUrl) target.logger.error(`Frame URL matcher: ${step.frameUrl}`)
            target.logger.error(`Action type: ${step.action.type}`)
            target.logger.error(`Current page URL: ${page.url()}`)
            target.logger.error(`Error message: ${stepError.message}`)
            target.logger.error(`Stack trace:`, stepError.stack)
          } else {
            target.logger.error(`ERROR in step ${currentStepIndex}/${totalStepCount}`)
            target.logger.error(`Step description: ${step.description}`)
            target.logger.error(`Target URL: ${navigationUrl ?? puppeteerWorkflow.target.url}`)
            target.logger.error(`Element selector: ${step.querySelector}`)
            if (step.frameUrl) target.logger.error(`Frame URL matcher: ${step.frameUrl}`)
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
        target.logger.error(`Target URL: ${navigationUrl ?? target.url}`)
        target.logger.error(`Current page URL: ${page.url()}`)
        target.logger.error(`Error message: ${e.message}`)
        target.logger.error(`Stack trace:`, e.stack)
      } else {
        target.logger.error(`ERROR during page processing`)
        target.logger.error(`Target URL: ${navigationUrl ?? target.url}`)
        target.logger.error(`Current page URL: ${page.url()}`)
        target.logger.error(`Error: ${e}`)
        if (e instanceof Error) {
          target.logger.error(`Stack trace:`, e.stack)
        }
      }
      throw e // Re-throw the error to ensure it's propagated
    } finally {
      // Closes the page and discards cookies/storage. Log-and-continue on
      // failure so cleanup can never mask a workflow error.
      await context.close().catch((closeError) => target.logger.error(`Failed to close browser context: ${closeError}`))
    }

    return {
      target: target,
      scriptSummary: {
        externalScripts: externalScripts,
        inlineScripts: internalScripts,
      },
      headerSummary: {
        headers: headers,
        responses,
      },
    }
  }

  /**
   * Present the regular Chrome user agent instead of HeadlessChrome so the
   * monitor observes what real users are served: bot mitigation blocks on the
   * headless token, and a cloaking attacker could key on it to hide tampering
   * from the monitor. Overrides both the UA string and the Client Hint
   * metadata (Sec-CH-UA), since either surface can leak the headless brand,
   * using the browser's real build version so the high-entropy hints match a
   * real Chrome. Applied to every page — the main page and any popup.
   */
  private async applyRealisticUserAgent(page: Page, browser: Browser): Promise<void> {
    const normalisedUserAgent = normaliseHeadlessUserAgent(await browser.userAgent())
    await page.setUserAgent(normalisedUserAgent, deriveUserAgentMetadata(normalisedUserAgent, await browser.version()))
  }

  /**
   * Log HTTP 403/429 responses — the statuses bot mitigation and rate limiting
   * use — with their Cloudflare `cf-ray` and `cf-mitigated` headers when
   * present. A blocked request typically surfaces later as a step timeout with
   * no obvious cause; recording the ray ID at the point of the block gives an
   * operator the exact identifier to look the block up in Cloudflare's Security
   * Events (or hand to the platform team) rather than reverse-engineering it.
   */
  private logIfBlocked(response: HTTPResponse, target: Target): void {
    const status = response.status()
    if (status !== 403 && status !== 429) {
      return
    }
    const headers = response.headers()
    // Log only origin + path, never the query string: on auth endpoints it can
    // carry tokens, signed URLs, or PII, and the ray ID (below) is the actual
    // identifier for diagnosis.
    const details = [`REQUEST BLOCKED: ${status} ${response.request().method()} ${redactUrl(response.url())}`]
    if (headers['cf-ray']) {
      details.push(`cf-ray=${headers['cf-ray']}`)
    }
    if (headers['cf-mitigated']) {
      details.push(`cf-mitigated=${headers['cf-mitigated']}`)
    }
    target.logger.error(details.join(' '))
  }

  private async executeAction(page: Page, actionTarget: ActionTarget, step: PuppeteerLocatorAction, target: Target, browser: Browser): Promise<void> {
    try {
      // Execute action
      switch (step.action.type) {
        case 'click': {
          const action: PuppeteerClickAction = step.action
          if (action.waitForNavigation) {
            await Promise.all([this.waitForActionNavigation(page, actionTarget.context), this.evalClick(actionTarget, step)])
          } else {
            await this.evalClick(actionTarget, step)
          }
          break
        }

        case 'input': {
          const action: PuppeteerInputAction = step.action
          await this.evalClick(actionTarget, step)
          if (actionTarget.element) {
            await actionTarget.element.type(action.value)
          } else {
            await actionTarget.context.type(step.querySelector, action.value)
          }
          break
        }

        case 'totp': {
          const action: PuppeteerTotpAction = step.action
          const seed = this.totpSeeds.get(action.seedRef)
          if (seed === undefined) {
            const availableSeeds = this.totpSeeds.size > 0 ? [...this.totpSeeds.keys()].join(', ') : '(none)'
            throw new Error(`TOTP seed '${action.seedRef}' was not provided. Pass it via --totp-seed ${action.seedRef}=<base32-seed>. Available seeds: ${availableSeeds}`)
          }

          const remainingMs = millisecondsRemainingInTotpWindow(Date.now())
          if (remainingMs < TOTP_WINDOW_SAFETY_MARGIN_MS) {
            await actionTarget.element?.dispose().catch(() => undefined)
            await this.sleep(remainingMs + 50)
            actionTarget = await this.waitForActionTarget(page, step)
          }

          // Focus the final validated element, then generate the code as late
          // as possible. A navigation detaches the handle and fails secure.
          await this.evalClick(actionTarget, step)
          const code = generateTotp(seed, Date.now())
          if (actionTarget.element) {
            await actionTarget.element.type(code, { delay: TOTP_TYPING_DELAY_MS })
          } else {
            await actionTarget.context.type(step.querySelector, code, { delay: TOTP_TYPING_DELAY_MS })
          }
          break
        }

        case 'escape': {
          if (actionTarget.element) {
            await actionTarget.element.focus()
          }
          await page.keyboard.press('Escape')
          break
        }

        case 'navigate': {
          const action: PuppeteerNavigateAction = step.action
          if (action.waitForNavigation) {
            await Promise.all([this.waitForActionNavigation(page, actionTarget.context), this.evalClick(actionTarget, step)])
          } else {
            await this.evalClick(actionTarget, step)
          }
          break
        }

        case 'clickPopup': {
          const action: PuppeteerClickPopupAction = step.action
          const popupAbortController = new AbortController()
          let popupPage: Page
          try {
            const popupPromise = this.waitForPopup(page, popupAbortController.signal)
            const clickPromise = action.waitForNavigation ? Promise.all([this.waitForActionNavigation(page, actionTarget.context), this.evalClick(actionTarget, step)]).then(() => undefined) : this.evalClick(actionTarget, step)
            ;[popupPage] = await Promise.all([popupPromise, clickPromise])
          } finally {
            popupAbortController.abort()
          }

          try {
            // Attach blocked-request diagnostics before any await after the
            // popup is observed. Its initial response may already have landed.
            popupPage.on('response', (response) => this.logIfBlocked(response, target))

            // Popups start with Puppeteer's defaults rather than inheriting
            // the parent page's workflow budget. Keep slow provider popups on
            // the same timeout policy as the page that opened them.
            popupPage.setDefaultTimeout(page.getDefaultTimeout())
            popupPage.setDefaultNavigationTimeout(page.getDefaultNavigationTimeout())

            // The popup inherits the browser's default (headless) UA; give it
            // the same realistic UA for every request after its initial one.
            await this.applyRealisticUserAgent(popupPage, browser)

            const innerSteps = stepsToPuppeteerLocatorAction(action.steps)
            for (const [popupIndex, innerStep] of innerSteps.entries()) {
              const popupStepNumber = popupIndex + 1
              target.logger.log(`Popup step ${popupStepNumber}/${innerSteps.length}: ${innerStep.description}`)

              try {
                if (innerStep.delay > 0) {
                  await this.sleep(innerStep.delay)
                }
                const innerActionTarget = await this.waitForActionTarget(popupPage, innerStep)
                await this.executeAction(popupPage, innerActionTarget, innerStep, target, browser)
              } catch (popupStepError) {
                if (popupStepError instanceof Error && popupStepError.name === 'TimeoutError') {
                  target.logger.error(`POPUP TIMEOUT ERROR in step ${popupStepNumber}/${innerSteps.length}`)
                  target.logger.error(`Popup step description: ${innerStep.description}`)
                  target.logger.error(`Popup element selector: ${innerStep.querySelector}`)
                  if (innerStep.frameUrl) target.logger.error(`Popup frame URL matcher: ${innerStep.frameUrl}`)
                  target.logger.error(`Popup action type: ${innerStep.action.type}`)
                  target.logger.error(`Popup page URL: ${this.redactFrameUrl(popupPage.url())}`)
                  target.logger.error(`Error message: ${popupStepError.message}`)
                  target.logger.error(`Stack trace:`, popupStepError.stack)
                } else {
                  target.logger.error(`POPUP ERROR in step ${popupStepNumber}/${innerSteps.length}`)
                  target.logger.error(`Popup step description: ${innerStep.description}`)
                  target.logger.error(`Popup element selector: ${innerStep.querySelector}`)
                  if (innerStep.frameUrl) target.logger.error(`Popup frame URL matcher: ${innerStep.frameUrl}`)
                  target.logger.error(`Popup action type: ${innerStep.action.type}`)
                  target.logger.error(`Popup page URL: ${this.redactFrameUrl(popupPage.url())}`)
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
            target.logger.error(`Popup page URL: ${this.redactFrameUrl(popupPage.url())}`)
            target.logger.error(`Error: ${error}`)
            if (error instanceof Error) {
              target.logger.error(`Stack trace:`, error.stack)
            }
            throw error
          }

          break
        }
      }
    } finally {
      await actionTarget.element?.dispose().catch(() => undefined)
    }
  }

  /*
   This results in a high success rate than using Locator.click() when element is visible via Locator.wait().
   Only call this function if you are sure that the element is visible, otherwise it will error.
   */
  private async evalClick(actionTarget: ActionTarget, step: PuppeteerLocatorAction): Promise<void> {
    if (actionTarget.element) {
      await actionTarget.element.evaluate((element) => (element as HTMLElement).click())
    } else {
      await actionTarget.context.$eval(step.querySelector, (element) => (element as HTMLElement)?.click())
    }
  }

  private async waitForActionNavigation(page: Page, actionContext: Page | Frame): Promise<HTTPResponse | null> {
    if (actionContext === page) return page.waitForNavigation()

    const abortController = new AbortController()
    try {
      return await Promise.any([page.waitForNavigation({ signal: abortController.signal }), actionContext.waitForNavigation({ signal: abortController.signal })])
    } catch (error) {
      if (error instanceof AggregateError) {
        throw error.errors.find((candidate) => candidate instanceof Error && candidate.name === 'TimeoutError') ?? error.errors[0] ?? error
      }
      throw error
    } finally {
      abortController.abort()
    }
  }

  private async waitForPopup(page: Page, signal: AbortSignal): Promise<Page> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timeout)
        page.off('popup', onPopup)
        signal.removeEventListener('abort', onAbort)
      }
      const rejectOnce = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onPopup = (popupPage: Page | null) => {
        if (settled) return
        settled = true
        cleanup()
        if (popupPage) {
          resolve(popupPage)
        } else {
          reject(new Error('Popup event did not provide a page'))
        }
      }
      const onAbort = () => rejectOnce(signal.reason ?? new Error('Popup wait aborted'))
      const timeout = setTimeout(() => rejectOnce(new TimeoutError('Timed out waiting for popup page')), page.getDefaultTimeout())
      page.on('popup', onPopup)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  private async waitForActionTarget(page: Page, step: PuppeteerLocatorAction): Promise<ActionTarget> {
    if (!step.frameUrl) {
      await page.locator(step.querySelector).wait()
      return { context: page }
    }

    const matcher = new RegExp(step.frameUrl)
    const deadline = Date.now() + page.getDefaultTimeout()

    while (Date.now() < deadline) {
      for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame() && matcher.test(candidate.url()))) {
        const remainingTime = deadline - Date.now()
        if (remainingTime <= 0) break
        const element = await frame.waitForSelector(step.querySelector, { visible: true, timeout: Math.min(100, remainingTime) }).catch(() => null)
        if (element) {
          if (matcher.test(frame.url())) return { context: frame, element }
          await element.dispose()
        }
      }
      await this.sleep(100)
    }

    const observedFrameUrls = [...new Set(page.frames().map((frame) => this.redactFrameUrl(frame.url())))].join(', ')
    throw new TimeoutError(`Timed out waiting for selector '${step.querySelector}' in a frame URL matching /${step.frameUrl}/. Observed frame URLs: ${observedFrameUrls || '(none)'}`)
  }

  private redactFrameUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return redactUrl(url)
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
    return scheme ? `${scheme}:<redacted>` : '<unparseable>'
  }

  private async detectNewInlineScripts(page: Page, existingScripts: ScriptInfo[], scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
    const detectedInlineScripts = await this.getInlineScriptsSettled(page, scriptContentMatchers)
    return detectedInlineScripts.filter((detectedScript) => !existingScripts.some((existingScript) => existingScript.hash.value === detectedScript.hash.value))
  }

  /**
   * Scan the page for inline scripts, tolerating step-triggered navigations.
   * When a step's click starts a hard navigation, the evaluate can race the
   * document teardown ("Execution context was destroyed") — and a redirect
   * chain (e.g. checkout → sign-in) can tear down the retry too. Wait for the
   * document to settle and rescan, up to a few attempts. Any other error, or
   * destruction on the final attempt, still fails the run (fail-secure).
   */
  private async getInlineScriptsSettled(page: Page, scriptContentMatchers: ScriptMatcher[]): Promise<ScriptInfo[]> {
    const maxAttempts = 3
    for (let attempt = 1; ; attempt++) {
      try {
        return await getInlineScriptsFromPage(page, scriptContentMatchers)
      } catch (error) {
        const isContextDestroyed = error instanceof Error && error.message.includes('Execution context was destroyed')
        if (!isContextDestroyed || attempt >= maxAttempts) {
          throw error
        }
        await this.sleep(1500)
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
