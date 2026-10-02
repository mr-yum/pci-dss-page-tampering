import type { Browser, ElementHandle, Frame, HTTPResponse, Page } from 'puppeteer'
import { TimeoutError } from 'puppeteer'

import { headerResponseHandler } from '../handlers/header.js'
import { PendingScriptReads, recordUnreadScript, scriptResponseHandler } from '../handlers/script.js'
import type { IDetectionService } from '../interfaces/detection.js'
import type { DetectionSummary } from '../types/detection.js'
import type { DocumentId } from '../types/document.js'
import type { DetectedResponse, HeaderDetectionSummary, HeaderName, HeaderUrl } from '../types/header.js'
import type { InventoryHeaderInfo } from '../types/inventory/model.js'
import type { ScriptMatcher } from '../types/matcher.js'
import type { PuppeteerClickAction, PuppeteerClickPopupAction, PuppeteerInputAction, PuppeteerLocatorAction, PuppeteerNavigateAction, PuppeteerTotpAction } from '../types/puppeteer.js'
import type { ScriptInfo, UnreadScriptResponse } from '../types/script.js'
import type { Target } from '../types/target.js'
import { resolveDateTemplates } from '../utils/date-template.js'
import { getInlineScriptsFromPage } from '../utils/page.js'
import { INLINE_SCRIPT_ATTRIBUTION_SCRIPT } from '../utils/page-attribution.js'
import { generateTotp, millisecondsRemainingInTotpWindow } from '../utils/totp.js'
import { redactUrl } from '../utils/url.js'
import { deriveUserAgentMetadata, normaliseHeadlessUserAgent } from '../utils/user-agent.js'
import { getPuppeteerWorkflowFromTarget, stepsToPuppeteerLocatorAction } from '../utils/workflow.js'
import { DocumentTracker } from './document-ledger.js'
import { outsidePaymentDocuments } from './payment-scope.js'

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

// Hosted payment fields format and validate after each key event. A small
// delay prevents their iframe handlers from dropping digits under concurrent
// target load while retaining the pinned, origin-validated ElementHandle.
const FRAMED_INPUT_TYPING_DELAY_MS = 25

// Bound the combined initial navigation, selector waits, and reload retries.
// Without one shared deadline, their nested per-attempt timeouts can compound
// into a multi-minute delay for every later variation in the same inventory.
const INITIAL_WORKFLOW_TIMEOUT_MS = 300000
const NAVIGATION_ATTEMPT_TIMEOUT_MS = 120000

// How long a finished workflow waits for script bodies still being read
// before it closes the browser context. Anything still unread then is
// recorded as unread rather than lost.
const SCRIPT_READ_SETTLE_TIMEOUT_MS = 15000

// Response bodies Chrome keeps outside the renderer, so they survive the page
// navigating away (see retainResponseBodies). Caps, not allocations: a body
// evicted past them is recorded as unread, never silently lost.
const RETAINED_RESPONSE_BODIES_TOTAL_BYTES = 256 * 1024 * 1024
const RETAINED_RESPONSE_BODY_MAX_BYTES = 32 * 1024 * 1024

// How long a closed context is given for the reads it cut off to reject, so
// their records land before the summary is built.
const SCRIPT_READ_CLOSE_GRACE_MS = 2000

const SCRIPT_READ_UNFINISHED_REASON = `the response body was still being read ${SCRIPT_READ_SETTLE_TIMEOUT_MS / 1000}s after the workflow finished`
const SCRIPT_REQUEST_UNANSWERED_REASON = `no response had arrived ${SCRIPT_READ_SETTLE_TIMEOUT_MS / 1000}s after the workflow finished`

type ActionTarget = {
  context: Page | Frame
  element?: ElementHandle<Element>
}

class WorkflowAttemptError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly retryBoundaryCrossed: boolean,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError), { cause: originalError })
    this.name = 'WorkflowAttemptError'
  }
}

export class DetectionService implements IDetectionService {
  private readonly totpSeeds: ReadonlyMap<string, string>

  constructor(options: { totpSeeds?: ReadonlyMap<string, string> } = {}) {
    this.totpSeeds = options.totpSeeds ?? new Map()
  }
  async detect(browser: Browser, target: Target, scriptContentMatchers: ScriptMatcher[], inventoryHeaders: readonly InventoryHeaderInfo[] = []): Promise<DetectionSummary> {
    const retry = getPuppeteerWorkflowFromTarget(target).retry

    for (let attempt = 1; ; attempt++) {
      try {
        const summary = await this.detectAttempt(browser, target, scriptContentMatchers, inventoryHeaders)
        if (attempt > 1) {
          target.logger.log(`Workflow recovered successfully on attempt ${attempt}/${retry.maxAttempts}.`)
        }
        return summary
      } catch (error) {
        const attemptError = error instanceof WorkflowAttemptError ? error : new WorkflowAttemptError(error, false)
        const isFinalAttempt = attempt >= retry.maxAttempts
        if (attemptError.retryBoundaryCrossed || isFinalAttempt || !this.isRetryableWorkflowError(attemptError.originalError)) {
          throw attemptError.originalError
        }

        target.logger.log(`Transient workflow failure before retry boundary; starting a fresh browser context (${attempt + 1}/${retry.maxAttempts}).`)
        await this.sleep(retry.backoffMs * attempt)
      }
    }
  }

  private async detectAttempt(browser: Browser, target: Target, scriptContentMatchers: ScriptMatcher[], inventoryHeaders: readonly InventoryHeaderInfo[] = []): Promise<DetectionSummary> {
    const externalScripts: ScriptInfo[] = []
    const internalScripts: ScriptInfo[] = []
    // Script responses whose body could not be read: recorded, never dropped.
    const unreadScripts: UnreadScriptResponse[] = []
    const pendingScriptReads = new PendingScriptReads()
    // Set once the run has waited for its reads and is being accounted for:
    // from then on a late read is recorded as unread, never compared.
    let scriptsSealed = false
    // Workflow step running now (0 = initial navigation), read by the response
    // handler when each response arrives.
    let currentStep = 0
    const headers = new Map<HeaderName, Map<string, Set<HeaderUrl>>>()
    const responses: DetectedResponse[] = []
    const headerDocuments: NonNullable<HeaderDetectionSummary['documents']> = new Map()
    // Documents in which a paymentPage step's target was found. If any marked
    // step's document cannot be read, scoping is abandoned for the run rather
    // than applied to the documents that did resolve: an unresolved payment
    // page would otherwise have its scripts moved out of scope.
    const paymentDocuments = new Set<DocumentId>()
    // Documents the monitor's own reload recovery replaced, on any step. Each
    // takes the scope of the document that replaced it, whatever its path
    // (see PaymentScope.recoveryReplaced).
    const recoveryReplaced = new Set<DocumentId>()
    let paymentDocumentUnresolved = false
    let tracker: DocumentTracker | undefined

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
    let retryBoundaryCrossed = false
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

      // Keep response bodies readable after the page navigates away. Without
      // this, Chrome discards a document's response bodies as soon as a
      // navigation away from it is under way, so a script that finishes
      // loading during a "Pay" click that leaves for 3-D Secure cannot be read
      // at all — exactly the moment a skimmer would load.
      await this.retainResponseBodies(page, target)

      // Install the inline-script attribution shim before any page script
      // runs so we can tag each inserted <script> element with the URL of
      // the script that initiated the insertion (see src/utils/page-attribution.ts).
      await page.evaluateOnNewDocument(INLINE_SCRIPT_ATTRIBUTION_SCRIPT)

      // Attribute every observation to the top-level document it belongs to,
      // so the run can be scoped to the payment page's SPA context (see
      // partitionByPaymentScope). Best effort: without it every observation is
      // unattributed, which keeps the whole run in scope as before.
      tracker = await DocumentTracker.attach(page).catch((error: unknown) => {
        target.logger.error(`Document attribution unavailable (${error}); the whole run stays in payment scope.`)
        return undefined
      })
      if (tracker !== undefined && !tracker.attributionAvailable()) {
        target.logger.error('Puppeteer no longer exposes frame ids; document attribution is degraded and unattributed observations stay in payment scope.')
      }
      const documentOf = (response: HTTPResponse): DocumentId | undefined => tracker?.documentOf(response.request())

      // Called by every reload recovery, on every step, just before it
      // navigates: records the document about to be replaced. If that cannot
      // be read, scoping is abandoned for the run rather than risk scoping out
      // a failed render of the payment page. Unused without a marker.
      const declaresPaymentPage = getPuppeteerWorkflowFromTarget(target).locatorActions.some((step) => step.paymentPage === true)
      const recordRecovery = declaresPaymentPage
        ? async (): Promise<void> => {
            const replaced = await tracker?.currentDocument()
            if (replaced === undefined) paymentDocumentUnresolved = true
            else recoveryReplaced.add(replaced)
          }
        : undefined

      // Bootstrap page. The document is read synchronously when the response
      // arrives, before any await, so it names the document that issued it.
      page
        .on('request', (request) => pendingScriptReads.trackRequest(request, currentStep, (issued) => tracker?.documentOf(issued)))
        .on('requestfailed', (request) => pendingScriptReads.requestSettled(request))
        .on('requestfinished', (request) => pendingScriptReads.requestSettled(request))
        .on('response', (response) => {
          const document = documentOf(response)
          pendingScriptReads.track(scriptResponseHandler(response, externalScripts, document, { unread: unreadScripts, step: currentStep, sealed: () => scriptsSealed }), response, document, currentStep)
        })
        .on('response', (response) =>
          headerResponseHandler(response, headers, responses, target.url, inventoryHeaders, target.workflowId ?? 'default', target.type, tracker === undefined ? undefined : { document: documentOf(response), documents: headerDocuments }),
        )

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
      const initialWorkflowDeadline = Date.now() + INITIAL_WORKFLOW_TIMEOUT_MS
      try {
        await this.navigateToTarget(page, navigationUrl, target, initialWorkflowDeadline, recordRecovery)
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
        tracker?.ledger.setStep(currentStepIndex)
        currentStep = currentStepIndex

        try {
          await this.waitForStepDelay(step.delay, index, initialWorkflowDeadline)
          const actionTarget =
            index === 0 && navigationUrl !== undefined
              ? await this.waitForInitialActionTarget(page, step, navigationUrl, target, initialWorkflowDeadline, recordRecovery)
              : await this.waitForRecoverableActionTarget(page, step, target, recordRecovery)

          // The payment page is the document in which a marked step's target
          // was found. Read it now, before the action runs: a "Pay" click that
          // navigates away must not move the marker onto the next page.
          if (step.paymentPage === true) {
            const paymentDocument = await this.resolvePaymentDocument(page, step, actionTarget, tracker)
            if (paymentDocument === undefined) {
              paymentDocumentUnresolved = true
              target.logger.error(`Could not identify the payment page document at step ${currentStepIndex}; the whole run stays in payment scope.`)
            } else {
              paymentDocuments.add(paymentDocument)
            }
          }

          // Execute action
          await this.executeAction(page, actionTarget, step, target, browser, () => {
            retryBoundaryCrossed = true
          })

          // Detect and add new inline scripts on each workflow action
          const newInlineScripts = await this.detectNewInlineScripts(page, internalScripts, scriptContentMatchers, tracker)
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

      // Let in-flight script requests and body reads finish while the DevTools
      // session they need is still open, then account for any that did not.
      for (const { phase, ...unsettled } of await pendingScriptReads.settle(SCRIPT_READ_SETTLE_TIMEOUT_MS)) {
        const reading = phase === 'reading'
        target.logger.error(`Script ${redactUrl(unsettled.url)} (step ${unsettled.step}) ${reading ? 'was still being read' : 'had not received a response'} when the workflow finished; recorded as unread.`)
        recordUnreadScript(unreadScripts, { ...unsettled, reason: reading ? SCRIPT_READ_UNFINISHED_REASON : SCRIPT_REQUEST_UNANSWERED_REASON })
      }
      // The run is accounted for from here: a read that lands late is recorded
      // as unread rather than compared (UnreadScriptAccounting.sealed), and a
      // read that fails a second time as the context closes is the same gap,
      // deduplicated by recordUnreadScript. The arrays stay live rather than
      // being copied, so a record made while the context closes is not lost.
      scriptsSealed = true
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
      throw new WorkflowAttemptError(e, retryBoundaryCrossed)
    } finally {
      // Closes the page and discards cookies/storage. Log-and-continue on
      // failure so cleanup can never mask a workflow error.
      await context.close().catch((closeError) => target.logger.error(`Failed to close browser context: ${closeError}`))
      // A read the close cut off rejects a moment later; give it that moment
      // so its record lands before the summary is built from these arrays.
      await pendingScriptReads.settle(SCRIPT_READ_CLOSE_GRACE_MS)
    }

    const declared = puppeteerWorkflow.locatorActions.some((step: PuppeteerLocatorAction) => step.paymentPage === true)
    const documents = tracker?.ledger.documents() ?? []
    const paymentScope = { declared, paymentDocuments: paymentDocumentUnresolved ? [] : [...paymentDocuments], documents, recoveryReplaced: [...recoveryReplaced] }
    const outside = outsidePaymentDocuments(paymentScope)
    if (outside !== null) {
      const outsidePages = documents.filter((document) => outside.has(document.id)).map((document) => redactUrl(document.url))
      target.logger.log(
        `Payment page scope: ${outsidePages.length} page(s) loaded before the payment page (${outsidePages.join(', ') || 'none'}) are recorded as outside the payment page and not alerted on; the payment page and every page after it are in scope.`,
      )
    }

    if (unreadScripts.length > 0) {
      target.logger.error(`${unreadScripts.length} script response(s) could not be read and were not compared: ${unreadScripts.map((unread) => redactUrl(unread.url)).join(', ')}`)
    }

    return {
      target: target,
      scriptSummary: {
        externalScripts: externalScripts,
        inlineScripts: internalScripts,
        unreadScripts: unreadScripts,
      },
      headerSummary: {
        headers: headers,
        responses,
        ...(tracker === undefined ? {} : { documents: headerDocuments }),
      },
      paymentScope,
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
   * Ask Chrome to keep response bodies outside the renderer
   * (`Network.configureDurableMessages`), so a body can still be read after
   * its document has gone.
   *
   * Without it Chrome keeps a document's response bodies in the renderer and
   * discards them once a navigation away from that document is under way:
   * `Network.getResponseBody` then fails with "No resource with given
   * identifier found" (Puppeteer rewrites it to "Could not load response body
   * for this request. This might happen if the request is a preflight
   * request."). Every script that finishes loading between a click and the
   * navigation it triggers is lost that way — on a payment page, the scripts
   * a "Pay" click pulls in on its way to 3-D Secure.
   *
   * The setting belongs to the page, not to the DevTools session that sends
   * it, so a dedicated session is enough for Puppeteer's own body reads to
   * benefit. It does not reach out-of-process iframes, whose bodies go with
   * their own session when the frame is torn down. Best effort: on a Chrome
   * without the command the run continues, and any body that cannot be read
   * is recorded as unread rather than lost.
   */
  private async retainResponseBodies(page: Page, target: Target): Promise<void> {
    try {
      const session = await page.createCDPSession()
      await session.send('Network.enable')
      await session.send('Network.configureDurableMessages', { maxTotalBufferSize: RETAINED_RESPONSE_BODIES_TOTAL_BYTES, maxResourceBufferSize: RETAINED_RESPONSE_BODY_MAX_BYTES })
    } catch (error) {
      target.logger.error(`Could not ask Chrome to retain response bodies across navigation (${error}); scripts that finish loading as the page navigates away may be recorded as unread.`)
    }
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

  private async executeAction(page: Page, actionTarget: ActionTarget, step: PuppeteerLocatorAction, target: Target, browser: Browser, markRetryBoundary: () => void = () => undefined): Promise<void> {
    try {
      // The target has already been resolved at this point, so mark the
      // boundary immediately before dispatching the potentially side-effecting
      // action. A timeout while locating the action remains safe to retry.
      if (step.retryBoundary === true || (step.action.type === 'click' && step.action.waitForResponse !== undefined)) {
        markRetryBoundary()
      }

      // Execute action
      switch (step.action.type) {
        case 'click': {
          const action: PuppeteerClickAction = step.action
          const completionSignals: Promise<unknown>[] = []
          if (action.waitForNavigation) completionSignals.push(this.waitForActionNavigation(page, actionTarget.context))
          if (action.waitForResponse !== undefined) {
            const responsePattern = new RegExp(action.waitForResponse)
            const responseBodyPattern = action.waitForResponseBody === undefined ? undefined : new RegExp(action.waitForResponseBody)
            completionSignals.push(
              page.waitForResponse(
                async (response) => {
                  // Ignore CORS preflight: it uses the same URL but is not the
                  // application response that proves the operation occurred.
                  const method = response.request().method()
                  if (method === 'OPTIONS' || !responsePattern.test(response.url())) return false
                  if (action.waitForResponseMethod !== undefined && method !== action.waitForResponseMethod) return false
                  if (action.waitForResponseStatuses !== undefined && !action.waitForResponseStatuses.includes(response.status())) return false
                  // Keep the body read inside Puppeteer's response predicate so
                  // the configured timeout bounds the whole completion signal
                  // and bodyless matchers still wait for the response to finish.
                  try {
                    const body = await response.content()
                    return responseBodyPattern === undefined || responseBodyPattern.test(new TextDecoder().decode(body))
                  } catch {
                    // Chrome can discard bodies during navigation or redirects.
                    // URL/method/status-only waits do not depend on the bytes;
                    // body-constrained waits must keep looking for proof.
                    return responseBodyPattern === undefined
                  }
                },
                action.waitForResponseTimeout === undefined ? undefined : { timeout: action.waitForResponseTimeout },
              ),
            )
          }
          completionSignals.push(this.evalClick(actionTarget, step))
          await Promise.all(completionSignals)
          break
        }

        case 'input': {
          const action: PuppeteerInputAction = step.action
          if (actionTarget.element) {
            await this.typeIntoFramedInput(actionTarget, step, action.value)
          } else {
            // Resolve a fresh element for the DOM click, then let Locator
            // re-resolve again if the framework replaces it before filling.
            // Input modals can animate continuously under load, so fill does
            // not require an identical bounding box across consecutive frames;
            // Locator still checks visibility and enabled state.
            await this.evalClick(actionTarget, step)
            await actionTarget.context.locator(step.querySelector).setWaitForStableBoundingBox(false).fill(action.value)
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
                const innerActionTarget = await this.waitForRecoverableActionTarget(popupPage, innerStep, target)
                await this.executeAction(popupPage, innerActionTarget, innerStep, target, browser, markRetryBoundary)
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
      if (step.postActionDelay !== undefined) {
        await this.sleep(step.postActionDelay)
      }
    } finally {
      await actionTarget.element?.dispose().catch(() => undefined)
    }
  }

  /**
   * Hosted payment fields can drop key events while formatting under load.
   * Verify the retained value before a later payment click; retrying input is
   * side-effect-free, unlike retrying the click that submits the payment.
   */
  private async typeIntoFramedInput(actionTarget: ActionTarget, step: PuppeteerLocatorAction, expectedValue: string): Promise<void> {
    const element = actionTarget.element
    if (!element) throw new Error('Framed input target did not include an element handle')

    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt === 1) {
        await this.evalClick(actionTarget, step)
      } else {
        await element.evaluate((candidate) => {
          const input = candidate as HTMLInputElement
          input.focus()
          input.select()
        })
      }

      await element.type(expectedValue, { delay: FRAMED_INPUT_TYPING_DELAY_MS })
      const actualValue = await element.evaluate((candidate) => (candidate as HTMLInputElement).value)
      const matches = /^\d+$/.test(expectedValue) ? actualValue.replace(/\D/g, '') === expectedValue : actualValue === expectedValue
      if (matches) return
    }

    throw new Error(`Framed input did not retain the expected value after ${maxAttempts} attempts: ${step.querySelector}`)
  }

  /**
   * Dispatch a DOM click without Locator.click()'s stable-bounding-box wait.
   * The Locator retries only side-effect-free preconditions. The final pinned
   * click uses a pinned handle and returns structured pre-dispatch outcomes.
   * Missing, detached, or disabled candidates are safe to re-resolve; any
   * thrown evaluation/navigation failure is ambiguous and never replayed.
   */
  private async evalClick(actionTarget: ActionTarget, step: PuppeteerLocatorAction): Promise<void> {
    if (actionTarget.element) {
      await actionTarget.element.evaluate((element) => (element as HTMLElement).click())
    } else {
      const maxSafeAttempts = 3
      for (let attempt = 1; ; attempt++) {
        await actionTarget.context
          .locator(step.querySelector)
          .setVisibility('visible')
          .map((element) => {
            const clickable = element as HTMLElement
            if (!clickable.isConnected) throw new Error('Element was replaced before it could be clicked')
            if ((clickable as HTMLElement & { disabled?: boolean }).disabled === true) throw new Error('Element is disabled')
            return true
          })
          .wait()

        const element = await actionTarget.context.$(step.querySelector)
        if (element === null) {
          if (attempt >= maxSafeAttempts) throw new Error(`Element disappeared before it could be clicked: ${step.querySelector}`)
          continue
        }

        try {
          const outcome = await element.evaluate((candidate): 'clicked' | 'detached' | 'disabled' => {
            const clickable = candidate as HTMLElement
            if (!clickable.isConnected) return 'detached'
            if ((clickable as HTMLElement & { disabled?: boolean }).disabled === true) return 'disabled'
            clickable.click()
            return 'clicked'
          })
          if (outcome === 'clicked') return
          if (attempt >= maxSafeAttempts) throw new Error(`Element remained ${outcome} before it could be clicked: ${step.querySelector}`)
        } finally {
          await element.dispose().catch(() => undefined)
        }
      }
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

  private async waitForActionTarget(page: Page, step: PuppeteerLocatorAction, timeout = page.getDefaultTimeout()): Promise<ActionTarget> {
    if (!step.frameUrl) {
      await page.locator(step.querySelector).setTimeout(timeout).wait()
      return { context: page }
    }

    const matcher = new RegExp(step.frameUrl)
    const deadline = Date.now() + timeout

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

  /**
   * The document in which a marked step's target was found, or undefined
   * when that cannot be established. The target was found a moment ago and a
   * top-level navigation could commit in between, so the read is bracketed:
   * read the current document, confirm the target is still there — the found
   * element still attached for a framed step, the selector still matching for
   * a top-level one — and read the document again. Only an unchanged document
   * with the target present is the payment page; anything else is treated as
   * unresolved, which keeps the whole run in scope.
   */
  private async resolvePaymentDocument(page: Page, step: PuppeteerLocatorAction, actionTarget: ActionTarget, tracker: DocumentTracker | undefined): Promise<DocumentId | undefined> {
    if (tracker === undefined) return undefined
    const before = await tracker.currentDocument()
    let present: boolean
    try {
      present = actionTarget.element === undefined ? (await page.$(step.querySelector)) !== null : await actionTarget.element.evaluate((element) => element.isConnected)
    } catch {
      present = false
    }
    const after = await tracker.currentDocument()
    return present && before !== undefined && before === after ? before : undefined
  }

  private async waitForRecoverableActionTarget(page: Page, step: PuppeteerLocatorAction, target: Target, onRecovery?: () => Promise<void>): Promise<ActionTarget> {
    if (!step.reloadOnMissingTarget) return this.waitForActionTarget(page, step)
    if (step.frameUrl === undefined) throw new Error('Missing-target recovery requires a trusted frameUrl')

    try {
      return await this.waitForActionTarget(page, step, Math.min(30000, page.getDefaultTimeout()))
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error
      target.logger.log(`Workflow target did not render; reloading the current page once before retrying.`)
      const recoveryUrl = new URL(page.url())
      if (recoveryUrl.protocol !== 'https:') throw new Error('Missing-target recovery requires a current HTTPS page URL', { cause: error })
      // Use an explicit GET navigation. Browser reload can resubmit a POST
      // that produced the current document and replay a prior side effect.
      await onRecovery?.()
      await page.goto(recoveryUrl.href, { waitUntil: 'networkidle2' })
      return this.waitForActionTarget(page, step)
    }
  }

  private async waitForInitialActionTarget(page: Page, step: PuppeteerLocatorAction, navigationUrl: string, target: Target, deadline = Date.now() + INITIAL_WORKFLOW_TIMEOUT_MS, onRecovery?: () => Promise<void>): Promise<ActionTarget> {
    const attemptTimeouts = [30000, 30000, page.getDefaultTimeout()]
    for (const [index, configuredTimeout] of attemptTimeouts.entries()) {
      try {
        const remainingTime = deadline - Date.now()
        if (remainingTime <= 0) throw new TimeoutError('Timed out preparing initial workflow content')
        const timeout = Math.min(configuredTimeout, remainingTime)
        return await this.waitForActionTarget(page, step, timeout)
      } catch (error) {
        const isFinalAttempt = index === attemptTimeouts.length - 1
        if (!(error instanceof Error) || error.name !== 'TimeoutError' || isFinalAttempt || Date.now() >= deadline) throw error

        target.logger.log(`Initial workflow content did not render; reloading (${index + 2}/${attemptTimeouts.length}).`)
        await onRecovery?.()
        await this.navigateToTarget(page, navigationUrl, target, deadline, onRecovery)
      }
    }
    throw new Error('Initial action target retry loop exhausted unexpectedly')
  }

  private async waitForStepDelay(delay: number, stepIndex: number, initialWorkflowDeadline: number): Promise<void> {
    if (delay <= 0) return
    if (stepIndex !== 0) {
      await this.sleep(delay)
      return
    }

    const remainingTime = initialWorkflowDeadline - Date.now()
    if (remainingTime <= 0) throw new TimeoutError('Timed out preparing initial workflow content')
    await this.sleep(Math.min(delay, remainingTime))
    if (delay >= remainingTime || Date.now() >= initialWorkflowDeadline) throw new TimeoutError('Timed out preparing initial workflow content')
  }

  private async navigateToTarget(page: Page, url: string, target: Target, deadline = Date.now() + INITIAL_WORKFLOW_TIMEOUT_MS, onRecovery?: () => Promise<void>): Promise<void> {
    const maxAttempts = 3
    for (let attempt = 1; ; attempt++) {
      try {
        const remainingTime = deadline - Date.now()
        if (remainingTime <= 0) throw new TimeoutError('Timed out preparing initial workflow content')
        await page.goto(url, { waitUntil: 'networkidle2', timeout: Math.min(NAVIGATION_ATTEMPT_TIMEOUT_MS, remainingTime) })
        return
      } catch (error) {
        if (!this.isRetryableNavigationError(error) || attempt >= maxAttempts || Date.now() >= deadline) {
          throw error
        }
        target.logger.log(`Transient initial navigation failure; retrying (${attempt + 1}/${maxAttempts}).`)
        await this.sleep(Math.min(attempt * 1000, Math.max(0, deadline - Date.now())))
        await onRecovery?.()
      }
    }
  }

  private isRetryableNavigationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.name === 'TimeoutError' || error.message.includes('Navigating frame was detached') || error.message.includes('net::ERR_NETWORK_CHANGED')
  }

  private isRetryableWorkflowError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (error.name === 'TimeoutError') return true

    const message = error.message.toLowerCase()
    return [
      'navigating frame was detached',
      'frame was detached',
      'execution context was destroyed',
      'cannot find context with specified id',
      'node is detached',
      'target closed',
      'net::err_network_changed',
      'net::err_connection_reset',
      'net::err_connection_closed',
      'net::err_timed_out',
    ].some((fragment) => message.includes(fragment))
  }

  private redactFrameUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return redactUrl(url)
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
    return scheme ? `${scheme}:<redacted>` : '<unparseable>'
  }

  /**
   * Inline scripts are read from whichever document is current. Attribute
   * them only when the same document was current before and after the scan;
   * a navigation in between leaves them unattributed, which keeps them in
   * payment scope. Dedupe by (hash, document), so the payment page's copy of a
   * script an earlier page also ran is kept rather than lost to scoping.
   */
  private async detectNewInlineScripts(page: Page, existingScripts: ScriptInfo[], scriptContentMatchers: ScriptMatcher[], tracker?: DocumentTracker): Promise<ScriptInfo[]> {
    const before = await tracker?.currentDocument()
    const detectedInlineScripts = await this.getInlineScriptsSettled(page, scriptContentMatchers)
    const after = await tracker?.currentDocument()
    const document = before !== undefined && before === after ? before : undefined
    const attributed = document === undefined ? detectedInlineScripts : detectedInlineScripts.map((script) => ({ ...script, document }))
    return attributed.filter((detectedScript) => !existingScripts.some((existingScript) => existingScript.hash.value === detectedScript.hash.value && existingScript.document === detectedScript.document))
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
