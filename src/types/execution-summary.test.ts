/**
 * Unit tests for ExecutionSummary type and validation
 *
 * Tests for Phase 3 (User Story 1):
 * - T006: validateExecutionSummary() validation rules
 *   - Mode-branch consistency validation
 *   - Non-empty targets validation
 *   - Valid resource count validation
 *   - No future timestamps validation
 *   - Duration consistency validation (optional)
 */

import { ExecutionMode } from './config'
import { type ExecutionSummary, validateExecutionSummary } from './execution-summary'

describe('validateExecutionSummary', () => {
  // Use a past date to avoid "future timestamp" validation errors
  const pastDate = new Date()
  pastDate.setDate(pastDate.getDate() - 1) // Yesterday

  const createValidSummary = (overrides: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
    mode: ExecutionMode.All,
    targetsProcessed: ['1.0', '2.0'],
    repositoryUrl: 'https://github.com/org/inventory',
    inventoryBranch: 'updates/scripts',
    detectionBranch: 'main',
    resourceCount: 42,
    completedAt: pastDate,
    ...overrides,
  })

  describe('Mode-Branch Consistency', () => {
    describe('inventory mode', () => {
      it('should pass when inventoryBranch is set and detectionBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Inventory,
          inventoryBranch: 'updates/scripts',
          detectionBranch: null,
        })

        expect(() => validateExecutionSummary(summary)).not.toThrow()
      })

      it('should fail when inventoryBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Inventory,
          inventoryBranch: null,
          detectionBranch: null,
        })

        expect(() => validateExecutionSummary(summary)).toThrow('inventory mode requires inventoryBranch only')
      })

      it('should fail when detectionBranch is set', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Inventory,
          inventoryBranch: 'updates/scripts',
          detectionBranch: 'main',
        })

        expect(() => validateExecutionSummary(summary)).toThrow('inventory mode requires inventoryBranch only')
      })
    })

    describe('detection mode', () => {
      it('should pass when detectionBranch is set and inventoryBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Detection,
          inventoryBranch: null,
          detectionBranch: 'main',
        })

        expect(() => validateExecutionSummary(summary)).not.toThrow()
      })

      it('should fail when detectionBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Detection,
          inventoryBranch: null,
          detectionBranch: null,
        })

        expect(() => validateExecutionSummary(summary)).toThrow('detection mode requires detectionBranch only')
      })

      it('should fail when inventoryBranch is set', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.Detection,
          inventoryBranch: 'updates/scripts',
          detectionBranch: 'main',
        })

        expect(() => validateExecutionSummary(summary)).toThrow('detection mode requires detectionBranch only')
      })
    })

    describe('all mode', () => {
      it('should pass when both branches are set', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.All,
          inventoryBranch: 'updates/scripts',
          detectionBranch: 'main',
        })

        expect(() => validateExecutionSummary(summary)).not.toThrow()
      })

      it('should fail when inventoryBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.All,
          inventoryBranch: null,
          detectionBranch: 'main',
        })

        expect(() => validateExecutionSummary(summary)).toThrow('all mode requires both branches')
      })

      it('should fail when detectionBranch is null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.All,
          inventoryBranch: 'updates/scripts',
          detectionBranch: null,
        })

        expect(() => validateExecutionSummary(summary)).toThrow('all mode requires both branches')
      })

      it('should fail when both branches are null', () => {
        const summary = createValidSummary({
          mode: ExecutionMode.All,
          inventoryBranch: null,
          detectionBranch: null,
        })

        expect(() => validateExecutionSummary(summary)).toThrow('all mode requires both branches')
      })
    })
  })

  describe('Non-Empty Targets', () => {
    it('should pass with at least one target', () => {
      const summary = createValidSummary({
        targetsProcessed: ['1.0'],
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass with multiple targets', () => {
      const summary = createValidSummary({
        targetsProcessed: ['1.0', '2.0', '3.0'],
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should fail with empty targets array', () => {
      const summary = createValidSummary({
        targetsProcessed: [],
      })

      expect(() => validateExecutionSummary(summary)).toThrow('targetsProcessed cannot be empty')
    })
  })

  describe('Valid Resource Count', () => {
    it('should pass with positive resource count', () => {
      const summary = createValidSummary({
        resourceCount: 42,
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass with zero resource count (edge case)', () => {
      const summary = createValidSummary({
        resourceCount: 0,
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should fail with negative resource count', () => {
      const summary = createValidSummary({
        resourceCount: -1,
      })

      expect(() => validateExecutionSummary(summary)).toThrow('resourceCount must be non-negative')
    })
  })

  describe('No Future Timestamps', () => {
    it('should pass with past timestamp', () => {
      const summary = createValidSummary({
        completedAt: pastDate,
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass with current timestamp', () => {
      const summary = createValidSummary({
        completedAt: new Date(),
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should fail with future timestamp', () => {
      const futureDate = new Date()
      futureDate.setFullYear(futureDate.getFullYear() + 1)

      const summary = createValidSummary({
        completedAt: futureDate,
      })

      expect(() => validateExecutionSummary(summary)).toThrow('completedAt cannot be in the future')
    })
  })

  describe('Duration Consistency (Optional)', () => {
    it('should pass with null executionDuration', () => {
      const summary = createValidSummary({
        executionDuration: null,
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass with omitted executionDuration (undefined)', () => {
      // Don't pass executionDuration at all - it's optional
      const summary = createValidSummary({})

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass with positive executionDuration', () => {
      const summary = createValidSummary({
        executionDuration: 5000,
      })

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should fail with zero executionDuration', () => {
      const summary = createValidSummary({
        executionDuration: 0,
      })

      expect(() => validateExecutionSummary(summary)).toThrow('executionDuration must be positive if provided')
    })

    it('should fail with negative executionDuration', () => {
      const summary = createValidSummary({
        executionDuration: -1000,
      })

      expect(() => validateExecutionSummary(summary)).toThrow('executionDuration must be positive if provided')
    })
  })

  describe('Full Valid Summary', () => {
    it('should pass for fully valid inventory summary', () => {
      const summary: ExecutionSummary = {
        mode: ExecutionMode.Inventory,
        targetsProcessed: ['1.0'],
        repositoryUrl: 'https://github.com/org/inventory',
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
        resourceCount: 10,
        completedAt: pastDate,
      }

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass for fully valid detection summary', () => {
      const summary: ExecutionSummary = {
        mode: ExecutionMode.Detection,
        targetsProcessed: ['1.0', '2.0'],
        repositoryUrl: 'file:///tmp/inventory',
        inventoryBranch: null,
        detectionBranch: 'main',
        resourceCount: 25,
        completedAt: pastDate,
      }

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })

    it('should pass for fully valid all mode summary with executionDuration', () => {
      const summary: ExecutionSummary = {
        mode: ExecutionMode.All,
        targetsProcessed: ['1.0', '2.0', '3.0'],
        repositoryUrl: 'https://github.com/org/inventory',
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        resourceCount: 42,
        completedAt: pastDate,
        executionDuration: 120000,
      }

      expect(() => validateExecutionSummary(summary)).not.toThrow()
    })
  })
})
