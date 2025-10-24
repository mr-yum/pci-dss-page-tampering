/**
 * InventoryService Unit Tests (Phase 3 - T014 through T024)
 *
 * Tests for processComparisonResult() and related methods handling typed comparison results.
 *
 * @see src/services/inventory.ts
 * @see specs/006-use-typed-comparison/spec.md - User Story 1
 */

import type { IScriptInventoryRepository } from '../../../src/interfaces/inventory'
import { ScriptInventoryService } from '../../../src/services/inventory'
import { AuthorizedScriptFound } from '../../../src/types/comparison/authorized-script-found'
import { UnknownHeaderFound } from '../../../src/types/comparison/unknown-header-found'
import { UnknownScriptFound } from '../../../src/types/comparison/unknown-script-found'
import type { DetectedHeader } from '../../../src/types/header'
import type { Inventory } from '../../../src/types/inventory/model'
import type { DetectedScript } from '../../../src/types/matcher/matcher.interface'
import { createMatcher } from '../../../src/types/matcher/matcher-factory'
import type { PullTarget, Target } from '../../../src/types/target'

// Mock repository for testing
class MockInventoryRepository implements IScriptInventoryRepository {
  async pull(_target: PullTarget): Promise<Inventory[]> {
    return []
  }

  async push(_inventories: Inventory[]): Promise<void> {
    return Promise.resolve()
  }
}

describe('InventoryService - processComparisonResult() (Phase 3 Unit Tests)', () => {
  let service: ScriptInventoryService
  let mockRepository: MockInventoryRepository
  let baseInventory: Inventory
  let inventoryTarget: Target
  let detectionTarget: Target
  let timestamp: Date

  beforeEach(() => {
    mockRepository = new MockInventoryRepository()
    service = new ScriptInventoryService({ inventoryRepository: mockRepository })
    timestamp = new Date('2025-10-24T12:00:00.000Z')

    const mockWorkflow = {
      fileName: 'test-workflow.yml',
      definition: { steps: [] },
    }

    inventoryTarget = {
      type: 'inventory' as const,
      url: 'https://example.com/payment',
      workflow: mockWorkflow,
    }

    detectionTarget = {
      type: 'detection' as const,
      url: 'https://example.com/payment',
      workflow: mockWorkflow,
    }

    baseInventory = {
      fileName: 'example.com.json',
      target: {
        inventory: inventoryTarget as any,
        detection: detectionTarget as any,
      },
      alerts: { inventory: {} as any, detection: {} as any },
      scripts: [],
      headers: [],
    }
  })

  describe('T014-T024: Core functionality tests', () => {
    it('T014: should add new script to inventory', async () => {
      const detectedScript: DetectedScript = {
        name: 'https://cdn.example.com/analytics.js',
        content: 'console.log("test");',
        hash: { value: 'abc123' },
      }

      const result = new UnknownScriptFound(inventoryTarget, timestamp, detectedScript)
      const diff = await service.diff(baseInventory, [result])

      expect(diff.newInventory.scripts).toHaveLength(1)
      expect(diff.newInventory.scripts[0]?.identifyWith.getType()).toBe('name')
      expect(diff.newInventory.scripts[0]?.authoriseWith.matcher.getType()).toBe('hash')
    })

    it('T024: should reject detection workflow results', async () => {
      const detectedScript: DetectedScript = {
        name: 'https://cdn.example.com/script.js',
        content: 'test',
        hash: { value: 'testHash' },
      }

      const detectionResult = new UnknownScriptFound(detectionTarget, timestamp, detectedScript)

      await expect(service.diff(baseInventory, [detectionResult])).rejects.toThrow('[Inventory → Service] Cannot run diff with results from detection target!')
    })

    it('T019: should not modify inventory for authorized scripts', async () => {
      const existingScript: any = {
        identifyWith: createMatcher({ nameMatcher: '^https://cdn\\\\.example\\\\.com/analytics\\\\.js$' }),
        authoriseWith: {
          matcher: createMatcher({ hashes: [{ timestamp: '2025-10-01T00:00:00.000Z', hash: { value: 'authorizedHash' } }] } as any),
          authorisationInfo: {
            description: 'Analytics script',
            authorised: true,
            date: new Date('2025-10-01T00:00:00.000Z'),
          },
        },
      }

      baseInventory.scripts = [existingScript]

      const detectedScript: DetectedScript = {
        name: 'https://cdn.example.com/analytics.js',
        content: 'console.log("authorized");',
        hash: { value: 'authorizedHash' },
      }

      const result = new AuthorizedScriptFound(inventoryTarget, timestamp, detectedScript, existingScript, [])

      const diff = await service.diff(baseInventory, [result])

      expect(diff.newInventory.scripts).toHaveLength(1)
      expect(diff.newInventory.scripts[0]).toEqual(existingScript)
    })

    it('T022: should process mixed script and header results', async () => {
      const detectedScript: DetectedScript = {
        name: 'https://cdn.example.com/new.js',
        content: 'new script',
        hash: { value: 'newScriptHash' },
      }

      const detectedHeader: DetectedHeader = {
        name: 'X-Custom-Header',
        value: 'custom-value',
        target: inventoryTarget,
        workflow: inventoryTarget.workflow,
      }

      const scriptResult = new UnknownScriptFound(inventoryTarget, timestamp, detectedScript)
      const headerResult = new UnknownHeaderFound(inventoryTarget, timestamp, detectedHeader)

      const diff = await service.diff(baseInventory, [scriptResult, headerResult])

      expect(diff.newInventory.scripts).toHaveLength(1)
      expect(diff.newInventory.headers).toHaveLength(1)
    })
  })
})
