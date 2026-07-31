import type { Browser, ElementHandle, Frame, Page } from 'puppeteer'

import type { PuppeteerLocatorAction } from '../types/puppeteer.js'
import type { Target } from '../types/target.js'
import { DetectionService } from './detection.js'

jest.mock('puppeteer', () => ({
  TimeoutError: class TimeoutError extends Error {},
}))

type DetectionServiceInternals = {
  executeAction(page: Page, actionTarget: { context: Page | Frame; element?: ElementHandle<Element> }, step: PuppeteerLocatorAction, target: Target, browser: Browser): Promise<void>
  waitForActionTarget(page: Page, step: PuppeteerLocatorAction): Promise<{ context: Page | Frame; element?: ElementHandle<Element> }>
  redactFrameUrl(url: string): string
}

const target = {} as Target
const browser = {} as Browser

function serviceInternals(): DetectionServiceInternals {
  return new DetectionService() as unknown as DetectionServiceInternals
}

describe('DetectionService framed workflow actions', () => {
  it('re-resolves a main-page input when the visible element is replaced', async () => {
    const click = jest.fn().mockResolvedValue(undefined)
    const fill = jest.fn().mockResolvedValue(undefined)
    const page = {
      locator: jest.fn().mockReturnValueOnce({ click }).mockReturnValueOnce({ fill }),
    } as unknown as Page
    const step: PuppeteerLocatorAction = {
      description: 'Enter guest name',
      querySelector: 'input[name="name"]',
      action: { type: 'input', value: 'PCI Monitor' },
      delay: 0,
    }

    await serviceInternals().executeAction(page, { context: page }, step, target, browser)

    expect(page.locator).toHaveBeenNthCalledWith(1, step.querySelector)
    expect(click).toHaveBeenCalledTimes(1)
    expect(page.locator).toHaveBeenNthCalledWith(2, step.querySelector)
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
