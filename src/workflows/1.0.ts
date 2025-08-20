import type { WorkflowDefinition } from '../types/workflow'

export const uatWorkflow: WorkflowDefinition = {
  steps: [
    {
      description: 'Press on "Pizza"',
      waitFor: [
        {
          type: 'div',
          identifier: 'menu-card__fav',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Add item to cart',
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
      description: 'View cart',
      waitFor: [
        {
          type: 'div',
          identifier: 'view-cart-button',
        },
        {
          type: 'button',
          identifier: 'View cart',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Go to checkout',
      waitFor: [
        {
          type: 'button',
          identifier: 'Go to checkout',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Continue with phone number',
      waitFor: [
        {
          type: 'button',
          identifier: 'Continue with phone number',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Input phone number',
      waitFor: [
        {
          type: 'input',
          identifier: 'phone',
        },
      ],
      action: {
        type: 'input',
        value: '429700869',
      },
    },
    {
      description: 'Continue with checkout process',
      waitFor: [
        {
          type: 'div',
          identifier: 'verify-page__submit',
        },
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
      description: 'Enter verification code',
      waitFor: [
        {
          type: 'input',
          identifier: 'phone-verification',
        },
      ],
      action: {
        type: 'input',
        value: '1111',
      },
    },
    {
      description: 'Dismiss login prompt',
      waitFor: [
        {
          type: 'button',
          identifier: 'Not now',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Send order to kitchen',
      waitFor: [
        {
          type: 'button',
          identifier: 'Send order',
        },
      ],
      action: {
        type: 'click',
      },
    },
    {
      description: 'Dismiss order confirmation popup',
      waitFor: [
        {
          type: 'button',
          identifier: 'OK',
        },
      ],
      action: {
        type: 'click',
      },
    },
    // {
    //   description: 'Dismiss pub+ popup',
    //   waitFor: [
    //     {
    //       type: 'div',
    //       identifier: 'button--back--close',
    //     },
    //   ],
    //   action: {
    //     type: 'click',
    //   },
    // },
  ],
}
