import type { Browser, ElementHandle, Frame, Page } from 'puppeteer'

import type { PuppeteerLocatorAction } from '../types/puppeteer.js'
import type { Target } from '../types/target.js'
import { DetectionService } from './detection.js'

jest.mock('puppeteer', () => ({
  TimeoutError: class TimeoutError extends Error {},
}))

type DetectionServiceInternals = {
  executeAction(page: Page, actionTarget: { context: Page | Frame; element?: ElementHandle<Element> }, step: PuppeteerLocatorAction, target: Target, browser: Browser): Promise<void>
  navigateToTarget(page: Page, url: string, target: Target): Promise<void>
  sleep(ms: number): Promise<void>
  waitForActionTarget(page: Page, step: PuppeteerLocatorAction, timeout?: number): Promise<{ context: Page | Frame; element?: ElementHandle<Element> }>
  waitForInitialActionTarget(page: Page, step: PuppeteerLocatorAction, navigationUrl: string, target: Target): Promise<{ context: Page | Frame; element?: ElementHandle<Element> }>
  redactFrameUrl(url: string): string
}

const target = {} as Target
const browser = {} as Browser

function serviceInternals(): DetectionServiceInternals {
  return new DetectionService() as unknown as DetectionServiceInternals
}

describe('DetectionService framed workflow actions', () => {
  it('retries a transient initial navigation failure', async () => {
    const page = {
      goto: jest.fn().mockRejectedValueOnce(new Error('net::ERR_NETWORK_CHANGED at https://example.com')).mockResolvedValue(null),
    } as unknown as Page
    const logger = { log: jest.fn() }
    const workflowTarget = { logger } as unknown as Target
    const service = serviceInternals()
    service.sleep = jest.fn().mockResolvedValue(undefined)

    await service.navigateToTarget(page, 'https://example.com', workflowTarget)

    expect(page.goto).toHaveBeenCalledTimes(2)
    expect(page.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'networkidle2' })
    expect(service.sleep).toHaveBeenCalledWith(1000)
    expect(logger.log).toHaveBeenCalledWith('Transient initial navigation failure; retrying (2/3).')
  })

  it('fails after exhausting transient initial navigation retries', async () => {
    const firstError = new Error('Navigating frame was detached')
    const secondError = new Error('Navigating frame was detached')
    const finalError = new Error('Navigating frame was detached')
    const page = {
      goto: jest.fn().mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError).mockRejectedValueOnce(finalError),
    } as unknown as Page
    const workflowTarget = { logger: { log: jest.fn() } } as unknown as Target
    const service = serviceInternals()
    service.sleep = jest.fn().mockResolvedValue(undefined)

    await expect(service.navigateToTarget(page, 'https://example.com', workflowTarget)).rejects.toBe(finalError)

    expect(page.goto).toHaveBeenCalledTimes(3)
    expect(service.sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(service.sleep).toHaveBeenNthCalledWith(2, 2000)
  })

  it('reloads when the first workflow selector does not render', async () => {
    const firstTimeout = Object.assign(new Error('selector did not render'), { name: 'TimeoutError' })
    const wait = jest.fn().mockRejectedValueOnce(firstTimeout).mockResolvedValue(undefined)
    const setTimeout = jest.fn().mockReturnValue({ wait })
    const page = {
      getDefaultTimeout: jest.fn().mockReturnValue(120000),
      locator: jest.fn().mockReturnValue({ setTimeout }),
      goto: jest.fn().mockResolvedValue(null),
    } as unknown as Page
    const logger = { log: jest.fn() }
    const workflowTarget = { logger } as unknown as Target
    const step: PuppeteerLocatorAction = {
      description: 'Select booking slot',
      querySelector: '[data-testid="availability-slot-group"] button:enabled',
      action: { type: 'click', waitForNavigation: false },
      delay: 0,
    }

    await expect(serviceInternals().waitForInitialActionTarget(page, step, 'https://booking.example.com/venue', workflowTarget)).resolves.toEqual({ context: page })

    expect(setTimeout).toHaveBeenNthCalledWith(1, 30000)
    expect(setTimeout).toHaveBeenNthCalledWith(2, 30000)
    expect(page.goto).toHaveBeenCalledWith('https://booking.example.com/venue', { waitUntil: 'networkidle2' })
    expect(logger.log).toHaveBeenCalledWith('Initial workflow content did not render; reloading (2/3).')
  })

  it('re-resolves a main-page input when the visible element is replaced', async () => {
    const clickWait = jest.fn().mockResolvedValue(true)
    let clickMapper: ((element: HTMLElement) => boolean) | undefined
    const map = jest.fn().mockImplementation((mapper: (element: HTMLElement) => boolean) => {
      clickMapper = mapper
      return { wait: clickWait }
    })
    const setVisibility = jest.fn().mockReturnValue({ map })
    const fill = jest.fn().mockResolvedValue(undefined)
    const fillStableBox = jest.fn().mockReturnValue({ fill })
    const page = {
      locator: jest.fn().mockReturnValueOnce({ setVisibility }).mockReturnValueOnce({ setWaitForStableBoundingBox: fillStableBox }),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Enter guest name',
      querySelector: 'input[name="name"]',
      action: { type: 'input', value: 'PCI Monitor' },
      delay: 0,
    }

    await serviceInternals().executeAction(page, { context: page }, step, target, browser)

    expect(page.locator).toHaveBeenNthCalledWith(1, step.querySelector)
    expect(setVisibility).toHaveBeenCalledWith('visible')
    expect(map).toHaveBeenCalledWith(expect.any(Function))
    const domClick = jest.fn()
    expect(() => clickMapper?.({ click: domClick, isConnected: false } as unknown as HTMLElement)).toThrow('Input element was replaced before it could be clicked')
    expect(() => clickMapper?.({ click: domClick, disabled: true, isConnected: true } as unknown as HTMLElement)).toThrow('Input element is disabled')
    expect(clickMapper?.({ click: domClick, disabled: false, isConnected: true } as unknown as HTMLElement)).toBe(true)
    expect(domClick).toHaveBeenCalledTimes(1)
    expect(clickWait).toHaveBeenCalledTimes(1)
    expect(page.locator).toHaveBeenNthCalledWith(2, step.querySelector)
    expect(fillStableBox).toHaveBeenCalledWith(false)
    expect(fill).toHaveBeenCalledWith('PCI Monitor')
  })

  it("applies the parent page's timeouts to a popup workflow", async () => {
    let popupListener: ((popup: Page) => void) | undefined
    const popupPage = {
      on: jest.fn().mockReturnThis(),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
    } as unknown as Page
    const page = {
      on: jest.fn().mockImplementation((event: string, listener: (popup: Page) => void) => {
        if (event === 'popup') popupListener = listener
      }),
      off: jest.fn(),
      getDefaultTimeout: jest.fn().mockReturnValue(120000),
      getDefaultNavigationTimeout: jest.fn().mockReturnValue(90000),
    } as unknown as Page
    const element = {
      evaluate: jest.fn().mockImplementation(async () => popupListener?.(popupPage)),
      dispose: jest.fn().mockResolvedValue(undefined),
    } as unknown as ElementHandle<Element>
    const workflowBrowser = {
      userAgent: jest.fn().mockResolvedValue('Mozilla/5.0 HeadlessChrome/140.0.0.0'),
      version: jest.fn().mockResolvedValue('HeadlessChrome/140.0.0.0'),
    } as unknown as Browser
    const step: PuppeteerLocatorAction = {
      description: 'Open payment popup',
      querySelector: 'button[type="submit"]',
      action: { type: 'clickPopup', steps: [], waitForNavigation: false },
      delay: 0,
    }

    await serviceInternals().executeAction(page, { context: page, element }, step, target, workflowBrowser)

    expect(popupPage.setDefaultTimeout).toHaveBeenCalledWith(120000)
    expect(popupPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(90000)
  })

  it('waits for navigation on the selected frame', async () => {
    const callOrder: string[] = []
    const frame = {
      waitForNavigation: jest.fn().mockImplementation(() => {
        callOrder.push('wait')
        return Promise.resolve(null)
      }),
    } as unknown as Frame
    const element = {
      evaluate: jest.fn().mockImplementation(() => {
        callOrder.push('click')
        return Promise.resolve(undefined)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    } as unknown as ElementHandle<Element>
    const page = {
      waitForNavigation: jest.fn().mockReturnValue(new Promise(() => undefined)),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Continue inside payment frame',
      querySelector: 'button[type="submit"]',
      frameUrl: '^https://payments\\.example\\.com/card-frame$',
      action: { type: 'click', waitForNavigation: true },
      delay: 0,
    }

    await serviceInternals().executeAction(page, { context: frame, element }, step, target, browser)

    expect(frame.waitForNavigation).toHaveBeenCalledTimes(1)
    expect(page.waitForNavigation).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['wait', 'click'])
  })

  it('registers a response waiter before clicking and waits for the matching response', async () => {
    const callOrder: string[] = []
    const matchingResponse = {
      url: () => 'https://api.payments.example/v1/payment_methods?client=browser',
      request: () => ({ method: () => 'POST' }),
      status: () => 402,
      content: jest.fn().mockImplementation(async () => {
        callOrder.push('body')
        return new TextEncoder().encode('{"error":{"code":"card_declined"}}')
      }),
    }
    const page = {
      waitForResponse: jest.fn().mockImplementation(async (predicate: (response: { url(): string; request(): { method(): string }; status(): number; content(): Promise<Uint8Array> }) => Promise<boolean>) => {
        callOrder.push('wait')
        const preflightResponse = {
          url: matchingResponse.url,
          request: () => ({ method: () => 'OPTIONS' }),
          status: () => 204,
          content: jest.fn().mockResolvedValue(new Uint8Array()),
        }
        expect(await predicate(preflightResponse)).toBe(false)
        expect(preflightResponse.content).not.toHaveBeenCalled()
        expect(
          await predicate({
            url: () => 'https://api.payments.example/v1/other',
            request: () => ({ method: () => 'POST' }),
            status: () => 402,
            content: jest.fn().mockResolvedValue(new Uint8Array()),
          }),
        ).toBe(false)
        expect(
          await predicate({
            url: matchingResponse.url,
            request: () => ({ method: () => 'GET' }),
            status: () => 402,
            content: jest.fn().mockResolvedValue(new Uint8Array()),
          }),
        ).toBe(false)
        expect(
          await predicate({
            url: matchingResponse.url,
            request: () => ({ method: () => 'POST' }),
            status: () => 500,
            content: jest.fn().mockResolvedValue(new Uint8Array()),
          }),
        ).toBe(false)
        const wrongBodyResponse = {
          url: matchingResponse.url,
          request: () => ({ method: () => 'POST' }),
          status: () => 402,
          content: jest.fn().mockResolvedValue(new TextEncoder().encode('{"error":{"code":"rate_limit"}}')),
        }
        expect(await predicate(wrongBodyResponse)).toBe(false)
        expect(wrongBodyResponse.content).toHaveBeenCalledTimes(1)
        expect(await predicate(matchingResponse)).toBe(true)
        return matchingResponse
      }),
    } as unknown as Page
    const element = {
      evaluate: jest.fn().mockImplementation(() => {
        callOrder.push('click')
        return Promise.resolve(undefined)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    } as unknown as ElementHandle<Element>
    const step: PuppeteerLocatorAction = {
      description: 'Submit payment details',
      querySelector: 'button[type="submit"]',
      action: {
        type: 'click',
        waitForNavigation: false,
        waitForResponse: '^https://api\\.payments\\.example/v1/payment_methods(?:\\?.*)?$',
        waitForResponseTimeout: 240000,
        waitForResponseMethod: 'POST',
        waitForResponseStatuses: [200, 402],
        waitForResponseBody: '"code"\\s*:\\s*"card_declined"',
      },
      delay: 0,
      postActionDelay: 2500,
    }

    const service = serviceInternals()
    service.sleep = jest.fn().mockImplementation(async () => {
      callOrder.push('settle')
    })
    await service.executeAction(page, { context: page, element }, step, target, browser)

    expect(page.waitForResponse).toHaveBeenCalledTimes(1)
    expect(page.waitForResponse).toHaveBeenCalledWith(expect.any(Function), { timeout: 240000 })
    expect(matchingResponse.content).toHaveBeenCalledTimes(1)
    expect(service.sleep).toHaveBeenCalledWith(2500)
    expect(callOrder).toEqual(['wait', 'click', 'body', 'settle'])
  })

  it('accepts a parent navigation triggered from a selected frame', async () => {
    const frame = {
      waitForNavigation: jest.fn().mockRejectedValue(new Error('frame detached')),
    } as unknown as Frame
    const element = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
    } as unknown as ElementHandle<Element>
    const page = {
      waitForNavigation: jest.fn().mockResolvedValue(null),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Complete payment from frame',
      querySelector: 'button[type="submit"]',
      frameUrl: '^https://payments\\.example\\.com/card-frame$',
      action: { type: 'click', waitForNavigation: true },
      delay: 0,
    }

    await expect(serviceInternals().executeAction(page, { context: frame, element }, step, target, browser)).resolves.toBeUndefined()
  })

  it('focuses a selected frame element before pressing Escape', async () => {
    const frame = {} as Frame
    const element = {
      focus: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
    } as unknown as ElementHandle<Element>
    const page = {
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Dismiss payment frame dialog',
      querySelector: '[role="dialog"]',
      frameUrl: '^https://payments\\.example\\.com/',
      action: { type: 'escape' },
      delay: 0,
    }

    await serviceInternals().executeAction(page, { context: frame, element }, step, target, browser)

    expect(element.focus).toHaveBeenCalledTimes(1)
    expect(page.keyboard.press).toHaveBeenCalledWith('Escape')
  })

  it('never selects the main frame for a frameUrl step', async () => {
    const mainFrame = {
      url: jest.fn().mockReturnValue('https://payments.example.com/checkout'),
      waitForSelector: jest.fn(),
    } as unknown as Frame
    const element = {
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    const childFrame = {
      url: jest.fn().mockReturnValue('https://payments.example.com/card-frame'),
      waitForSelector: jest.fn().mockResolvedValue(element),
    } as unknown as Frame
    const page = {
      getDefaultTimeout: jest.fn().mockReturnValue(1000),
      frames: jest.fn().mockReturnValue([mainFrame, childFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Enter card number',
      querySelector: 'input[name="cardnumber"]',
      frameUrl: '^https://payments\\.example\\.com/',
      action: { type: 'input', value: 'test value' },
      delay: 0,
    }

    await expect(serviceInternals().waitForActionTarget(page, step)).resolves.toEqual({ context: childFrame, element })
    expect(mainFrame.waitForSelector).not.toHaveBeenCalled()
    expect(childFrame.waitForSelector).toHaveBeenCalledWith(step.querySelector, { visible: true, timeout: 100 })
  })

  it('rechecks the frame origin after acquiring its element handle', async () => {
    const mainFrame = {} as Frame
    const replacedElement = {
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    const stableElement = {
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    const replacedFrame = {
      url: jest.fn().mockReturnValueOnce('https://payments.example.com/card-frame').mockReturnValue('https://attacker.example.org/card-frame'),
      waitForSelector: jest.fn().mockResolvedValue(replacedElement),
    } as unknown as Frame
    const stableFrame = {
      url: jest.fn().mockReturnValue('https://payments.example.com/card-frame'),
      waitForSelector: jest.fn().mockResolvedValue(stableElement),
    } as unknown as Frame
    const page = {
      getDefaultTimeout: jest.fn().mockReturnValue(1000),
      frames: jest.fn().mockReturnValue([mainFrame, replacedFrame, stableFrame]),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Enter card number',
      querySelector: 'input[name="cardnumber"]',
      frameUrl: '^https://payments\\.example\\.com/',
      action: { type: 'input', value: 'test value' },
      delay: 0,
    }

    await expect(serviceInternals().waitForActionTarget(page, step)).resolves.toEqual({ context: stableFrame, element: stableElement })
    expect(replacedElement.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not include opaque frame payloads in timeout diagnostics', () => {
    expect(serviceInternals().redactFrameUrl('data:text/html,<p>secret</p>')).toBe('data:<redacted>')
  })
})
