/**
 * Inventory Service Unit Tests
 *
 * Tests for ScriptInventoryService, particularly the updateScriptWithNewHash method
 * which handles adding new hashes to scripts with different authoriseWith configurations.
 *
 * @see src/services/inventory.ts - ScriptInventoryService
 */

import { KnownHeaderWithUnauthorisedContentFound } from '../types/comparison/known-header-unauthorised-content-found'
import { KnownScriptWithUnauthorisedContentFound } from '../types/comparison/known-script-unauthorised-content-found'
import type { Inventory, InventoryScriptInfo } from '../types/inventory/model'
import type { HashMatcher } from '../types/matcher/hash-matcher'
import type { OrMatcher } from '../types/matcher/or-matcher'
import type { Target, TargetDetection, TargetInventory } from '../types/target'
import type { Workflow } from '../types/workflow'
import { inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../utils/inventory'
import { createLogger } from '../utils/logger'
import { inventoryScriptInfoToRawInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo } from '../utils/script'
import { ScriptInventoryService } from './inventory'

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
  })
})
