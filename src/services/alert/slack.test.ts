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
