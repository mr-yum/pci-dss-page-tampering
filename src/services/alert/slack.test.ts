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

import axios from 'axios'

import type { ComparisonResultType } from '../../types/comparison.js'
import { AuthorizedHeaderFound } from '../../types/comparison/authorized-header-found.js'
import { AuthorizedScriptFound } from '../../types/comparison/authorized-script-found.js'
import { KnownHeaderWithUnauthorisedContentFound } from '../../types/comparison/known-header-unauthorised-content-found.js'
import { KnownScriptWithUnauthorisedContentFound } from '../../types/comparison/known-script-unauthorised-content-found.js'
import { MissingRequiredHeader } from '../../types/comparison/missing-required-header.js'
import { MissingRequiredScript } from '../../types/comparison/missing-required-script.js'
import { UnknownHeaderFound } from '../../types/comparison/unknown-header-found.js'
import { UnknownScriptFound } from '../../types/comparison/unknown-script-found.js'
import type { DetectedHeader } from '../../types/header.js'
import type { InventoryAlert, InventoryHeaderInfo, InventoryScriptInfo } from '../../types/inventory/model.js'
import type { DetectedScript, Matcher } from '../../types/matcher/matcher.interface.js'
import type { Target } from '../../types/target.js'
import { createLogger } from '../../utils/logger.js'
import { SlackAlertService } from './slack.js'

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

    it('redacts query credentials from Set-Cookie alert prompts', async () => {
      const header: DetectedHeader = {
        name: 'set-cookie',
        value: 'cookie=session; empty=false; httponly=true; path=/; secure=true',
        url: 'https://example.com/checkout?token=super-secret#payment',
        target: mockTarget,
        workflow: mockTarget.workflow,
      }
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([new UnknownHeaderFound(mockTarget, new Date(), header)], mockTarget, mockAlertDestinations)

      const payload = JSON.stringify(sendMessageSpy.mock.calls[0]?.[0])
      expect(payload).toContain('https://example.com/checkout')
      expect(payload).not.toContain('super-secret')
      expect(payload).not.toContain('token=')
    })

    it('routes missing required headers to the dedicated destination when configured', async () => {
      mockAlertDestinations.detection.missingHeaderDetected = { destination: 'missing-header-channel' }
      const entry = {
        identifyWith: { getDescription: () => 'header-name', getType: () => 'header-name', getPattern: () => '^strict-transport-security$' },
      } as unknown as InventoryHeaderInfo
      const result = new MissingRequiredHeader(mockTarget, new Date(), 'strict-transport-security', `${mockTarget.url}/checkout?token=super-secret#payment`, 'document', entry)
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: 'missing-header-channel' }))
      const payload = JSON.stringify(sendMessageSpy.mock.calls[0]?.[0])
      expect(payload).toContain(`${mockTarget.url}/checkout`)
      expect(payload).not.toContain('super-secret')
      expect(payload).not.toContain('token=')
    })

    it('routes missing required scripts to the dedicated destination when configured', async () => {
      mockAlertDestinations.detection.missingScriptDetected = { destination: 'missing-script-channel' }
      const entry = {
        identifyWith: { getDescription: () => "NameMatcher(pattern: '^https://monitor\\.example\\.com/agent\\.js$')" },
        authoriseWith: { authorisationInfo: { description: 'Monitoring agent pinned by hash', authorised: true, date: new Date() } },
        requiredOn: ['detection'],
      } as unknown as InventoryScriptInfo
      const result = new MissingRequiredScript(mockTarget, new Date(), entry.identifyWith.getDescription(), entry)
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: 'missing-script-channel' }))
      const payload = JSON.stringify(sendMessageSpy.mock.calls[0]?.[0])
      expect(payload).toContain('monitor\\\\.example\\\\.com')
      expect(payload).toContain('Monitoring agent pinned by hash')
    })

    it('falls back to scriptMismatchDetected for missing required scripts without a dedicated destination', async () => {
      const entry = {
        identifyWith: { getDescription: () => 'agent entry' },
        authoriseWith: { authorisationInfo: { description: 'Monitoring agent', authorised: true, date: new Date() } },
        requiredOn: ['detection'],
      } as unknown as InventoryScriptInfo
      const result = new MissingRequiredScript(mockTarget, new Date(), 'agent entry', entry)
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], mockTarget, mockAlertDestinations)

      // An absent pinned control is closest to tampering, not to a discovery.
      expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: 'script-mismatch-channel' }))
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

    it('should route to the header detection channel for detection workflow', async () => {
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
          channel: 'detection-header-channel',
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

    it('uses the override URL set via setReviewUrl in place of the branch-compare URL', async () => {
      service.setReviewUrl('https://github.com/example/script-inventory/pull/42')
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const script: DetectedScript = {
        name: 'https://cdn.example.com/new-script.js',
        content: 'x',
        hash: { value: 'h' },
      }
      const result = new UnknownScriptFound(inventoryTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/pull/42')
    })

    it('falls back to the branch-compare URL after setReviewUrl(null) clears the override', async () => {
      service.setReviewUrl('https://github.com/example/script-inventory/pull/42')
      service.setReviewUrl(null)
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const script: DetectedScript = {
        name: 'https://cdn.example.com/new-script.js',
        content: 'x',
        hash: { value: 'h' },
      }
      const result = new UnknownScriptFound(inventoryTarget, new Date(), script)

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Block[] }
      const actionsBlock = findActionsBlock(payload)
      expect(actionsBlock?.elements?.[0]?.url).toBe('https://github.com/example/script-inventory/compare/inventory-updates?expand=1')
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

  describe('Inventory-mode messaging splits by actual diff outcome', () => {
    // Regression: the inventory-mode "Inventory updated" alert fired for any
    // known_*_unauthorised_content result, even when the diff intentionally
    // did NOT auto-update the entry (e.g. AndMatcher entries, non-hash/content
    // authorisers, duplicates). The alert layer now consumes the diff's
    // applied-results set and routes accordingly.
    const buildScriptResult = (matcherType: 'hash' | 'and' = 'hash'): KnownScriptWithUnauthorisedContentFound => {
      const matcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'fail' }),
        getType: () => matcherType,
        getPattern: () => 'pattern',
        getDescription: () => `${matcherType}:pattern`,
      }
      return new KnownScriptWithUnauthorisedContentFound(
        { ...mockTarget, type: 'inventory' },
        new Date(),
        { name: 'https://cdn.example.com/x.js', content: 'x', hash: { value: 'h' } },
        { identifyWith: matcher, authoriseWith: { matcher, authorisationInfo: { description: 'd', authorised: true, date: new Date() } } },
        matcher,
        'failure',
      )
    }

    const buildHeaderResult = (): KnownHeaderWithUnauthorisedContentFound => {
      const matcher: Matcher = {
        identify: () => true,
        authorize: () => ({ authorized: false, reason: 'fail' }),
        getType: () => 'and',
        getPattern: () => 'pattern',
        getDescription: () => 'and:pattern',
      }
      const target: Target = { ...mockTarget, type: 'inventory' }
      const entry: InventoryHeaderInfo = {
        identifyWith: matcher,
        authoriseWith: { matcher, authorisationInfo: { description: 'd', authorised: true, date: new Date() } },
      }
      return new KnownHeaderWithUnauthorisedContentFound(target, new Date(), { name: 'x', value: 'y', target, workflow: target.workflow }, entry, matcher, 'failure')
    }

    const getTitleText = (payload: any): string => {
      const section = payload.blocks.find((b: any) => b.type === 'section' && typeof b.text?.text === 'string' && b.text.text.includes(':warning:'))
      return section?.text?.text ?? ''
    }

    it('uses "Inventory updated" for scripts in the applied set', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const result = buildScriptResult('hash')
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations, new Set<ComparisonResultType>([result]))

      expect(sendMessageSpy).toHaveBeenCalledTimes(1)
      const payload = sendMessageSpy.mock.calls[0]?.[0]
      expect(getTitleText(payload)).toContain('Inventory updated')
    })

    it('uses "Manual review required" for scripts that the diff did NOT apply', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const result = buildScriptResult('and')
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      // Empty applied set ⇒ the result was skipped by the diff.
      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations, new Set<ComparisonResultType>())

      expect(sendMessageSpy).toHaveBeenCalledTimes(1)
      const payload = sendMessageSpy.mock.calls[0]?.[0]
      expect(getTitleText(payload)).toContain('Manual review required')
      expect(getTitleText(payload)).not.toContain('Inventory updated')
    })

    it('splits a single batch with both applied and skipped scripts into two messages', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const applied = buildScriptResult('hash')
      const skipped = buildScriptResult('and')
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([applied, skipped], inventoryTarget, mockAlertDestinations, new Set<ComparisonResultType>([applied]))

      expect(sendMessageSpy).toHaveBeenCalledTimes(2)
      const titles = sendMessageSpy.mock.calls.map((args: unknown[]) => getTitleText(args[0]))
      expect(titles.some((t: string) => t.includes('Inventory updated'))).toBe(true)
      expect(titles.some((t: string) => t.includes('Manual review required'))).toBe(true)
    })

    it('uses "Manual review required" for headers the diff did NOT apply', async () => {
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const result = buildHeaderResult()
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations, new Set<ComparisonResultType>())

      expect(sendMessageSpy).toHaveBeenCalledTimes(1)
      const payload = sendMessageSpy.mock.calls[0]?.[0]
      expect(getTitleText(payload)).toContain('Manual review required')
    })

    it('falls back to "Inventory updated" wording when no applied set is supplied (backwards-compatible)', async () => {
      // Callers that haven't been updated to thread the applied set through
      // (e.g. older tests, tests focused on other behaviours) should keep
      // observing the historical inventory message.
      const inventoryTarget: Target = { ...mockTarget, type: 'inventory' }
      const result = buildScriptResult('hash')
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertForTypedResults([result], inventoryTarget, mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]?.[0]
      expect(getTitleText(payload)).toContain('Inventory updated')
    })
  })
})

/**
 * Unit tests for SlackAlertService.alertOnRunCompletion()
 *
 * Tests for Phase 3 (User Story 1):
 * - T008: SlackAlertService.alertOnRunCompletion() message payload verification
 *   - Sends to correct channel based on mode
 *   - Uses Slack Block Kit format with green check mark emoji
 *   - Includes all required execution details
 *   - Handles optional executionDuration
 *   - Error handling (logs and continues)
 */
import { ExecutionMode } from '../../types/config.js'
import type { ExecutionSummary } from '../../types/execution-summary.js'

describe('SlackAlertService - alertOnRunCompletion (Phase 3)', () => {
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

  describe('auditor report link', () => {
    const blocksOf = async (summary: ExecutionSummary): Promise<any[]> => {
      const spy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
      await service.alertOnRunCompletion(summary, mockAlertDestinations)
      return (spy.mock.calls[0]![0] as any).blocks
    }

    it('links the workflow run page, not a direct artifact URL', async () => {
      // The artifact is uploaded by a LATER workflow step, so it has no URL
      // when this message is sent. The run page lists it and also carries the
      // job-summary digest — do not "improve" this into an artifact link.
      const blocks = await blocksOf(createSummary({ auditorReport: { runUrl: 'https://github.com/org/repo/actions/runs/123', htmlPaths: ['/w/reports/detection/report.html'] } }))
      const button = blocks.find((block) => block.accessory?.action_id === 'view_auditor_report')

      expect(button).toBeDefined()
      expect(button.accessory.url).toBe('https://github.com/org/repo/actions/runs/123')
      expect(button.accessory.type).toBe('button')
    })

    it('falls back to written paths when there is no run page', async () => {
      const blocks = await blocksOf(createSummary({ auditorReport: { runUrl: null, htmlPaths: ['/local/reports/detection/report.html'] } }))
      const section = blocks.find((block) => typeof block.text?.text === 'string' && block.text.text.includes('Auditor Report'))

      expect(section.text.text).toContain('/local/reports/detection/report.html')
      expect(section.accessory).toBeUndefined()
    })

    it('pluralises when --mode all wrote a report per pass', async () => {
      const blocks = await blocksOf(createSummary({ auditorReport: { runUrl: null, htmlPaths: ['/w/reports/inventory/report.html', '/w/reports/detection/report.html'] } }))

      expect(blocks.some((block) => typeof block.text?.text === 'string' && block.text.text.includes('*Auditor Reports*'))).toBe(true)
    })

    it('adds nothing when no report was produced', async () => {
      const withoutReport = await blocksOf(createSummary())
      const withNull = await blocksOf(createSummary({ auditorReport: null }))

      for (const blocks of [withoutReport, withNull]) {
        expect(blocks.some((block) => JSON.stringify(block).includes('Auditor Report'))).toBe(false)
      }
    })
  })

  /**
   * T005: Tests for alertOnRunCompletion using successNotification destination
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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'divider' })]),
        }),
      )
    })

    it('should include execution mode in message', async () => {
      const summary = createSummary({ mode: ExecutionMode.Inventory })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

  describe('Run outcome rendering', () => {
    const failedToast = { name: '1.0 Toast staging', pass: 'inventory' as const, reason: 'Timed out waiting for selector \'[id="credit_card_number"]\'' }

    it('keeps the green headline and the Processed label when nothing failed', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ targetsFailed: [] }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '')
      expect(texts[0]).toBe(':white_check_mark: *Workflow Execution Completed Successfully* :white_check_mark:')
      expect(texts).toContain('*Targets Processed*: 1.0, 2.0')
      expect(texts.some((text: string) => text.includes('Failed'))).toBe(false)
    })

    it('switches to a warning headline and names each failed target with its pass and reason', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ targetsProcessed: ['1.0 Stripe staging', '2.0 Stripe staging'], targetsFailed: [failedToast] }), mockAlertDestinations)

      const payload = sendMessageSpy.mock.calls[0]![0] as any
      const texts = payload.blocks.map((block: any) => block.text?.text ?? '')
      expect(payload.channel).toBe('success-channel')
      expect(texts[0]).toBe(':warning: *Workflow Execution Completed With 1 Failed Target* :warning:')
      expect(texts).toContain('*Targets Succeeded*: 1.0 Stripe staging, 2.0 Stripe staging')
      const failedBlock = texts.find((text: string) => text.startsWith('*Target Failed (1)*'))
      expect(failedBlock).toContain('*not monitored*')
      expect(failedBlock).toContain('• `1.0 Toast staging` (inventory): Timed out waiting for selector \'[id="credit_card_number"]\'')
    })

    it('pluralises the headline and lists every failure without truncation', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
      const failures = Array.from({ length: 8 }, (_, index) => ({ name: `target-${index}`, pass: 'detection' as const, reason: `reason ${index}` }))

      await service.alertOnRunCompletion(createSummary({ targetsProcessed: ['1.0'], targetsFailed: failures }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '')
      expect(texts[0]).toBe(':warning: *Workflow Execution Completed With 8 Failed Targets* :warning:')
      const failedBlock = texts.find((text: string) => text.startsWith('*Targets Failed (8)*'))
      for (const failure of failures) expect(failedBlock).toContain(`\`${failure.name}\` (detection): ${failure.reason}`)
      expect(failedBlock).not.toContain('and ')
    })

    it("splits a long failed list across sections that each stay under Slack's 3000-character cap", async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
      const failures = Array.from({ length: 12 }, (_, index) => ({ name: `variation-${index}`, pass: 'inventory' as const, reason: `${index}-`.padEnd(320, 'r') }))

      await service.alertOnRunCompletion(createSummary({ targetsProcessed: ['1.0'], targetsFailed: failures }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
      const failedSections = texts.filter((text) => text.startsWith('*Targets Failed'))
      expect(failedSections.length).toBeGreaterThan(1)
      for (const section of failedSections) expect(section.length).toBeLessThanOrEqual(3000)
      expect(failedSections[0]).toMatch(/^\*Targets Failed \(12\)\*/)
      expect(failedSections[1]).toMatch(/^\*Targets Failed \(continued\)\*/)
      const joined = failedSections.join('\n')
      for (const failure of failures) expect(joined).toContain(`\`${failure.name}\` (inventory)`)
    })

    it('escapes mrkdwn control characters in the reason so a page-influenced error cannot ping or spoof', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ targetsFailed: [{ ...failedToast, reason: '<!channel> see <https://evil.example/review|Review changes> & act' }] }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
      const failedBlock = texts.find((text) => text.startsWith('*Target Failed (1)*')) as string
      expect(failedBlock).toContain('&lt;!channel&gt; see &lt;https://evil.example/review|Review changes&gt; &amp; act')
      expect(failedBlock).not.toContain('<!channel>')
    })

    it('names undelivered alerts in the headline and in their own section', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
      const undelivered = [{ alert: 'unauthorized header alerts', target: 'https://pay.example.com/checkout?return=<x>', reason: 'Slack rejected the message: invalid_blocks' }]

      await service.alertOnRunCompletion(createSummary({ targetsFailed: [failedToast], alertsUndelivered: undelivered }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
      expect(texts[0]).toBe(':warning: *Workflow Execution Completed With 1 Failed Target And 1 Undelivered Alert* :warning:')
      const block = texts.find((text) => text.startsWith('*Alert Not Delivered (1)*')) as string
      expect(block).toContain('*never reached Slack*')
      expect(block).toContain('• unauthorized header alerts for `https://pay.example.com/checkout?return=&lt;x&gt;`: Slack rejected the message: invalid_blocks')
    })

    it('uses the warning headline for undelivered alerts alone, with every target succeeded', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ alertsUndelivered: [{ alert: 'missing header alerts', target: null, reason: 'boom' }] }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
      expect(texts[0]).toBe(':warning: *Workflow Execution Completed With 1 Undelivered Alert* :warning:')
      expect(texts).toContain('*Targets Processed*: 1.0, 2.0')
    })

    it('clips an overlong reason per entry rather than dropping the entry', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ targetsFailed: [{ ...failedToast, reason: 'x'.repeat(1000) }] }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '')
      const failedBlock = texts.find((text: string) => text.startsWith('*Target Failed (1)*')) as string
      expect(failedBlock).toContain(`${'x'.repeat(300)}…`)
      expect(failedBlock).not.toContain('x'.repeat(301))
    })

    it('uses the red headline and "(none)" when every target failed', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(createSummary({ targetsProcessed: [], targetsFailed: [failedToast] }), mockAlertDestinations)

      const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '')
      expect(texts[0]).toBe(':red_circle: *Workflow Execution Failed For Every Target* :red_circle:')
      expect(texts).toContain('*Targets Succeeded*: (none)')
    })
  })

  describe('Target list formatting', () => {
    it('should display all targets when <= 5', async () => {
      const summary = createSummary({ targetsProcessed: ['1.0', '2.0', '3.0'] })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

      const callArg = sendMessageSpy.mock.calls[0]?.[0] as { blocks: Array<{ text?: { text: string } }> }
      const blockTexts = callArg.blocks.filter((b) => b.text?.text).map((b) => b.text?.text)
      expect(blockTexts.some((text) => text?.includes('Execution Duration'))).toBe(false)
    })

    it('should include executionDuration block when provided', async () => {
      const summary = createSummary({ executionDuration: 5000 })

      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

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

      await expect(service.alertOnRunCompletion(summary, mockAlertDestinations)).resolves.not.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[Alert Error] Failed to send the run summary notification: '))

      consoleErrorSpy.mockRestore()
    })

    it('treats an HTTP 200 with ok:false from Slack as a delivery failure and logs it', async () => {
      const summary = createSummary()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      ;(axios.post as jest.Mock).mockResolvedValueOnce({ data: { ok: false, error: 'invalid_blocks' } })

      await expect(service.alertOnRunCompletion(summary, mockAlertDestinations)).resolves.not.toThrow()

      expect(consoleErrorSpy).toHaveBeenCalledWith('[Alert Error] Failed to send the run summary notification: Slack rejected the message: invalid_blocks')

      consoleErrorSpy.mockRestore()
    })

    it('should log to console before sending message', async () => {
      const summary = createSummary()
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

      await service.alertOnRunCompletion(summary, mockAlertDestinations)

      expect(consoleLogSpy).toHaveBeenCalledWith('[Alert → Success]: Workflow execution completed successfully')

      consoleLogSpy.mockRestore()
    })
  })

  describe('RUM alert mrkdwn safety', () => {
    it('escapes backticks in attacker-influenced context values so they cannot break out of the code span', async () => {
      const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      await service.alertForRumObservation(
        'rum_uninventoried_script_detected',
        {
          observation: { kind: 'external-script', identity: 'https://evil.example.org/skim.js?q=`*payload*`' },
          prevalence: { first_seen: 1755600000123 },
          first_route: '/checkout',
          targetType: 'detection',
          inventoryRef: 'abc1234',
        },
        mockAlertDestinations,
      )

      const payload = JSON.stringify(sendMessageSpy.mock.calls[0]?.[0])
      // No raw backtick from the value survives inside the mrkdwn text: the
      // only backticks left are the code-span delimiters the template adds.
      expect(payload).not.toContain('?q=`')
      expect(payload).toContain('?q=ˋ*payload*ˋ')

      consoleLogSpy.mockRestore()
    })
  })
})

describe('SlackAlertService - delivery accountability', () => {
  const destinations: InventoryAlert = {
    inventory: { newScriptIdentified: { destination: '#inv' }, newHeaderIdentified: { destination: '#inv' } },
    detection: { newScriptDetected: { destination: '#det' }, scriptMismatchDetected: { destination: '#det' }, newHeaderDetected: { destination: '#det' } },
    successNotification: { destination: '#ok' },
  }
  const target = { type: 'detection', url: 'https://book.example.com/venue?view=times', workflow: { fileName: 'w.json', definition: { steps: [] } } } as unknown as Target

  /** One unauthorised CSP header row shaped like the production finding that Slack rejected. */
  const unauthorisedCsp = (index: number): KnownHeaderWithUnauthorisedContentFound => {
    const matcher = { getType: () => 'or', getPattern: () => ['^form-action .*$'], identify: () => true, authorize: () => ({ authorized: false, reason: 'No child matcher identified the resource' }) } as unknown as Matcher
    const header = {
      name: 'content-security-policy',
      value: `form-action 'self' https://pixel.example.net; frame-src 'self' https://wallet.example.org https://tags.example.com https://pixel.example.net #${index}`,
      url: `https://book.example.com/page-${index}`,
    } as unknown as DetectedHeader
    const entry = { identifyWith: matcher, authoriseWith: { matcher, authorisationInfo: { description: 'x', authorised: true, date: '2026-01-01T00:00:00.000Z' } } } as unknown as InventoryHeaderInfo
    return new KnownHeaderWithUnauthorisedContentFound(target, new Date('2026-09-14T00:00:00.000Z'), header, entry, matcher, 'No child matcher identified the resource')
  }

  const tableChars = (payload: any): number => {
    const walk = (node: any): number =>
      node && typeof node === 'object' ? (typeof node.text === 'string' ? node.text.length : 0) + (Array.isArray(node.elements) ? node.elements.reduce((sum: number, child: any) => sum + walk(child), 0) : 0) : 0
    return payload.blocks
      .filter((block: any) => block.type === 'table')
      .flatMap((block: any) => block.rows.flat())
      .reduce((sum: number, cell: any) => sum + walk(cell), 0)
  }

  it("keeps a 14-row unauthorised-header table under Slack's 10,000-character cap and says how many rows were cut", async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)

    await service.alertForTypedResults(
      Array.from({ length: 14 }, (_, index) => unauthorisedCsp(index)),
      target,
      destinations,
    )

    const payload = sendMessageSpy.mock.calls[0]![0] as any
    expect(tableChars(payload)).toBeLessThanOrEqual(10000)
    const table = payload.blocks.find((block: any) => block.type === 'table')
    const shown = table.rows.length - 1
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(14)
    const note = payload.blocks.map((block: any) => block.text?.text ?? '').find((text: string) => text.startsWith('_Showing'))
    expect(note).toBe(`_Showing ${shown} of 14. The full list is in the auditor report._`)
    expect(service.getDeliveryFailures()).toEqual([])
  })

  it('clips one oversize cell instead of losing the whole table', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
    const huge = unauthorisedCsp(0)
    ;(huge.header as { value: string }).value = 'x'.repeat(20000)

    await service.alertForTypedResults([huge], target, destinations)

    const payload = sendMessageSpy.mock.calls[0]![0] as any
    expect(tableChars(payload)).toBeLessThanOrEqual(10000)
    const table = payload.blocks.find((block: any) => block.type === 'table')
    expect(table.rows).toHaveLength(2)
    const valueCell = table.rows[1][1]
    expect(valueCell.elements[0].elements[0].text.endsWith('…')).toBe(true)
  })

  it('records a rejected run summary as an undelivered alert, without throwing', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ;(axios.post as jest.Mock).mockResolvedValueOnce({ data: { ok: false, error: 'channel_not_found' } })
    const summary: ExecutionSummary = {
      mode: ExecutionMode.Detection,
      targetsProcessed: ['1.0'],
      repositoryUrl: 'https://github.example.com/org/inv',
      inventoryBranch: null,
      detectionBranch: 'main',
      resourceCount: 1,
      completedAt: new Date('2026-09-14T00:00:00.000Z'),
    }

    await expect(service.alertOnRunCompletion(summary, destinations)).resolves.toBeUndefined()

    expect(service.getDeliveryFailures()).toEqual([{ alert: 'the run summary notification', target: null, reason: 'Slack rejected the message: channel_not_found' }])
    consoleErrorSpy.mockRestore()
  })

  it('records a rejected pull-request-failure notice as an undelivered alert', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ;(axios.post as jest.Mock).mockResolvedValueOnce({ data: { ok: false, error: 'invalid_blocks' } })

    await expect(service.alertOnPullRequestFailure({ error: new Error('422'), repoUrl: 'https://github.example.com/org/inv', headBranch: 'inventory-updates', baseBranch: 'main' }, destinations)).resolves.toBeUndefined()

    expect(service.getDeliveryFailures()).toEqual([{ alert: 'PR-failure notification', target: null, reason: 'Slack rejected the message: invalid_blocks' }])
    consoleErrorSpy.mockRestore()
  })

  it('redacts credentials from a recorded delivery reason', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ;(axios.post as jest.Mock).mockRejectedValueOnce(new Error('connect failed for https://user:hunter2@slack.example.com/api?token=abc'))

    await service.alertForTypedResults([unauthorisedCsp(0)], target, destinations)

    const [failure] = service.getDeliveryFailures()
    expect(failure?.reason).not.toContain('hunter2')
    expect(failure?.reason).not.toContain('token=abc')
    expect(failure?.reason).toContain('slack.example.com')
    consoleErrorSpy.mockRestore()
  })

  it('escapes and clips undelivered-alert reasons and targets, and splits a long list across sections', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
    const undelivered = [
      { alert: 'unknown script alerts', target: `https://pay.example.com/${'p'.repeat(1000)}`, reason: `<!channel> ${'r'.repeat(1000)}` },
      ...Array.from({ length: 12 }, (_, index) => ({ alert: `alert-${index}`, target: `https://t${index}.example.com/${'q'.repeat(280)}`, reason: 's'.repeat(320) })),
    ]
    const summary: ExecutionSummary = {
      mode: ExecutionMode.Detection,
      targetsProcessed: ['1.0'],
      alertsUndelivered: undelivered,
      repositoryUrl: 'https://github.example.com/org/inv',
      inventoryBranch: null,
      detectionBranch: 'main',
      resourceCount: 1,
      completedAt: new Date('2026-09-14T00:00:00.000Z'),
    }

    await service.alertOnRunCompletion(summary, destinations)

    const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
    const sections = texts.filter((text) => text.startsWith('*Alerts Not Delivered'))
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) expect(section.length).toBeLessThanOrEqual(3000)
    const first = sections[0] as string
    expect(first).toContain('&lt;!channel&gt;')
    expect(first).not.toContain('<!channel>')
    // The whole target URL is clipped to 300 characters, scheme and host included.
    expect(first).toContain(`https://pay.example.com/${'p'.repeat(276)}…\``)
    expect(first).not.toContain('p'.repeat(277))
    // The reason is clipped to 300 characters including its escaped prefix.
    expect(first).toContain(`&lt;!channel&gt; ${'r'.repeat(289)}…`)
    expect(first).not.toContain('r'.repeat(290))
    expect(sections.join('\n')).toContain('alert-11')
  })

  it('still sends the manual-review variant when the inventory-updated variant was rejected, recording each on its own', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const inventoryTarget = { ...target, type: 'inventory' } as unknown as Target
    const applied = unauthorisedCsp(0)
    const skipped = unauthorisedCsp(1)
    ;(axios.post as jest.Mock).mockResolvedValueOnce({ data: { ok: false, error: 'invalid_blocks' } }).mockResolvedValueOnce({ data: { ok: true } })
    const postsBefore = (axios.post as jest.Mock).mock.calls.length

    await service.alertForTypedResults([applied, skipped], inventoryTarget, destinations, new Set([applied]))

    expect((axios.post as jest.Mock).mock.calls.length - postsBefore).toBe(2)
    expect(service.getDeliveryFailures()).toEqual([{ alert: 'unauthorized header alerts', target: inventoryTarget.url, reason: 'Slack rejected the message: invalid_blocks' }])
    consoleErrorSpy.mockRestore()
  })

  it('never logs the raw transport error, which can carry the Authorization header', async () => {
    const service = new SlackAlertService('secret-token-xyz', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const axiosError = Object.assign(new Error('Request failed with status code 500'), { config: { headers: { Authorization: 'Bearer secret-token-xyz' } } })
    ;(axios.post as jest.Mock).mockRejectedValueOnce(axiosError)

    await service.alertForTypedResults([unauthorisedCsp(0)], target, destinations)

    const logged = consoleErrorSpy.mock.calls.map((call) => call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')).join('\n')
    expect(logged).toContain('[Alert Error] Failed to send unauthorized header alerts: Request failed with status code 500')
    expect(logged).not.toContain('secret-token-xyz')
    expect(consoleErrorSpy.mock.calls.every((call) => call.length === 1)).toBe(true)
    consoleErrorSpy.mockRestore()
  })

  it('bounds a list line after escaping so entity expansion cannot push a section past 3,000 characters', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const sendMessageSpy = jest.spyOn(service as any, 'sendMessage').mockResolvedValue(undefined)
    const summary: ExecutionSummary = {
      mode: ExecutionMode.Detection,
      targetsProcessed: ['1.0'],
      targetsFailed: [{ name: '&'.repeat(600), pass: 'detection', reason: '<'.repeat(300) }],
      alertsUndelivered: [{ alert: '&'.repeat(600), target: '<'.repeat(300), reason: '>'.repeat(300) }],
      repositoryUrl: 'https://github.example.com/org/inv',
      inventoryBranch: null,
      detectionBranch: 'main',
      resourceCount: 1,
      completedAt: new Date('2026-09-14T00:00:00.000Z'),
    }

    await service.alertOnRunCompletion(summary, destinations)

    const texts = (sendMessageSpy.mock.calls[0]![0] as any).blocks.map((block: any) => block.text?.text ?? '') as string[]
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(3000)
    const lists = texts.filter((text) => text.startsWith('*Target Failed') || text.startsWith('*Alert Not Delivered'))
    expect(lists).toHaveLength(2)
    for (const list of lists) for (const line of list.split('\n').slice(1)) expect(line.length).toBeLessThanOrEqual(1401)
  })

  it('records a Slack rejection as a delivery failure naming the alert and target, without throwing', async () => {
    const service = new SlackAlertService('t', 'https://github.com/example/inv', 'inventory-updates')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    ;(axios.post as jest.Mock).mockResolvedValueOnce({ data: { ok: false, error: 'invalid_blocks' } })

    await expect(service.alertForTypedResults([unauthorisedCsp(0)], target, destinations)).resolves.toBeUndefined()

    expect(service.getDeliveryFailures()).toEqual([{ alert: 'unauthorized header alerts', target: 'https://book.example.com/venue?view=times', reason: 'Slack rejected the message: invalid_blocks' }])
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[Alert Error] Failed to send unauthorized header alerts: '))
    consoleErrorSpy.mockRestore()
  })
})
