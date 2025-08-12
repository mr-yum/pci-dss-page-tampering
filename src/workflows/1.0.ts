import { WorkflowDefinition } from 'src/types/workflow'

export const legacyWorkflow: WorkflowDefinition = {
  startingPoint: 'https://app-dev.meandu.com/qr?t=6696197365006d7f86a581ea_default&r=au',
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
          identifier: 'Pay: $',
        },
      ],
      action: {
        type: 'click',
      },
    },
  ],
}
