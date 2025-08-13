import type { WorkflowDefinition } from 'src/types/workflow'

export const uatWorkflow: WorkflowDefinition = {
  startingPoint: 'https://staging.meandu.app/demo-miss-jones/dine-in?sheet=table-number',
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
        type: 'navigate'
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
  ],
}
