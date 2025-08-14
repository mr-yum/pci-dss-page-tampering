import type { WorkflowDefinition } from 'src/types/workflow'

export const uatWorkflow: WorkflowDefinition = {
  startingPoint: 'https://staging.meandu.app/demo-miss-jones',
  steps: [
    {
      description: 'Escape initial popup',
      waitFor: [
        {
          type: 'h2',
          identifier: 'How would you like to order?',
        },
      ],
      action: {
        type: 'escape',
      },
    },
    {
      description: 'Navigate to "On Tap" category',
      waitFor: [
        {
          type: 'href',
          identifier: '/demo-miss-jones/dine-in/on-tap',
        },
      ],
      action: {
        type: 'navigate',
      },
    },
    {
      description: 'Dismiss team message popup',
      waitFor: [
        {
          type: 'button',
          identifier: 'Thanks!',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Click on "Balter XPA"',
      waitFor: [
        {
          type: 'href',
          identifier: '/demo-miss-jones/dine-in/on-tap/beer/balter-xpa-2hqvfmi9g',
        },
      ],
      action: {
        type: 'navigate',
      },
    },
    {
      description: 'Add item to order',
      waitFor: [
        {
          type: 'button',
          identifier: 'Add to order',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Checkout order',
      waitFor: [
        {
          type: 'href',
          identifier: '/demo-miss-jones/checkout/dine-in/cart',
        },
      ],
      action: {
        type: 'navigate',
        waitForNavigation: true,
      },
    },
    {
      description: 'Add table number to order',
      waitFor: [
        {
          type: 'button',
          identifier: 'Add',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Input table number',
      waitFor: [
        {
          type: 'input',
          identifier: 'tableNumber',
        },
      ],
      action: {
        type: 'input',
        value: '12',
      },
    },
    {
      description: 'Confirm table number',
      waitFor: [
        {
          type: 'button',
          identifier: 'Confirm',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Continue with checkout process',
      waitFor: [
        {
          type: 'button',
          identifier: 'Continue',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Add tip and continue with checkout process',
      waitFor: [
        {
          type: 'button',
          identifier: 'Add tip and pay',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Input phone number for verification',
      waitFor: [
        {
          type: 'input',
          identifier: 'mobile',
        },
      ],
      action: {
        type: 'input',
        value: '0400000000',
      },
    }
  ],
}
