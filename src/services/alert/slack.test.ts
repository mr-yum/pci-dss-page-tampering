/**
 * Unit tests for SlackAlertService typed results handling
 *
 * Tests for Phase 4 (User Story 2):
 * - T023: UnknownHeaderFound alert routing
 * - T024: KnownHeaderWithUnauthorisedContentFound alert with matcher details
 * - T025: AuthorizedHeaderFound no-op (no alert)
 * - T026: Script result types still work after header support
 * - T027: Exhaustive type checking via TypeScript never
 */

import type { ComparisonResultType } from '../../types/comparison'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found'
import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found'
import { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found'
import { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found'
import type { DetectedHeader } from '../../types/header'
import type { InventoryAlert, InventoryHeaderInfo } from '../../types/inventory/model'
import type { DetectedScript, Matcher } from '../../types/matcher/matcher.interface'
import type { Target } from '../../types/target'
import { createLogger } from '../../utils/logger'
import { SlackAlertService } from './slack'

// Mock axios to prevent actual HTTP calls
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ data: { ok: true } }),
}))

describe('SlackAlertService - Typed Results Handling (Phase 4)', () => {
  let service: SlackAlertService
  let mockTarget: Target
  let mockAlertDestinations: InventoryAlert

  beforeEach(() => {
    service = new SlackAlertService('test-token')

    mockTarget = {
      type: 'detection',
      url: 'https://example.com/payment',
      workflow: {
        fileName: 'test-workflow.json',
        definition: { steps: [] },
      },
      logger: createLogger('test'),
    }

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
    }
  })

  describe('T023: UnknownHeaderFound alert routing', () => {
    const createUnknownHeaderResult = (targetType: 'inventory' | 'detection'): UnknownHeaderFound => {
      const target: Target = { ...mockTarget, type: targetType }
      const header: DetectedHeader = {
        name: 'x-custom-header',
        value: 'custom-value',
        target,
        workflow: target.workflow,
      }
      return new UnknownHeaderFound(target, new Date(), header)
    }

    it('should route to newHeaderIdentified channel for inventory workflow', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const result = createUnknownHeaderResult('inventory')

      // Spy on the sendMessage method to verify alert is sent to correct channel
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'inventory-header-channel',
        }),
      )
    })

    it('should route to uninventoriedHeaderDetected channel for detection workflow', async () => {
      const result = createUnknownHeaderResult('detection')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'detection-header-channel',
        }),
      )
    })

    it('should include header details in alert message', async () => {
      const result = createUnknownHeaderResult('detection')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      // Verify the message was sent with the header name in the table
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'table',
              rows: expect.arrayContaining([
                expect.any(Array), // Table header row
                expect.arrayContaining([
                  // Table data row with header name
                  expect.objectContaining({
                    elements: expect.arrayContaining([
                      expect.objectContaining({
                        elements: expect.arrayContaining([
                          expect.objectContaining({
                            text: 'x-custom-header',
                          }),
                        ]),
                      }),
                    ]),
                  }),
                ]),
              ]),
            }),
          ]),
        }),
      )
    })
  })

  describe('T024: KnownHeaderWithUnauthorisedContentFound with matcher details', () => {
    it('should include matcher type and failure reason in alert', async () => {
      const header: DetectedHeader = {
        name: 'x-frame-options',
        value: 'ALLOWALL', // Unauthorized value
        target: mockTarget,
        workflow: mockTarget.workflow,
      }

      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'value does not match pattern: ^(DENY|SAMEORIGIN)$' }),
        getType: () => 'content',
        getPattern: () => '^(DENY|SAMEORIGIN)$',
        getDescription: () => 'content:/^(DENY|SAMEORIGIN)$/',
      }

      const mockInventoryEntry: InventoryHeaderInfo = {
        identifyWith: {
          identify: () => true,
          authorize: () => ({ authorized: true }),
          getType: () => 'header-name',
          getPattern: () => '^x-frame-options$',
          getDescription: () => 'header-name:/^x-frame-options$/',
        },
        authoriseWith: {
          matcher: mockMatcher,
          authorisationInfo: {
            description: 'Frame protection header',
            authorised: true,
            date: new Date(),
          },
        },
      }

      const result = new KnownHeaderWithUnauthorisedContentFound(mockTarget, new Date(), header, mockInventoryEntry, mockMatcher, 'value does not match pattern: ^(DENY|SAMEORIGIN)$')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      // Verify the failure reason is in the table with matcher details
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'table',
              rows: expect.arrayContaining([
                expect.any(Array), // Table header row
                expect.arrayContaining([
                  // Table data row with failure reason containing "matcher failed"
                  expect.any(Object), // Header name cell
                  expect.any(Object), // Header value cell
                  expect.objectContaining({
                    elements: expect.arrayContaining([
                      expect.objectContaining({
                        elements: expect.arrayContaining([
                          expect.objectContaining({
                            text: expect.stringMatching(/matcher.*failed/i),
                          }),
                        ]),
                      }),
                    ]),
                  }),
                ]),
              ]),
            }),
          ]),
        }),
      )
    })

    it('should route to scriptMismatchDetected channel for detection workflow', async () => {
      const header: DetectedHeader = {
        name: 'content-security-policy',
        value: 'default-src *', // Unauthorized value
        target: mockTarget,
        workflow: mockTarget.workflow,
      }

      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'value does not match pattern' }),
        getType: () => 'content',
        getPattern: () => '^default-src .self.$',
        getDescription: () => 'content:/^default-src .self.$/',
      }

      const mockInventoryEntry: InventoryHeaderInfo = {
        identifyWith: {
          identify: () => true,
          authorize: () => ({ authorized: true }),
          getType: () => 'header-name',
          getPattern: () => '^content-security-policy$',
          getDescription: () => 'header-name:/^content-security-policy$/',
        },
        authoriseWith: {
          matcher: mockMatcher,
          authorisationInfo: {
            description: 'CSP header',
            authorised: true,
            date: new Date(),
          },
        },
      }

      const result = new KnownHeaderWithUnauthorisedContentFound(mockTarget, new Date(), header, mockInventoryEntry, mockMatcher, 'value does not match pattern')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'script-mismatch-channel', // Note: using scriptMismatchDetected for headers too
        }),
      )
    })
  })

  describe('T025: AuthorizedHeaderFound no-op', () => {
    it('should not send alert for authorized headers', async () => {
      const header: DetectedHeader = {
        name: 'x-frame-options',
        value: 'DENY',
        target: mockTarget,
        workflow: mockTarget.workflow,
      }

      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: true }),
        getType: () => 'content',
        getPattern: () => '^(DENY|SAMEORIGIN)$',
        getDescription: () => 'content:/^(DENY|SAMEORIGIN)$/',
      }

      const mockInventoryEntry: InventoryHeaderInfo = {
        identifyWith: {
          identify: () => true,
          authorize: () => ({ authorized: true }),
          getType: () => 'header-name',
          getPattern: () => '^x-frame-options$',
          getDescription: () => 'header-name:/^x-frame-options$/',
        },
        authoriseWith: {
          matcher: mockMatcher,
          authorisationInfo: {
            description: 'Frame protection header',
            authorised: true,
            date: new Date(),
          },
        },
      }

      const result = new AuthorizedHeaderFound(mockTarget, new Date(), header, mockInventoryEntry)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).not.toHaveBeenCalled()
    })
  })

  describe('T026: Script result types still work after header support', () => {
    it('should handle UnknownScriptFound correctly', async () => {
      const script: DetectedScript = {
        name: 'https://malicious.com/script.js',
        content: 'alert("xss")',
        hash: { value: 'hash123' },
      }

      const result = new UnknownScriptFound(mockTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalled()
    })

    it('should handle KnownScriptWithUnauthorisedContentFound correctly', async () => {
      const script: DetectedScript = {
        name: 'https://cdn.example.com/script.js',
        content: 'modified content',
        hash: { value: 'newhash' },
      }

      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'hash mismatch' }),
        getType: () => 'hash',
        getPattern: () => 'oldhash',
        getDescription: () => 'hash:1 authorized hash',
      }

      const mockInventoryEntry = {
        identifyWith: mockMatcher,
        authoriseWith: {
          matcher: mockMatcher,
          authorisationInfo: {
            description: 'Test script',
            authorised: true,
            date: new Date(),
          },
        },
      }

      const result = new KnownScriptWithUnauthorisedContentFound(mockTarget, new Date(), script, mockInventoryEntry, mockMatcher, 'hash mismatch')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalled()
    })

    it('should not send alert for AuthorizedScriptFound', async () => {
      const script: DetectedScript = {
        name: 'https://cdn.example.com/script.js',
        content: 'authorized content',
        hash: { value: 'hash123' },
      }

      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: true }),
        getType: () => 'hash',
        getPattern: () => 'hash123',
        getDescription: () => 'hash:1 authorized hash',
      }

      const mockInventoryEntry = {
        identifyWith: mockMatcher,
        authoriseWith: {
          matcher: mockMatcher,
          authorisationInfo: {
            description: 'Test script',
            authorised: true,
            date: new Date(),
          },
        },
      }

      const result = new AuthorizedScriptFound(mockTarget, new Date(), script, mockInventoryEntry)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).not.toHaveBeenCalled()
    })
  })

  describe('T027: Exhaustive type checking', () => {
    it('should handle all ComparisonResultType variants without compiler errors', () => {
      // This test verifies that the switch statement in alertForTypedResults
      // handles all possible result types exhaustively

      // TypeScript compilation itself verifies this at build time
      // If a case is missing, TypeScript will error on the default case's `never` type

      // This test just confirms the types exist and can be constructed
      const results: ComparisonResultType[] = [
        new UnknownScriptFound(mockTarget, new Date(), {
          name: 'test',
          content: 'test',
          hash: { value: 'hash' },
        }),
        new UnknownHeaderFound(mockTarget, new Date(), {
          name: 'test',
          value: 'test',
          target: mockTarget,
          workflow: mockTarget.workflow,
        }),
      ]

      expect(results).toHaveLength(2)
      expect(results[0]?.type).toBe('unknown_script_found')
      expect(results[1]?.type).toBe('unknown_header_found')
    })
  })

  describe('Error handling', () => {
    it('should log error and continue if alert sending fails', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      jest.spyOn(service as any, 'sendMessage').mockRejectedValue(new Error('Slack API error'))

      const header: DetectedHeader = {
        name: 'x-custom-header',
        value: 'value',
        target: mockTarget,
        workflow: mockTarget.workflow,
      }

      const result = new UnknownHeaderFound(mockTarget, new Date(), header)

      // Should not throw
      await expect(service.alertForTypedResults([result], mockTarget, mockAlertDestinations)).resolves.not.toThrow()

      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })
  })
})

/**
 * Unit tests for SlackAlertService.alertOnSuccess()
 *
 * Tests for Phase 3 (User Story 1):
 * - T008: SlackAlertService.alertOnSuccess() message payload verification
 *   - Sends to correct channel based on mode
 *   - Uses Slack Block Kit format with green check mark emoji
 *   - Includes all required execution details
 *   - Handles optional executionDuration
 *   - Error handling (logs and continues)
 */
import { ExecutionMode } from '../../types/config'
import type { ExecutionSummary } from '../../types/execution-summary'

describe('SlackAlertService - alertOnSuccess (Phase 3)', () => {
  let service: SlackAlertService
  let mockAlertDestinations: InventoryAlert

  beforeEach(() => {
    service = new SlackAlertService('test-token')

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
    }
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

  describe('Alert destination routing', () => {
    it('should route to inventory.newScriptIdentified for inventory mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Inventory,
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'inventory-script-channel',
        }),
      )
    })

    it('should route to detection.newScriptDetected for detection mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Detection,
        inventoryBranch: null,
        detectionBranch: 'main',
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'detection-script-channel',
        }),
      )
    })

    it('should route to detection.newScriptDetected for all mode (production priority)', async () => {
      const summary = createSummary({
        mode: ExecutionMode.All,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'detection-script-channel',
        }),
      )
    })
  })

  describe('Slack Block Kit message format', () => {
    it('should include success header with green check mark emoji', async () => {
      const summary = createSummary()

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                type: 'mrkdwn',
                text: ':white_check_mark: *Workflow Execution Completed Successfully* :white_check_mark:',
              }),
            }),
          ]),
        }),
      )
    })

    it('should include divider after header', async () => {
      const summary = createSummary()

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'divider' })]),
        }),
      )
    })

    it('should include execution mode in message', async () => {
      const summary = createSummary({ mode: ExecutionMode.Inventory })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Execution Mode*: `inventory`',
              }),
            }),
          ]),
        }),
      )
    })

    it('should include repository URL in message', async () => {
      const summary = createSummary({ repositoryUrl: 'https://github.com/test/repo' })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Repository*: `https://github.com/test/repo`',
              }),
            }),
          ]),
        }),
      )
    })

    it('should include resource count in message', async () => {
      const summary = createSummary({ resourceCount: 42 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Resources Monitored*: 42 scripts and headers',
              }),
            }),
          ]),
        }),
      )
    })

    it('should include completion timestamp in message', async () => {
      const summary = createSummary({ completedAt: new Date('2025-12-17T14:30:00.000Z') })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Completed At*: 2025-12-17T14:30:00.000Z',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('Target list formatting', () => {
    it('should display all targets when <= 5', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0', '2.0', '3.0'] })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Targets Processed*: 1.0, 2.0, 3.0',
              }),
            }),
          ]),
        }),
      )
    })

    it('should use singular "Target Processed" for single target', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0'] })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Target Processed*: 1.0',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('Branch display based on mode', () => {
    it('should display singular "Branch Used" for inventory mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Inventory,
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Branch Used*: `updates/scripts`',
              }),
            }),
          ]),
        }),
      )
    })

    it('should display plural "Branches Used" for all mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.All,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Branches Used*: `updates/scripts` (inventory), `main` (detection)',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('Zero resources edge case', () => {
    it('should include warning emoji for zero resources', async () => {
      const summary = createSummary({ resourceCount: 0 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('0 scripts and headers :warning:'),
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('Optional executionDuration', () => {
    it('should not include executionDuration block when omitted', async () => {
      // Don't pass executionDuration at all - it's optional
      const summary = createSummary({})

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      const callArg = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ text?: { text: string } }> }
      const blockTexts = callArg.blocks.filter((b) => b.text?.text).map((b) => b.text?.text)
      expect(blockTexts.some((text) => text?.includes('Execution Duration'))).toBe(false)
    })

    it('should include executionDuration block when provided', async () => {
      const summary = createSummary({ executionDuration: 5000 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Execution Duration*: 5s',
              }),
            }),
          ]),
        }),
      )
    })

    it('should format executionDuration in milliseconds when < 1000ms', async () => {
      const summary = createSummary({ executionDuration: 500 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Execution Duration*: 500ms',
              }),
            }),
          ]),
        }),
      )
    })

    it('should format executionDuration in minutes and seconds when >= 60s', async () => {
      const summary = createSummary({ executionDuration: 125000 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Execution Duration*: 2m 5s',
              }),
            }),
          ]),
        }),
      )
    })
  })

  describe('Error handling', () => {
    it('should log error and not throw if sendMessage fails', async () => {
      const summary = createSummary()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      jest.spyOn(service as any, 'sendMessage').mockRejectedValue(new Error('Slack API error'))

      await expect(service.alertOnSuccess(summary, mockAlertDestinations)).resolves.not.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Alert Error] Failed to send success notification:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })

    it('should log to console before sending message', async () => {
      const summary = createSummary()
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(consoleLogSpy).toHaveBeenCalledWith('[Alert → Success]: Workflow execution completed successfully')

      consoleLogSpy.mockRestore()
    })
  })
})
