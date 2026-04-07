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
    service = new SlackAlertService('test-token', 'https://github.com/example/script-inventory', 'inventory-updates')

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
      successNotification: { destination: 'success-channel' },
    }
  })

  /**
   * T006: Verify alertForTypedResults continues using violation destinations unchanged
   * Feature 010: Success notifications get dedicated destination, but violation alerts are unchanged.
   */
  describe('T006: alertForTypedResults violation destinations unchanged', () => {
    it('T006: should continue routing unknown scripts to detection.newScriptDetected (not successNotification)', async () => {
      const script: DetectedScript = {
        name: 'https://malicious.com/script.js',
        content: 'alert("xss")',
        hash: { value: 'hash123' },
      }

      const result = new UnknownScriptFound(mockTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      // Feature 010: Violation alerts continue to use detection destinations, NOT successNotification
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'detection-script-channel', // NOT 'success-channel'
        }),
      )
    })

    it('T006: should continue routing unknown headers to detection.newHeaderDetected (not successNotification)', async () => {
      const header: DetectedHeader = {
        name: 'x-custom-header',
        value: 'value',
        target: mockTarget,
        workflow: mockTarget.workflow,
      }

      const result = new UnknownHeaderFound(mockTarget, new Date(), header)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      // Feature 010: Violation alerts continue to use detection destinations, NOT successNotification
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'detection-header-channel', // NOT 'success-channel'
        }),
      )
    })
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

  /**
   * "Review changes" button should only render in inventory mode, because that
   * is the workflow that pushes a branch which can be opened as a PR. The URL
   * must use the inventoryBranch passed to the constructor, not a hardcoded value.
   */
  describe('Review changes button rendering', () => {
    type Block = { type: string; elements?: Array<{ type: string; url?: string }> }
    const findActionsBlock = (payload: { blocks: Block[] }): Block | undefined => payload.blocks.find((b) => b.type === 'actions')

    it('should include a Review changes button in unknown-script alerts when target.type is inventory', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const script: DetectedScript = {
        name: 'https://cdn.example.com/new-script.js',
        content: 'console.log("hi")',
        hash: { value: 'newhash' },
      }
      const result = new UnknownScriptFound(inventoryTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock).toBeDefined()
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/inventory-updates?expand=1')
    })

    it('should NOT include a Review changes button in unknown-script alerts when target.type is detection', async () => {
      const detectionTarget: Target = { ...mockTarget, type: 'detection' }
      const script: DetectedScript = {
        name: 'https://malicious.com/script.js',
        content: 'alert("xss")',
        hash: { value: 'hash123' },
      }
      const result = new UnknownScriptFound(detectionTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], detectionTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      expect(findActionsBlock(payload)).toBeUndefined()
    })

    it('should include a Review changes button in unknown-header alerts when target.type is inventory', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const header: DetectedHeader = {
        name: 'x-custom-header',
        value: 'custom-value',
        target: inventoryTarget,
        workflow: inventoryTarget.workflow,
      }
      const result = new UnknownHeaderFound(inventoryTarget, new Date(), header)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock).toBeDefined()
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/inventory-updates?expand=1')
    })

    it('should NOT include a Review changes button in unknown-header alerts when target.type is detection', async () => {
      const detectionTarget: Target = { ...mockTarget, type: 'detection' }
      const header: DetectedHeader = {
        name: 'x-custom-header',
        value: 'custom-value',
        target: detectionTarget,
        workflow: detectionTarget.workflow,
      }
      const result = new UnknownHeaderFound(detectionTarget, new Date(), header)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], detectionTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      expect(findActionsBlock(payload)).toBeUndefined()
    })

    it('should NOT include a Review changes button in unauthorized-script alerts when target.type is detection', async () => {
      const script: DetectedScript = {
        name: 'https://cdn.example.com/script.js',
        content: 'modified',
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
          authorisationInfo: { description: 'Test script', authorised: true, date: new Date() },
        },
      }
      const result = new KnownScriptWithUnauthorisedContentFound(mockTarget, new Date(), script, mockInventoryEntry, mockMatcher, 'hash mismatch')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      expect(findActionsBlock(payload)).toBeUndefined()
    })

    it('should include a Review changes button in unauthorized-script alerts when target.type is inventory', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const script: DetectedScript = {
        name: 'https://cdn.example.com/script.js',
        content: 'modified',
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
          authorisationInfo: { description: 'Test script', authorised: true, date: new Date() },
        },
      }
      const result = new KnownScriptWithUnauthorisedContentFound(inventoryTarget, new Date(), script, mockInventoryEntry, mockMatcher, 'hash mismatch')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock).toBeDefined()
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/inventory-updates?expand=1')
    })

    it('should NOT include a Review changes button in unauthorized-header alerts when target.type is detection', async () => {
      const header: DetectedHeader = {
        name: 'x-frame-options',
        value: 'ALLOWALL',
        target: mockTarget,
        workflow: mockTarget.workflow,
      }
      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'value does not match pattern' }),
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
          authorisationInfo: { description: 'Frame protection header', authorised: true, date: new Date() },
        },
      }
      const result = new KnownHeaderWithUnauthorisedContentFound(mockTarget, new Date(), header, mockInventoryEntry, mockMatcher, 'value does not match pattern')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      expect(findActionsBlock(payload)).toBeUndefined()
    })

    it('should include a Review changes button in unauthorized-header alerts when target.type is inventory', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const header: DetectedHeader = {
        name: 'x-frame-options',
        value: 'ALLOWALL',
        target: inventoryTarget,
        workflow: inventoryTarget.workflow,
      }
      const mockMatcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'value does not match pattern' }),
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
          authorisationInfo: { description: 'Frame protection header', authorised: true, date: new Date() },
        },
      }
      const result = new KnownHeaderWithUnauthorisedContentFound(inventoryTarget, new Date(), header, mockInventoryEntry, mockMatcher, 'value does not match pattern')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock).toBeDefined()
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/inventory-updates?expand=1')
    })

    it('should respect the configured inventoryBranch when building the Review changes URL', async () => {
      const customService = new SlackAlertService('test-token', 'https://github.com/example/script-inventory.git', 'release/v2')
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const script: DetectedScript = {
        name: 'https://cdn.example.com/new-script.js',
        content: 'x',
        hash: { value: 'h' },
      }
      const result = new UnknownScriptFound(inventoryTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(customService as any, 'sendMessage').mockResolvedValue(undefined)

      await customService.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/release/v2?expand=1')
    })
  })

  /**
   * Each detection-summary table should have a "Suggested AI Prompt" column
   * containing a copy-pasteable prompt that an AI assistant can use to amend
   * the inventory and resolve the finding.
   */
  describe('Suggested AI Prompt column', () => {
    type TextElement = { text?: string; style?: { bold?: boolean } }
    type RichTextSection = { type: string; elements: TextElement[] }
    type Cell = { type: string; elements: RichTextSection[] }
    type TableBlock = { type: string; rows: Cell[][] }

    const getTableBlock = (payload: { blocks: Array<{ type: string }> }): TableBlock => {
      const block = payload.blocks.find((b) => b.type === 'table')
      if (!block) throw new Error('No table block found in payload')
      return block as TableBlock
    }

    const getCellText = (cell: Cell): string => cell.elements.map((section) => section.elements.map((el) => el.text ?? '').join('')).join('')

    it('should include a Suggested AI Prompt header in unknown-script alerts and a populated cell per row', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory', url: 'https://shop.example.com/checkout' }
      const script: DetectedScript = {
        name: 'https://cdn.tracker.com/track.js',
        content: 'track()',
        hash: { value: 'abc123' },
      }
      const result = new UnknownScriptFound(inventoryTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ type: string }> }
      const table = getTableBlock(payload)

      // Header row contains the new bold "Suggested AI Prompt" cell
      const headerRow = table.rows[0]!
      const headerLabels = headerRow.map(getCellText)
      expect(headerLabels).toContain('Suggested AI Prompt')

      // Data row's last cell contains the prompt referencing the script and target
      const dataRow = table.rows[1]!
      const promptCell = getCellText(dataRow[dataRow.length - 1]!)
      expect(promptCell).toContain('https://shop.example.com/checkout')
      expect(promptCell).toContain('https://cdn.tracker.com/track.js')
      expect(promptCell).toContain('abc123')
    })

    it('should include a Suggested AI Prompt cell in unauthorized-script (hash mismatch) alerts', async () => {
      const script: DetectedScript = {
        name: 'https://cdn.example.com/payments.js',
        content: 'modified content',
        hash: { value: 'newhash999' },
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
          authorisationInfo: { description: 'Payments script', authorised: true, date: new Date() },
        },
      }
      const result = new KnownScriptWithUnauthorisedContentFound(mockTarget, new Date(), script, mockInventoryEntry, mockMatcher, 'hash mismatch')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ type: string }> }
      const table = getTableBlock(payload)

      const headerLabels = table.rows[0]!.map(getCellText)
      expect(headerLabels).toContain('Suggested AI Prompt')

      const dataRow = table.rows[1]!
      const promptCell = getCellText(dataRow[dataRow.length - 1]!)
      expect(promptCell).toContain('https://cdn.example.com/payments.js')
      expect(promptCell).toContain('newhash999')
      expect(promptCell).toContain('failed authorisation')
    })

    it('should include a Suggested AI Prompt cell in unknown-header alerts', async () => {
      const target: Target = { ...mockTarget, url: 'https://shop.example.com/checkout' }
      const header: DetectedHeader = {
        name: 'x-tracking-id',
        value: 'tid-42',
        target,
        workflow: target.workflow,
      }
      const result = new UnknownHeaderFound(target, new Date(), header)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], target, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ type: string }> }
      const table = getTableBlock(payload)

      const headerLabels = table.rows[0]!.map(getCellText)
      expect(headerLabels).toContain('Suggested AI Prompt')

      const dataRow = table.rows[1]!
      const promptCell = getCellText(dataRow[dataRow.length - 1]!)
      expect(promptCell).toContain('x-tracking-id')
      expect(promptCell).toContain('tid-42')
      expect(promptCell).toContain('https://shop.example.com/checkout')
    })

    it('should include a Suggested AI Prompt cell in unauthorized-header alerts', async () => {
      const header: DetectedHeader = {
        name: 'content-security-policy',
        value: 'default-src *',
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
          authorisationInfo: { description: 'CSP header', authorised: true, date: new Date() },
        },
      }
      const result = new KnownHeaderWithUnauthorisedContentFound(mockTarget, new Date(), header, mockInventoryEntry, mockMatcher, 'value does not match pattern')

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ type: string }> }
      const table = getTableBlock(payload)

      const headerLabels = table.rows[0]!.map(getCellText)
      expect(headerLabels).toContain('Suggested AI Prompt')

      const dataRow = table.rows[1]!
      const promptCell = getCellText(dataRow[dataRow.length - 1]!)
      expect(promptCell).toContain('content-security-policy')
      expect(promptCell).toContain('default-src *')
      expect(promptCell).toContain('failed authorisation')
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
    service = new SlackAlertService('test-token', 'https://github.com/example/script-inventory', 'inventory-updates')

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

  /**
   * T005: Tests for alertOnSuccess using successNotification destination
   * Feature 010: Success notifications should route to dedicated successNotification destination
   * regardless of execution mode, instead of mode-based routing.
   */
  describe('Alert destination routing (Feature 010)', () => {
    it('T005: should route to successNotification destination for inventory mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Inventory,
        inventoryBranch: 'updates/scripts',
        detectionBranch: null,
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Feature 010: Uses successNotification directly instead of mode-based routing
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'success-channel',
        }),
      )
    })

    it('T005: should route to successNotification destination for detection mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.Detection,
        inventoryBranch: null,
        detectionBranch: 'main',
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Feature 010: Uses successNotification directly instead of mode-based routing
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'success-channel',
        }),
      )
    })

    it('T005: should route to successNotification destination for all mode', async () => {
      const summary = createSummary({
        mode: ExecutionMode.All,
        inventoryBranch: 'updates/scripts',
        detectionBranch: 'main',
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      // Feature 010: Uses successNotification directly instead of mode-based routing
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'success-channel',
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

    // T014 [US2] Unit test for single target display (singular "Target" vs "Targets")
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

    // T014 [US2] Additional test: plural "Targets Processed" for multiple targets
    it('should use plural "Targets Processed" for multiple targets', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0', '2.0'] })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Targets Processed*: 1.0, 2.0',
              }),
            }),
          ]),
        }),
      )
    })

    // T012 [US2] Unit test for target list truncation logic (>5 targets shows "and N more")
    it('should truncate target list when > 5 targets, showing first 3 and "and N more"', async () => {
      const summary = createSummary({
        targetsProcessed: ['1.0', '2.0', '3.0', '4.0', '5.0', '6.0', '7.0', '8.0'],
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Targets Processed*: 1.0, 2.0, 3.0, and 5 more',
              }),
            }),
          ]),
        }),
      )
    })

    // T012 [US2] Additional test: exactly 6 targets (boundary case)
    it('should truncate target list with exactly 6 targets to show first 3 and "and 3 more"', async () => {
      const summary = createSummary({
        targetsProcessed: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Targets Processed*: alpha, beta, gamma, and 3 more',
              }),
            }),
          ]),
        }),
      )
    })

    // T012 [US2] Additional test: exactly 5 targets (boundary - no truncation)
    it('should display all 5 targets without truncation when exactly 5', async () => {
      const summary = createSummary({
        targetsProcessed: ['1.0', '2.0', '3.0', '4.0', '5.0'],
      })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Targets Processed*: 1.0, 2.0, 3.0, 4.0, 5.0',
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

  // T013 [US2] Unit tests for zero resources edge case warning display
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

    // T013 [US2] Additional test: verify full warning message text
    it('should display investigation suggestion for zero resources', async () => {
      const summary = createSummary({ resourceCount: 0 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Resources Monitored*: 0 scripts and headers :warning: This may warrant investigation',
              }),
            }),
          ]),
        }),
      )
    })

    // T013 [US2] Additional test: non-zero resources should not show warning
    it('should not include warning emoji for non-zero resources', async () => {
      const summary = createSummary({ resourceCount: 10 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnSuccess(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: '*Resources Monitored*: 10 scripts and headers',
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
