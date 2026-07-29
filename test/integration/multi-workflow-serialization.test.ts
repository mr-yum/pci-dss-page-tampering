import type { Inventory } from '../../src/types/inventory/model.js'
import { RawInventorySchema } from '../../src/types/inventory/zod.js'
import { createMatcher } from '../../src/types/matcher/matcher-factory.js'
import { inventoryToRawInventory } from '../../src/utils/inventory.js'

describe('multi-workflow inventory serialization', () => {
  it('preserves workflow pairs and workflow matchers', () => {
    const workflow = { fileName: 'checkout.json', definition: { steps: [] } }
    const target = (workflowId: string, url: string) => ({
      workflowId,
      name: `2.0/${workflowId}`,
      url,
      workflow,
      logger: undefined as any,
    })
    const inventory: Inventory = {
      fileName: '2.0.json',
      target: {
        workflows: [
          {
            id: 'workflow-a',
            inventory: { ...target('workflow-a', 'https://staging.example.com/workflow-a'), type: 'inventory' as const },
            detection: { ...target('workflow-a', 'https://www.example.com/workflow-a'), type: 'detection' as const },
          },
          {
            id: 'workflow-b',
            inventory: { ...target('workflow-b', 'https://staging.example.com/workflow-b'), type: 'inventory' as const },
            detection: { ...target('workflow-b', 'https://www.example.com/workflow-b'), type: 'detection' as const },
          },
        ],
      },
      alerts: {
        inventory: { newScriptIdentified: { destination: 'console' }, newHeaderIdentified: { destination: 'console' } },
        detection: {
          newScriptDetected: { destination: 'console' },
          scriptMismatchDetected: { destination: 'console' },
          newHeaderDetected: { destination: 'console' },
        },
        successNotification: { destination: 'console' },
      },
      scripts: [
        {
          identifyWith: createMatcher({ andMatcher: [{ workflowMatcher: '^workflow-b$' }, { hostMatcher: '^payments\\.example\\.com$' }] }),
          authoriseWith: {
            matcher: createMatcher({ contentMatcher: '^approved$' }),
            authorisationInfo: { description: 'Workflow B loader', authorised: true, date: new Date('2026-07-28T00:00:00.000Z') },
          },
        },
      ],
      headers: [],
    }

    const raw = inventoryToRawInventory(inventory)

    expect(RawInventorySchema.safeParse(raw).success).toBe(true)
    expect(raw.target.workflows?.map(({ id }) => id)).toEqual(['workflow-a', 'workflow-b'])
    expect(raw.target.workflows?.[1]?.inventory.url).toBe('https://staging.example.com/workflow-b')
    expect(raw.scripts[0]?.identifyWith).toEqual({ andMatcher: [{ workflowMatcher: '^workflow-b$' }, { hostMatcher: '^payments\\.example\\.com$' }] })
  })
})
