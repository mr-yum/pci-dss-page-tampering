import type { WorkflowDefinition } from '../types/workflow'

export const uatWorkflow: WorkflowDefinition = {
  steps: [
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
        waitForNavigation: true,
      },
    },
    {
      description: 'Navigate to "Food" category',
      waitFor: [
        {
          type: 'href',
          identifier: '/pcidsscompliance/dine-in/food',
        },
      ],
      action: {
        type: 'navigate',
        waitForNavigation: true,
      },
    },
    {
      description: 'Click on "Vermicelli Beef Noodle Soup"',
      waitFor: [
        {
          type: 'href',
          identifier: '/pcidsscompliance/dine-in/food/noodles/bun-bo-hue-04cz8zv9h',
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
          identifier: '/pcidsscompliance/checkout/dine-in/cart',
        },
      ],
      action: {
        type: 'navigate',
        waitForNavigation: true,
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
    },
    {
      description: 'Continue with verification process',
      waitFor: [
        {
          type: 'button',
          identifier: 'Continue',
        },
      ],
      action: {
        type: 'click',
        waitForNavigation: true,
      },
    },
    {
      description: 'Input pin code for verification',
      waitFor: [
        {
          type: 'input',
          identifier: 'pincode',
        },
      ],
      action: {
        type: 'input',
        value: '3066',
      },
    },
    {
      description: 'Pay for order',
      waitFor: [
        {
          type: 'button',
          identifier: 'Pay now',
        },
      ],
      action: {
        type: 'click',
        waitForNavigation: true,
      },
    },
    // {
    //   description: 'Escape experience popup',
    //   waitFor: [
    //     {
    //       type: 'h3',
    //       identifier: 'How’s your experience going at PCI DSS Compliance?',
    //     },
    //   ],
    //   action: {
    //     type: 'escape',
    //   },
    // },
  ],
}
