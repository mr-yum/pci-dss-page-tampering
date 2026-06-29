/**
 * Inventory Service Unit Tests
 *
 * Tests for ScriptInventoryService, particularly the updateScriptWithNewHash method
 * which handles adding new hashes to scripts with different authoriseWith configurations.
 *
 * @see src/services/inventory.ts - ScriptInventoryService
 */

import { KnownHeaderWithUnauthorisedContentFound } from '../types/comparison/known-header-unauthorised-content-found.js'
import { KnownScriptWithUnauthorisedContentFound } from '../types/comparison/known-script-unauthorised-content-found.js'
import { UnknownHeaderFound } from '../types/comparison/unknown-header-found.js'
import { UnknownScriptFound } from '../types/comparison/unknown-script-found.js'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model.js'
import type { HashMatcher } from '../types/matcher/hash-matcher.js'
import type { OrMatcher } from '../types/matcher/or-matcher.js'
import type { Target, TargetDetection, TargetInventory } from '../types/target.js'
import type { Workflow } from '../types/workflow.js'
import { inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory.js'
import { createLogger } from '../utils/logger.js'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script.js'
import { ScriptInventoryService } from './inventory.js'

describe('ScriptInventoryService', () => {
  const mockWorkflow: Workflow = {
    fileName: 'default.json',
    definition: { steps: [] },
  }

  const mockLogger = createLogger('test')

  // Helper to create a mock inventory
  const createMockInventory = (scripts: InventoryScriptInfo[]): Inventory => ({
    fileName: 'test-inventory.json',
    scripts,
    headers: [],
    alerts: {
      inventory: {
        newScriptIdentified: { destination: 'https://example.com/webhook1' },
        newHeaderIdentified: { destination: 'https://example.com/webhook2' },
      },
      detection: {
        newScriptDetected: { destination: 'https://example.com/webhook3' },
        scriptMismatchDetected: { destination: 'https://example.com/webhook4' },
        newHeaderDetected: { destination: 'https://example.com/webhook5' },
      },
      successNotification: { destination: 'https://example.com/webhook6' },
    },
    target: {
      inventory: {
        type: 'inventory',
        name: 'Test Target',
        url: 'https://staging.example.com',
        workflow: mockWorkflow,
        logger: mockLogger,
      } as TargetInventory,
      detection: {
        type: 'detection',
        name: 'Test Target',
        url: 'https://production.example.com',
        workflow: mockWorkflow,
        logger: mockLogger,
      } as TargetDetection,
    },
  })

  const createMockTarget = (): Target => ({
    name: 'Test Target',
    type: 'inventory',
    url: 'https://staging.example.com',
    workflow: mockWorkflow,
    logger: mockLogger,
  })

  describe('updateScriptWithNewHash', () => {
    let service: ScriptInventoryService

    beforeEach(() => {
      // Create mock repository (we're testing private method via diff)
      const mockRepository = {
        pull: jest.fn(),
        push: jest.fn(),
      }
      service = new ScriptInventoryService({ inventoryRepository: mockRepository })
    })

    describe('Bug Fix: Array syntax handling', () => {
      it('should append new hash to existing array syntax when authorized by hash matcher', async () => {
        // Arrange: Script with array syntax containing only hash matchers
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^inline_script\\/staging\\.example\\.com\\/.*$' },
          authoriseWith: [
            {
              hashes: [
                {
                  timestamp: '2025-10-26T23:04:48.229Z',
                  hash: { value: 'abc123' },
                },
              ],
              authorisationInfo: {
                description: 'Hash v1',
                authorised: true,
                date: '2025-10-26T23:04:48.921Z',
              },
            },
            {
              hashes: [
                {
                  timestamp: '2025-10-26T23:05:00.000Z',
                  hash: { value: 'xyz789' },
                },
              ],
              authorisationInfo: {
                description: 'Hash v2',
                authorised: true,
                date: '2025-10-26T23:05:00.000Z',
              },
            },
          ],
        })

        const inventory = createMockInventory([existingScript])

        // Get the hash matcher from the array (OrMatcher contains hash matchers)
        const orMatcher = existingScript.authoriseWith.matcher as OrMatcher
        const hashMatcher = orMatcher.getPattern()[0] as HashMatcher

        // Create comparison result: same script with new hash, authorized by specific hash matcher
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'inline_script/staging.example.com/checkout.js',
            content: 'new content',
            hash: { value: 'def456' },
          },
          existingScript,
          hashMatcher, // Use hash matcher, not the whole OrMatcher
          'hash def456 not in authorized list',
        )

        // Act: Process the comparison result
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Updated inventory should have 3 elements in array (not nested arrays)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        // Verify it's still an array
        expect(Array.isArray(rawUpdatedScript.authoriseWith)).toBe(true)

        // Verify we have 3 elements (2 original + 1 new)
        if (Array.isArray(rawUpdatedScript.authoriseWith)) {
          expect(rawUpdatedScript.authoriseWith.length).toBe(3)

          // Verify third element is the new hash
          const thirdElement = rawUpdatedScript.authoriseWith[2]
          expect('hashes' in thirdElement).toBe(true)
          if ('hashes' in thirdElement) {
            expect(thirdElement.hashes[0].hash.value).toBe('def456')
          }

          // Verify no nested arrays (the bug we fixed)
          rawUpdatedScript.authoriseWith.forEach((element) => {
            expect(Array.isArray(element)).toBe(false)
            expect(typeof element).toBe('object')
            expect('authorisationInfo' in element).toBe(true)
          })
        }

        // Verify the matcher is still an OrMatcher with 3 children
        expect(updatedScript.authoriseWith.matcher.getType()).toBe('or')
        const orMatcher2 = updatedScript.authoriseWith.matcher as OrMatcher
        expect(orMatcher2.getPattern()).toHaveLength(3)
      })

      it('should not add duplicate hash to existing array', async () => {
        // Arrange: Script with array syntax containing a hash
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/script\\.js$' },
          authoriseWith: [
            {
              hashes: [
                {
                  timestamp: '2025-10-26T00:00:00.000Z',
                  hash: { value: 'existing-hash' },
                },
              ],
              authorisationInfo: {
                description: 'Version 1.0',
                authorised: true,
                date: '2025-10-26T00:00:00.000Z',
              },
            },
          ],
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: same hash (duplicate)
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'https://cdn.example.com/script.js',
            content: 'same content',
            hash: { value: 'existing-hash' },
          },
          existingScript,
          existingScript.authoriseWith.matcher,
          'hash existing-hash not in authorized list',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Array should still have 1 element (no duplicate)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect(Array.isArray(rawUpdatedScript.authoriseWith)).toBe(true)
        if (Array.isArray(rawUpdatedScript.authoriseWith)) {
          expect(rawUpdatedScript.authoriseWith.length).toBe(1)
        }
      })
    })

    describe('Existing behavior: Single matcher with hashes', () => {
      it('should append hash to single hashes matcher', async () => {
        // Arrange: Script with single hashes matcher (not array syntax)
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/payment\\.js$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: '2025-10-20T00:00:00.000Z',
                hash: { value: 'old-hash' },
              },
            ],
            authorisationInfo: {
              description: 'Payment script',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: new hash
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'https://cdn.example.com/payment.js',
            content: 'updated content',
            hash: { value: 'new-hash' },
          },
          existingScript,
          existingScript.authoriseWith.matcher,
          'hash new-hash not in authorized list',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Should have 2 hashes in the same matcher
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(true)
        if ('hashes' in rawUpdatedScript.authoriseWith) {
          expect(rawUpdatedScript.authoriseWith.hashes.length).toBe(2)
          expect(rawUpdatedScript.authoriseWith.hashes[0].hash.value).toBe('old-hash')
          expect(rawUpdatedScript.authoriseWith.hashes[1].hash.value).toBe('new-hash')
        }
      })

      it('should not add duplicate hash to single hashes matcher', async () => {
        // Arrange
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/payment\\.js$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: '2025-10-20T00:00:00.000Z',
                hash: { value: 'same-hash' },
              },
            ],
            authorisationInfo: {
              description: 'Payment script',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: same hash
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'https://cdn.example.com/payment.js',
            content: 'same content',
            hash: { value: 'same-hash' },
          },
          existingScript,
          existingScript.authoriseWith.matcher,
          'hash same-hash not in authorized list',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Should still have 1 hash (no duplicate)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(true)
        if ('hashes' in rawUpdatedScript.authoriseWith) {
          expect(rawUpdatedScript.authoriseWith.hashes.length).toBe(1)
        }
      })
    })

    describe('Conversion: Non-hash matcher behavior', () => {
      it('should NOT convert single non-hash matcher to array syntax (hash not added)', async () => {
        // Arrange: Script with contentMatcher (not hashes)
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^inline_script\\/.*$' },
          authoriseWith: {
            contentMatcher: "fbq\\('init'",
            authorisationInfo: {
              description: 'Facebook Pixel initialization',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: new hash but authorized by contentMatcher
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'inline_script/checkout',
            content: 'updated fbq code',
            hash: { value: 'new-hash-123' },
          },
          existingScript,
          existingScript.authoriseWith.matcher, // contentMatcher, not hashMatcher
          'content does not match pattern',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Should remain unchanged (no conversion to array syntax)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        // Should still be a single contentMatcher (not array)
        expect(Array.isArray(rawUpdatedScript.authoriseWith)).toBe(false)
        expect('contentMatcher' in rawUpdatedScript.authoriseWith).toBe(true)

        // Verify no hashes were added
        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(false)

        // Verify the matcher is still a ContentMatcher (not OrMatcher)
        expect(updatedScript.authoriseWith.matcher.getType()).toBe('content')
      })
    })

    describe('Detection phase behavior: Only add hash when authorized by hashes', () => {
      it('should NOT add new hash when script is authorized by contentMatcher', async () => {
        // Arrange: Script with contentMatcher (not hashes)
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^inline_script\\/staging\\.example\\.com\\/.*$' },
          authoriseWith: {
            contentMatcher: "fbq\\('init'",
            authorisationInfo: {
              description: 'Facebook Pixel initialization',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: known script with unauthorized content
        // BUT authorized by contentMatcher, not hashes
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'inline_script/staging.example.com/checkout.js',
            content: 'different fbq code',
            hash: { value: 'new-hash-789' },
          },
          existingScript,
          existingScript.authoriseWith.matcher, // contentMatcher, not hashMatcher
          'content does not match pattern',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Inventory should remain UNCHANGED (no hash added)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        // Should still be a single contentMatcher (not converted to array)
        expect(Array.isArray(rawUpdatedScript.authoriseWith)).toBe(false)
        expect('contentMatcher' in rawUpdatedScript.authoriseWith).toBe(true)

        // Verify no hashes were added
        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(false)

        // Verify the matcher is still a ContentMatcher (not OrMatcher)
        expect(updatedScript.authoriseWith.matcher.getType()).toBe('content')
      })

      it('should add new hash when script is authorized by hashMatcher', async () => {
        // Arrange: Script with hashes matcher
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/payment\\.js$' },
          authoriseWith: {
            hashes: [
              {
                timestamp: '2025-10-20T00:00:00.000Z',
                hash: { value: 'old-hash' },
              },
            ],
            authorisationInfo: {
              description: 'Payment script',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: known script with unauthorized hash
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'https://cdn.example.com/payment.js',
            content: 'updated content',
            hash: { value: 'new-hash' },
          },
          existingScript,
          existingScript.authoriseWith.matcher, // hashMatcher
          'hash new-hash not in authorized list',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: New hash should be added
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(true)
        if ('hashes' in rawUpdatedScript.authoriseWith) {
          expect(rawUpdatedScript.authoriseWith.hashes.length).toBe(2)
          expect(rawUpdatedScript.authoriseWith.hashes[0].hash.value).toBe('old-hash')
          expect(rawUpdatedScript.authoriseWith.hashes[1].hash.value).toBe('new-hash')
        }
      })

      it('should NOT add new hash when script is authorized by nameMatcher', async () => {
        // Arrange: Script with nameMatcher (not hashes)
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/.*\\.js$' },
          authoriseWith: {
            nameMatcher: '^https://cdn\\.example\\.com/v[0-9]+\\.js$',
            authorisationInfo: {
              description: 'CDN scripts with version pattern',
              authorised: true,
              date: '2025-10-20T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        // Create comparison result: known script with unauthorized name
        const comparisonResult = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2025-10-27T10:00:00.000Z'),
          {
            name: 'https://cdn.example.com/custom.js',
            content: 'some content',
            hash: { value: 'new-hash-456' },
          },
          existingScript,
          existingScript.authoriseWith.matcher, // nameMatcher, not hashMatcher
          'name does not match pattern',
        )

        // Act
        const result = await service.diff(inventory, [comparisonResult])

        // Assert: Inventory should remain UNCHANGED (no hash added)
        const updatedScript = result.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return

        const rawUpdatedScript = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        // Should still be a single nameMatcher (not converted to array)
        expect(Array.isArray(rawUpdatedScript.authoriseWith)).toBe(false)
        expect('nameMatcher' in rawUpdatedScript.authoriseWith).toBe(true)

        // Verify no hashes were added
        expect('hashes' in rawUpdatedScript.authoriseWith).toBe(false)

        // Verify the matcher is still a NameMatcher (not OrMatcher)
        expect(updatedScript.authoriseWith.matcher.getType()).toBe('name')
      })
    })

    describe('Batched updates against a single inventory entry', () => {
      it('appends every new content matcher when multiple KnownHeaderWithUnauthorisedContentFound target the same header entry', async () => {
        // Regression: previously only the first result was applied because the
        // update replaced the entry with a fresh object, and subsequent results
        // (which still referenced the original entry) failed the reference check.
        const existingHeader = rawInventoryHeaderInfoToInventoryHeaderInfo({
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: [
            {
              contentMatcher: "^default-src 'self'$",
              authorisationInfo: {
                description: 'Baseline CSP',
                authorised: true,
                date: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        })

        const inventory: Inventory = {
          ...createMockInventory([]),
          headers: [existingHeader],
        }

        const newValues = [
          "style-src *.facebook.com *.fbcdn.net 'self'",
          "font-src *.facebook.com *.fbcdn.net 'self'",
          "img-src *.facebook.com *.fbcdn.net 'self'",
          "media-src *.facebook.com *.fbcdn.net 'self'",
          "child-src *.facebook.com *.fbcdn.net 'self'",
          "frame-src *.facebook.com *.fbcdn.net 'self'",
          "manifest-src *.facebook.com *.fbcdn.net 'self'",
          "object-src *.facebook.com *.fbcdn.net 'self'",
          "worker-src *.facebook.com *.fbcdn.net 'self'",
        ]

        const target = createMockTarget()
        const timestamp = new Date('2026-04-21T22:48:00.000Z')
        const results = newValues.map(
          (value) =>
            new KnownHeaderWithUnauthorisedContentFound(
              target,
              timestamp,
              { name: 'content-security-policy', value, target, workflow: target.workflow },
              existingHeader,
              existingHeader.authoriseWith.matcher,
              'No child matcher identified the resource',
            ),
        )

        const diffResult = await service.diff(inventory, results)

        const updatedHeader = diffResult.newInventory.headers[0]
        expect(updatedHeader).toBeDefined()
        if (!updatedHeader) return
        const rawUpdated = inventoryHeaderInfoToRawInventoryHeaderInfo(updatedHeader)

        expect(Array.isArray(rawUpdated.authoriseWith)).toBe(true)
        if (!Array.isArray(rawUpdated.authoriseWith)) return

        // 1 baseline + 9 new entries
        expect(rawUpdated.authoriseWith.length).toBe(1 + newValues.length)

        const contentPatterns = rawUpdated.authoriseWith.filter((m: any): m is { contentMatcher: string } => 'contentMatcher' in m).map((m) => m.contentMatcher)

        for (const value of newValues) {
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          expect(contentPatterns).toContain(`^${escaped}$`)
        }
      })

      it('deduplicates repeated header values across the batch', async () => {
        const existingHeader = rawInventoryHeaderInfoToInventoryHeaderInfo({
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            contentMatcher: "^default-src 'self'$",
            authorisationInfo: {
              description: 'Baseline CSP',
              authorised: true,
              date: '2026-01-01T00:00:00.000Z',
            },
          },
        })

        const inventory: Inventory = {
          ...createMockInventory([]),
          headers: [existingHeader],
        }

        const target = createMockTarget()
        const timestamp = new Date('2026-04-21T22:48:00.000Z')
        const duplicateValue = "style-src 'self'"
        const results = [duplicateValue, duplicateValue, duplicateValue].map(
          (value) =>
            new KnownHeaderWithUnauthorisedContentFound(
              target,
              timestamp,
              { name: 'content-security-policy', value, target, workflow: target.workflow },
              existingHeader,
              existingHeader.authoriseWith.matcher,
              'No child matcher identified the resource',
            ),
        )

        const diffResult = await service.diff(inventory, results)

        const updatedHeader = diffResult.newInventory.headers[0]
        expect(updatedHeader).toBeDefined()
        if (!updatedHeader) return
        const rawUpdated = inventoryHeaderInfoToRawInventoryHeaderInfo(updatedHeader)

        expect(Array.isArray(rawUpdated.authoriseWith)).toBe(true)
        if (!Array.isArray(rawUpdated.authoriseWith)) return

        // Baseline matcher + exactly one matcher for the duplicated value
        expect(rawUpdated.authoriseWith.length).toBe(2)
      })

      it('applies every new hash when multiple KnownScriptWithUnauthorisedContentFound target the same script entry', async () => {
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/payment\\.js$' },
          authoriseWith: {
            hashes: [{ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'baseline' } }],
            authorisationInfo: {
              description: 'Payment script',
              authorised: true,
              date: '2026-01-01T00:00:00.000Z',
            },
          },
        })

        const inventory = createMockInventory([existingScript])

        const target = createMockTarget()
        const timestamp = new Date('2026-04-21T22:48:00.000Z')
        const newHashes = ['hash-a', 'hash-b', 'hash-c']
        const results = newHashes.map(
          (hash) =>
            new KnownScriptWithUnauthorisedContentFound(
              target,
              timestamp,
              { name: 'https://cdn.example.com/payment.js', content: 'new content', hash: { value: hash } },
              existingScript,
              existingScript.authoriseWith.matcher,
              `hash ${hash} not in authorized list`,
            ),
        )

        const diffResult = await service.diff(inventory, results)

        const updatedScript = diffResult.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return
        const rawUpdated = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect('hashes' in rawUpdated.authoriseWith).toBe(true)
        if (!('hashes' in rawUpdated.authoriseWith)) return

        // 1 baseline + 3 new hashes, all landed
        const hashValues = rawUpdated.authoriseWith.hashes.map((h: any) => h.hash.value)
        expect(hashValues).toEqual(['baseline', ...newHashes])
      })
    })

    describe('push() no-op suppression', () => {
      it('does not call the repository when diffs contain no material changes', async () => {
        const mockRepository = {
          pull: jest.fn(),
          push: jest.fn().mockResolvedValue(undefined),
        }
        const noOpService = new ScriptInventoryService({ inventoryRepository: mockRepository })

        const unchanged = createMockInventory([])
        await noOpService.push([{ oldInventory: unchanged, newInventory: unchanged }])

        expect(mockRepository.push).not.toHaveBeenCalled()
      })

      it('does call the repository when diffs contain a material change', async () => {
        const mockRepository = {
          pull: jest.fn(),
          push: jest.fn().mockResolvedValue(undefined),
        }
        const pushService = new ScriptInventoryService({ inventoryRepository: mockRepository })

        const before = createMockInventory([])
        const after = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://new\\.example\\.com/new\\.js$' },
          authoriseWith: {
            hashes: [{ timestamp: '2026-04-22T00:00:00.000Z', hash: { value: 'h' } }],
            authorisationInfo: { description: 'x', authorised: false, date: '2026-04-22T00:00:00.000Z' },
          },
        })
        const newInventory = { ...before, scripts: [after] }

        await pushService.push([{ oldInventory: before, newInventory }])

        expect(mockRepository.push).toHaveBeenCalledTimes(1)
        const callArgs = mockRepository.push.mock.calls[0]
        expect(callArgs?.[2]).toMatch(/^inventory\(.+\): add 1 script$/)
      })
    })

    describe('Round-trip conversion', () => {
      it('should maintain array syntax through multiple round-trips', () => {
        // Arrange: Complex array syntax
        const originalRaw = {
          identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
          authoriseWith: [
            {
              nameMatcher: '^https://example\\.com/v1\\.js$',
              authorisationInfo: {
                description: 'Version 1',
                authorised: true,
                date: '2025-10-01T00:00:00.000Z',
              },
            },
            {
              nameMatcher: '^https://example\\.com/v2\\.js$',
              authorisationInfo: {
                description: 'Version 2',
                authorised: true,
                date: '2025-10-15T00:00:00.000Z',
              },
            },
            {
              hashes: [{ timestamp: '2025-10-20T00:00:00.000Z', hash: { value: 'hash-v3' } }],
              authorisationInfo: {
                description: 'Version 3',
                authorised: true,
                date: '2025-10-20T00:00:00.000Z',
              },
            },
          ],
        }

        // Act: Convert to inventory format and back multiple times
        let currentRaw = originalRaw
        for (let i = 0; i < 5; i++) {
          const inventoryFormat = rawInventoryScriptInfoToInventoryScriptInfo(currentRaw)
          currentRaw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryFormat)
        }

        // Assert: Should still be an array with 3 elements
        expect(Array.isArray(currentRaw.authoriseWith)).toBe(true)
        if (Array.isArray(currentRaw.authoriseWith)) {
          expect(currentRaw.authoriseWith.length).toBe(3)

          // Verify structure is preserved
          const elem0 = currentRaw.authoriseWith[0]
          const elem1 = currentRaw.authoriseWith[1]
          const elem2 = currentRaw.authoriseWith[2]

          expect(elem0).toBeDefined()
          expect(elem1).toBeDefined()
          expect(elem2).toBeDefined()

          if (elem0) expect('nameMatcher' in elem0).toBe(true)
          if (elem1) expect('nameMatcher' in elem1).toBe(true)
          if (elem2) expect('hashes' in elem2).toBe(true)

          // Verify no nested arrays
          currentRaw.authoriseWith.forEach((element) => {
            expect(Array.isArray(element)).toBe(false)
          })
        }
      })
    })

    describe('Composite matcher handling (top-level matcher gating)', () => {
      it('appends a new hash when the top-level authoriser is an OrMatcher (array syntax)', async () => {
        // Mirrors the realistic comparison-service contract: `authorizationMatcher`
        // is the TOP-LEVEL OrMatcher, not an inner child. Earlier code gated on
        // `instanceof HashMatcher` and silently dropped this case while still
        // alerting "Inventory updated" — which is the bug being fixed.
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/script\\.js$' },
          authoriseWith: [
            {
              hashes: [{ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'v1' } }],
              authorisationInfo: { description: 'v1', authorised: true, date: '2026-01-01T00:00:00.000Z' },
            },
            {
              hashes: [{ timestamp: '2026-02-01T00:00:00.000Z', hash: { value: 'v2' } }],
              authorisationInfo: { description: 'v2', authorised: true, date: '2026-02-01T00:00:00.000Z' },
            },
          ],
        })

        const inventory = createMockInventory([existingScript])

        const result = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2026-04-22T00:00:00.000Z'),
          { name: 'https://cdn.example.com/script.js', content: 'new content', hash: { value: 'v3' } },
          existingScript,
          existingScript.authoriseWith.matcher,
          'hash v3 not in authorized list',
        )

        const diff = await service.diff(inventory, [result])

        const updatedScript = diff.newInventory.scripts[0]
        expect(updatedScript).toBeDefined()
        if (!updatedScript) return
        const raw = inventoryScriptInfoToRawInventoryScriptInfo(updatedScript)

        expect(Array.isArray(raw.authoriseWith)).toBe(true)
        if (!Array.isArray(raw.authoriseWith)) return
        expect(raw.authoriseWith).toHaveLength(3)
        expect((raw.authoriseWith[2] as any).hashes[0].hash.value).toBe('v3')

        expect(diff.appliedResults).toEqual([result])
      })

      it('skips known_script_unauthorised_content when the top-level authoriser is an AndMatcher', async () => {
        // AndMatcher means "must satisfy ALL children" — adding an OR'd hash
        // alternative would silently weaken the operator's policy. The diff
        // must leave the entry alone; the alert layer surfaces it as
        // requiring manual review.
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/strict\\.js$' },
          authoriseWith: {
            andMatcher: [
              { contentMatcher: 'must-have-this' },
              {
                hashes: [{ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'allowed' } }],
              },
            ],
            authorisationInfo: { description: 'Strict policy', authorised: true, date: '2026-01-01T00:00:00.000Z' },
          },
        })

        const inventory = createMockInventory([existingScript])

        const result = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2026-04-22T00:00:00.000Z'),
          { name: 'https://cdn.example.com/strict.js', content: 'tampered', hash: { value: 'rogue' } },
          existingScript,
          existingScript.authoriseWith.matcher,
          'AndMatcher failed',
        )

        const diff = await service.diff(inventory, [result])

        // Entry unchanged and the result not reported as applied.
        expect(diff.newInventory.scripts[0]).toBe(existingScript)
        expect(diff.appliedResults).toEqual([])
      })

      it('skips known_header_unauthorised_content when the top-level header authoriser is an AndMatcher', async () => {
        const existingHeader = rawInventoryHeaderInfoToInventoryHeaderInfo({
          identifyWith: { headerNameMatcher: '^content-security-policy$' },
          authoriseWith: {
            andMatcher: [{ contentMatcher: 'default-src' }, { contentMatcher: "object-src 'none'" }],
            authorisationInfo: { description: 'Strict CSP — every directive required', authorised: true, date: '2026-01-01T00:00:00.000Z' },
          },
        })

        const inventory: Inventory = {
          ...createMockInventory([]),
          headers: [existingHeader],
        }

        const target = createMockTarget()
        const result = new KnownHeaderWithUnauthorisedContentFound(
          target,
          new Date('2026-04-22T00:00:00.000Z'),
          { name: 'content-security-policy', value: "default-src 'self'", target, workflow: target.workflow },
          existingHeader,
          existingHeader.authoriseWith.matcher,
          'AndMatcher failed',
        )

        const diff = await service.diff(inventory, [result])

        expect(diff.newInventory.headers[0]).toBe(existingHeader)
        expect(diff.appliedResults).toEqual([])
      })

      it('reports duplicate hashes as not-applied even when the gate would normally accept them', async () => {
        // The duplicate guard is defensive (production comparison never returns
        // unauthorised for an already-known hash) but if it does fire, the
        // entry is unchanged and the result must not be reported as applied.
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://cdn\\.example\\.com/payment\\.js$' },
          authoriseWith: {
            hashes: [{ timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'h1' } }],
            authorisationInfo: { description: 'baseline', authorised: true, date: '2026-01-01T00:00:00.000Z' },
          },
        })

        const inventory = createMockInventory([existingScript])
        const result = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2026-04-22T00:00:00.000Z'),
          { name: 'https://cdn.example.com/payment.js', content: 'x', hash: { value: 'h1' } },
          existingScript,
          existingScript.authoriseWith.matcher,
          'defensive duplicate',
        )

        const diff = await service.diff(inventory, [result])
        expect(diff.appliedResults).toEqual([])
      })

      it('does not mutate the old inventory entry when appending a hash to a single HashMatcher (regression: prod 2026-05-18)', async () => {
        // Production scenario that escaped the unit suite: an inventory entry
        // with a single HashMatcher (e.g. b.stripecdn.com vendors~ bundle with
        // 8 authorised hashes) gets a 9th hash detected. The diff appended the
        // hash, but `inventoryScriptInfoToRawInventoryScriptInfo` previously
        // returned the matcher's internal hashes array by reference. The
        // append() therefore mutated the OLD inventory entry's matcher too,
        // leaving `buildInventoryCommitMessage` to see oldCount == newCount
        // == 9 — so push() logged "No inventory changes to push." while the
        // buffered alert still claimed "Inventory updated".
        const existingScript = rawInventoryScriptInfoToInventoryScriptInfo({
          identifyWith: { nameMatcher: '^https://b\\.stripecdn\\.com/.+\\.js$' },
          authoriseWith: {
            hashes: [
              { timestamp: '2026-01-01T00:00:00.000Z', hash: { value: 'h1' } },
              { timestamp: '2026-01-02T00:00:00.000Z', hash: { value: 'h2' } },
            ],
            authorisationInfo: { description: 'Stripe vendors bundle', authorised: true, date: '2026-01-01T00:00:00.000Z' },
          },
        })

        const inventory = createMockInventory([existingScript])
        const result = new KnownScriptWithUnauthorisedContentFound(
          createMockTarget(),
          new Date('2026-05-18T00:00:00.000Z'),
          { name: 'https://b.stripecdn.com/bundle.js', content: 'new', hash: { value: 'h-new' } },
          existingScript,
          existingScript.authoriseWith.matcher,
          'hash h-new not in authorized list',
        )

        const diff = await service.diff(inventory, [result])

        // Old inventory entry must still report 2 hashes when serialised —
        // otherwise the downstream commit-message builder sees a no-op diff.
        const oldRawAfter = inventoryScriptInfoToRawInventoryScriptInfo(diff.oldInventory.scripts[0]!)
        const newRawAfter = inventoryScriptInfoToRawInventoryScriptInfo(diff.newInventory.scripts[0]!)
        expect('hashes' in oldRawAfter.authoriseWith ? oldRawAfter.authoriseWith.hashes.length : -1).toBe(2)
        expect('hashes' in newRawAfter.authoriseWith ? newRawAfter.authoriseWith.hashes.length : -1).toBe(3)

        // The matcher's internal array must also be untouched — otherwise any
        // later toRaw of the old entry would re-show the mutated count.
        const oldMatcher = diff.oldInventory.scripts[0]!.authoriseWith.matcher
        expect((oldMatcher.getPattern() as Array<unknown>).length).toBe(2)

        expect(diff.appliedResults).toEqual([result])
      })

      it('appends a new content matcher to the right entry when identifyWith is an andMatcher of [headerNameMatcher, hostMatcher] (regression: script-inventory#92 shape)', async () => {
        // The 2026-05-19 script-inventory migration replaced single name-only
        // CSP entries with N per-host entries, each using a composite
        // `andMatcher: [headerNameMatcher, hostMatcher]` in `identifyWith`.
        // The diff gate looks at `authoriseWith.matcher` (an OrMatcher from
        // array syntax), not `identifyWith`, so this should work — but no
        // existing test pinned it down. This one does.

        // Two per-host CSP entries with composite identifyWith, mirroring
        // the script-inventory shape. Each only authorises one directive
        // today; the new value below should land in the m.stripe.network
        // bucket, not the meandu one.
        const meanduEntry = rawInventoryHeaderInfoToInventoryHeaderInfo({
          identifyWith: {
            andMatcher: [{ headerNameMatcher: '^content-security-policy$' }, { hostMatcher: '^app-dev\\.meandu\\.com$' }],
          },
          authoriseWith: [
            {
              contentMatcher: '^frame-ancestors https:\\/\\/\\*\\.meandu\\.com$',
              authorisationInfo: { description: 'Me&u (first-party)', authorised: true, date: '2026-05-19T00:00:00.000Z' },
            },
          ],
        })
        const stripeEntry = rawInventoryHeaderInfoToInventoryHeaderInfo({
          identifyWith: {
            andMatcher: [{ headerNameMatcher: '^content-security-policy$' }, { hostMatcher: '^m\\.stripe\\.network$' }],
          },
          authoriseWith: [
            {
              contentMatcher: "^default-src 'self'$",
              authorisationInfo: { description: 'Stripe', authorised: true, date: '2026-05-19T00:00:00.000Z' },
            },
          ],
        })

        const inventory: Inventory = { ...createMockInventory([]), headers: [meanduEntry, stripeEntry] }

        // A new CSP value arrives from m.stripe.network that doesn't match
        // any existing content matcher in the Stripe bucket. The comparison
        // service would have already identified the Stripe entry via
        // andMatcher, so the result references that entry.
        const target = createMockTarget()
        const newValue = "object-src 'none'"
        const result = new KnownHeaderWithUnauthorisedContentFound(
          target,
          new Date('2026-05-19T00:00:00.000Z'),
          { name: 'content-security-policy', value: newValue, target, workflow: target.workflow, url: 'https://m.stripe.network/something.js' },
          stripeEntry,
          stripeEntry.authoriseWith.matcher,
          'no child matched',
        )

        const diff = await service.diff(inventory, [result])

        // 1. The new content matcher landed in the Stripe entry only.
        const updatedStripe = inventoryHeaderInfoToRawInventoryHeaderInfo(diff.newInventory.headers[1]!)
        expect(Array.isArray(updatedStripe.authoriseWith)).toBe(true)
        if (!Array.isArray(updatedStripe.authoriseWith)) return
        expect(updatedStripe.authoriseWith).toHaveLength(2)
        const newPatterns = updatedStripe.authoriseWith.filter((m: any): m is { contentMatcher: string } => 'contentMatcher' in m).map((m) => m.contentMatcher)
        expect(newPatterns).toContain("^object-src 'none'$")

        // 2. The meandu entry is untouched (no result targeted it).
        const updatedMeandu = inventoryHeaderInfoToRawInventoryHeaderInfo(diff.newInventory.headers[0]!)
        expect(Array.isArray(updatedMeandu.authoriseWith)).toBe(true)
        if (!Array.isArray(updatedMeandu.authoriseWith)) return
        expect(updatedMeandu.authoriseWith).toHaveLength(1)

        // 3. The Stripe entry's composite identifyWith is preserved structurally
        //    — the matcher type and child shape are the same after round-trip.
        expect(updatedStripe.identifyWith).toEqual({
          andMatcher: [{ headerNameMatcher: '^content-security-policy$' }, { hostMatcher: '^m\\.stripe\\.network$' }],
        })

        // 4. The result is reported as applied.
        expect(diff.appliedResults).toEqual([result])
      })

      it('marks UnknownScriptFound and UnknownHeaderFound as applied unconditionally', async () => {
        const inventory = createMockInventory([])
        const target = createMockTarget()
        const unknownScript = new UnknownScriptFound(target, new Date('2026-04-22T00:00:00.000Z'), {
          name: 'https://new.example.com/x.js',
          content: 'console.log("hi")',
          hash: { value: 'h-new' },
        })
        const unknownHeader = new UnknownHeaderFound(target, new Date('2026-04-22T00:00:00.000Z'), { name: 'x-custom', value: 'v', target, workflow: target.workflow })

        const diff = await service.diff(inventory, [unknownScript, unknownHeader])
        expect(diff.appliedResults).toEqual(expect.arrayContaining([unknownScript, unknownHeader]))
        expect(diff.appliedResults).toHaveLength(2)
      })
    })
  })
})
