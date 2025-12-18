/**
 * Unit tests for ConsoleAlertService.alertOnSuccess()
 *
 * Tests for Phase 3 (User Story 1):
 * - T007: ConsoleAlertService.alertOnSuccess() output verification
 *   - Logs execution mode
 *   - Logs target list (with truncation for > 5 targets)
 *   - Logs repository URL
 *   - Logs branch display based on mode
 *   - Logs resource count with edge case warning
 *   - Logs completion timestamp
 *   - Logs optional executionDuration when provided
 */

import { ExecutionMode } from '../../types/config'
import type { ExecutionSummary } from '../../types/execution-summary'
import type { InventoryAlert } from '../../types/inventory/model'
import { ConsoleAlertService } from './console'

describe('ConsoleAlertService - alertOnSuccess (Phase 3)', () => {
  let service: ConsoleAlertService
  let consoleSpy: jest.SpyInstance
  let mockAlertDestinations: InventoryAlert

  beforeEach(() => {
    service = new ConsoleAlertService()
    consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    mockAlertDestinations = {
      inventory: {
        newScriptIdentified: { destination: 'inventory-script-channel' },
        newHeaderIdentified: { destination: 'inventory-header-channel' },
      },
      detection: {
        newScriptDetected: { destination: 'detection-script-channel' },
        scriptMismatchDetected: { destination: 'script-mismatch-channel' },
        newHeaderDetected: { destination: 'detection-header-channel' },
      },
      successNotification: { destination: 'success-channel' },
    }
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  const createSummary = (overrides: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
    mode: ExecutionMode.All,
    targetsProcessed: ['1.0', '2.0'],
    repositoryUrl: 'https://github.com/org/inventory',
    inventoryBranch: 'updates/scripts',
    detectionBranch: 'main',
    resourceCount: 42,
    completedAt: new Date('2025-12-17T14:30:00.000Z'),
    ...overrides,
  })

  describe('Success message output', () => {
    it('should log success header', async () => {
      const summary = createSummary()

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('[Console Alert -> Success]: Workflow execution completed successfully')
    })

    it('should log execution mode', async () => {
      const summary = createSummary({ mode: ExecutionMode.Detection })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Mode: detection')
    })

    it('should log repository URL', async () => {
      const summary = createSummary({ repositoryUrl: 'https://github.com/test/repo' })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Repository: https://github.com/test/repo')
    })

    it('should log completion timestamp in ISO format', async () => {
      const summary = createSummary({ completedAt: new Date('2025-12-17T14:30:00.000Z') })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Completed At: 2025-12-17T14:30:00.000Z')
    })
  })

  describe('Target list formatting', () => {
    it('should display all targets when <= 5', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0', '2.0', '3.0'] })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Targets Processed: 1.0, 2.0, 3.0')
    })

    it('should display exactly 5 targets without truncation', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0', '2.0', '3.0', '4.0', '5.0'] })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Targets Processed: 1.0, 2.0, 3.0, 4.0, 5.0')
    })

    it('should truncate to first 3 + "and N more" when > 5 targets', async () => {
      const summary = createSummary({
        targetsProcessed: ['1.0', '2.0', '3.0', '4.0', '5.0', '6.0', '7.0', '8.0', '9.0', '10.0'],
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Targets Processed: 1.0, 2.0, 3.0, and 7 more')
    })

    it('should display single target', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0'] })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Targets Processed: 1.0')
    })
  })

  describe('Branch display based on mode', () => {
    it('should display singular "Branch" for inventory mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Inventory,
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Branch: updates/scripts')
    })

    it('should display singular "Branch" for detection mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Detection,
        inventoryBranch: null,
        detectionBranch: 'main',
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Branch: main')
    })

    it('should display plural "Branches" for all mode with both branches', async () => {
      const summary = createSummary({
        mode: ExecutionMode.All,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Branches: updates/scripts (inventory), main (detection)')
    })

    it('should handle null inventory branch gracefully', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Inventory,
        inventoryBranch: null,
        detectionBranch: null,
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Branch: unknown')
    })

    it('should handle null detection branch gracefully', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Detection,
        inventoryBranch: null,
        detectionBranch: null,
      })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Branch: unknown')
    })
  })

  describe('Resource count formatting', () => {
    it('should display positive resource count', async () => {
      const summary = createSummary({ resourceCount: 42 })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Resources Monitored: 42 scripts and headers')
    })

    it('should display zero resource count with warning', async () => {
      const summary = createSummary({ resourceCount: 0 })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Resources Monitored: 0 scripts and headers (This may warrant investigation)')
    })
  })

  describe('Optional executionDuration', () => {
    it('should not display executionDuration when omitted', async () => {
      // Don't pass executionDuration at all - it's optional
      const summary = createSummary({})

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Verify no call contains "Execution Duration"
      const calls = consoleSpy.mock.calls.map((call) => call[0]).filter((call) => typeof call === 'string')
      expect(calls.some((call: string) => call.includes('Execution Duration'))).toBe(false)
    })

    it('should not display executionDuration when null', async () => {
      const summary = createSummary({ executionDuration: null })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      const calls = consoleSpy.mock.calls.map((call) => call[0]).filter((call) => typeof call === 'string')
      expect(calls.some((call: string) => call.includes('Execution Duration'))).toBe(false)
    })

    it('should display executionDuration in milliseconds when < 1000ms', async () => {
      const summary = createSummary({ executionDuration: 500 })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Execution Duration: 500ms')
    })

    it('should display executionDuration in seconds when >= 1000ms and < 60s', async () => {
      const summary = createSummary({ executionDuration: 5000 })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Execution Duration: 5s')
    })

    it('should display executionDuration in minutes and seconds when >= 60s', async () => {
      const summary = createSummary({ executionDuration: 125000 })

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleSpy).toHaveBeenCalledWith('  Execution Duration: 2m 5s')
    })
  })

  describe('Full output sequence', () => {
    it('should output all fields in correct order for all mode', async () => {
      const summary: ExecutionSummary = {
        mode: ExecutionMode.All,
        targetsProcessed: ['1.0', '2.0'],
        repositoryUrl: 'https://github.com/org/inventory',
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
        resourceCount: 42,
        completedAt: new Date('2025-12-17T14:30:00.000Z'),
        executionDuration: 5000,
      }

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Filter out the empty console.log() call which produces undefined
      const calls = consoleSpy.mock.calls.map((call) => call[0]).filter((call) => call !== undefined)

      expect(calls).toEqual([
        '[Console Alert -> Success]: Workflow execution completed successfully',
        '  Mode: all',
        '  Targets Processed: 1.0, 2.0',
        '  Repository: https://github.com/org/inventory',
        '  Branches: updates/scripts (inventory), main (detection)',
        '  Resources Monitored: 42 scripts and headers',
        '  Completed At: 2025-12-17T14:30:00.000Z',
        '  Execution Duration: 5s',
      ])
    })

    it('should output all fields in correct order without executionDuration', async () => {
      const summary: ExecutionSummary = {
        mode: ExecutionMode.Inventory,
        targetsProcessed: ['1.0'],
        repositoryUrl: 'file:///tmp/inventory',
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
        resourceCount: 10,
        completedAt: new Date('2025-12-17T14:30:00.000Z'),
      }

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Filter out the empty console.log() call which produces undefined
      const calls = consoleSpy.mock.calls.map((call) => call[0]).filter((call) => call !== undefined)

      expect(calls).toEqual([
        '[Console Alert -> Success]: Workflow execution completed successfully',
        '  Mode: inventory',
        '  Targets Processed: 1.0',
        '  Repository: file:///tmp/inventory',
        '  Branch: updates/scripts',
        '  Resources Monitored: 10 scripts and headers',
        '  Completed At: 2025-12-17T14:30:00.000Z',
      ])
    })
  })
})
