import type { Browser } from 'puppeteer'
import type { ScriptInfo } from '../types/scriptInfo'
import { scriptResponseHandler } from '../handlers/script'
import type { WaitForDefinition, WorkflowDefinition } from '../models/workflow'

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

  async getPageScripts(url: string): Promise<ScriptInfo[]> {
    const detectedScripts: ScriptInfo[] = []
    const workflow: WorkflowDefinition = {
      startingPoint:
        'https://app-dev.meandu.com/qr?t=6696197365006d7f86a581ea_default&r=au',
      steps: [
        {
          description: 'Press pay or split',
          waitFor: [
            {
              type: 'button',
              identifier: 'Pay or split',
            },
          ],
          action: {
            type: 'click',
          },
        },
        {
          description: 'Press pay balance',
          waitFor: [
            {
              type: 'button',
              identifier: 'Pay balance',
            },
          ],
          action: {
            type: 'click',
          },
        },
        {
          description: 'Fill out card number',
          waitFor: [
            {
              type: 'div',
              identifier: 'payment-method__add-card__field-number',
            },
          ],
          action: {
            type: 'input',
            value: '42424242424242424242',
          },
        },
        {
          description: 'Fill out card expiry',
          waitFor: [
            {
              type: 'div',
              identifier: 'payment-method__add-card__field-expiry',
            },
          ],
          action: {
            type: 'input',
            value: '1242',
          },
        },
        {
          description: 'Fill out card CVV',
          waitFor: [
            {
              type: 'div',
              identifier: 'payment-method__add-card__field-cvv',
            },
          ],
          action: {
            type: 'input',
            value: '123',
          },
        },
        {
          description: 'Click select payment',
          waitFor: [
            {
              type: 'div',
              identifier: 'payment-methods__submit__container',
            },
          ],
          action: {
            type: 'click',
          },
        },
        {
          description: 'Click continue to payment',
          waitFor: [
            {
              type: 'div',
              identifier: 'pay-only-review-payment__footer',
            },
          ],
          action: {
            type: 'click',
          },
        },
        {
          description: 'Click continue to payment',
          waitFor: [
            {
              type: 'button',
              identifier: 'Pay: $217.57',
            },
          ],
          action: {
            type: 'click',
          },
        },
      ],
    }

    const stepToLocator = (waitFor: WaitForDefinition) => {
      switch (waitFor.type) {
        case 'div':
          return `div.${waitFor.identifier}`
        case 'button':
          return `button ::-p-text(${waitFor.identifier})`
      }
    }

    try {
      const page = await this._browser.newPage()
      page.on('response', (response) =>
        scriptResponseHandler(response, detectedScripts),
      )

      // Navigate to workflow starting point
      await page.goto(workflow.startingPoint, { waitUntil: 'networkidle0' })

      // Map workflow into query selectors
      const querySelectors = workflow.steps.map((step) => {
        const querySelector = step.waitFor.map(stepToLocator).join(' ')
        return {
          querySelector: querySelector,
          locator: page.locator(querySelector),
          action: step.action,
        }
      })

      // Begin workflow
      for (const querySelector of querySelectors) {
        switch (querySelector.action.type) {
          case 'click':
            await querySelector.locator.click()
            break
          case 'input':
            await querySelector.locator
              .click()
              .then(() =>
                page.type(
                  querySelector.querySelector,
                  querySelector.action.value!,
                ),
              )
            break
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
