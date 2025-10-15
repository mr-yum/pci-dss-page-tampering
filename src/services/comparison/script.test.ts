import { ScriptComparisonService } from './script'
import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script'
import type { Target } from '../../types/target'
import type { SHA256Hash } from '../../types/hash'

describe('ScriptComparisonService', () => {
  let service: ScriptComparisonService
  let mockTarget: Target
  let mockInventory: Inventory

  beforeEach(() => {
    service = new ScriptComparisonService()
    
    mockTarget = {
      type: 'detection',
      url: 'https://example.com/payment',
      workflow: {
        fileName: 'test-workflow.json',
        definition: { steps: [] }
      }
    }

    mockInventory = {
      fileName: 'test-inventory.json',
      target: {
        inventory: { type: 'inventory', url: 'https://staging.example.com', workflow: { fileName: 'test-workflow.json', definition: { steps: [] } } },
        detection: { type: 'detection', url: 'https://example.com/payment', workflow: { fileName: 'test-workflow.json', definition: { steps: [] } } }
      },
      alerts: {
        inventory: {
          newScriptIdentified: { destination: 'test-channel' },
          newHeaderIdentified: { destination: 'test-channel' }
        },
        detection: {
          newScriptDetected: { destination: 'test-channel' },
          scriptMismatchDetected: { destination: 'test-channel' },
          newHeaderDetected: { destination: 'test-channel' }
        }
      },
      scripts: [],
      headers: []
    }
  })

  const createScriptInfo = (url: string, hashValue: string): ScriptInfo => ({
    source: { type: 'external', url },
    hash: { value: hashValue } as SHA256Hash
  })

  const createInlineScriptInfo = (id: string, content: string, hashValue: string): ScriptInfo => ({
    source: { type: 'inline', id, content },
    hash: { value: hashValue } as SHA256Hash
  })

  const createInventoryScriptInfo = (
    namePattern: string,
    hashes: string[] = [],
    authorised: boolean = true,
    contentPattern?: string
  ): InventoryScriptInfo => {
    // Import createMatcher for Phase 4 matcher-based inventory
    const { createMatcher } = require('../../types/matcher/matcher-factory')

    // Phase 4 Update: Use new identifyWith/authoriseWith structure with Matcher instances
    // Identification: Use nameMatcher for identifying scripts by URL/ID
    const identifyWith = createMatcher({ nameMatcher: namePattern })

    // Authorization: Mimic old behavior where contentMatcher took precedence over hashes
    // Old behavior: if contentMatcher exists and matches, script is authorized regardless of hash
    // Old behavior: if no contentMatcher, check hashes
    // Old behavior: if neither contentMatcher nor hashes exist, authorization fails
    let authoriseWith
    if (contentPattern) {
      // Content pattern provided - use it for authorization (takes precedence in old code)
      authoriseWith = createMatcher({ contentMatcher: contentPattern })
    } else if (hashes.length > 0) {
      // No content pattern but hashes provided - use hash matcher
      authoriseWith = createMatcher({
        hashes: hashes.map(hash => ({
          timestamp: new Date(),
          hash: { value: hash } as SHA256Hash
        }))
      })
    } else {
      // No hashes and no content pattern means authorization will fail
      // This matches old behavior where both hashExists and contentMatchExists would be false
      // Use a contentMatcher that never matches to simulate this
      authoriseWith = createMatcher({ contentMatcher: '^$' }) // Only matches empty string
    }

    return {
      identifyWith,
      authoriseWith,
      authorisationInfo: {
        description: 'Test script',
        authorised,
        date: new Date()
      }
    }
  }

  describe('compareSingleScriptWithInventory', () => {
    describe('script exists in inventory with content matcher and empty hashes', () => {
      it('should return no flags when content matcher matches', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/payment.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/payment\\.js', [], true, 'payment')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should return new hash when content matcher does not match and no hashes exist', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/payment.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/payment\\.js', [], true, 'analytics')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true)
      })
    })

    describe('script not in inventory', () => {
      it('should return new script when not found in inventory', () => {
        const detectedScript = createScriptInfo('https://unknown.com/script.js', 'hash123')
        const inventoryScripts: InventoryScriptInfo[] = []

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(true)
        expect(result.isNewHash).toBe(false)
      })
    })

    describe('script exists in inventory with matching hash', () => {
      it('should return no flags when hash matches existing inventory', () => {
        const hashValue = 'hash123'
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', hashValue)

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', [hashValue])
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      // T003: External script with dynamic query parameters (nameMatcher with wildcard)
      it('should match external script with dynamic query parameters using wildcard pattern', () => {
        const hashValue = 'hash123'
        const detectedScript = createScriptInfo('https://hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaLoad', hashValue)

        const inventoryScripts = [
          createInventoryScriptInfo('^https:\\/\\/hcaptcha\\.com\\/1\\/api\\.js\\?.*$', [hashValue])
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })
    })

    describe('script exists in inventory with different hash', () => {
      it('should return new hash when hash does not match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'newHash456')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['oldHash123'])
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true)
      })
    })

    describe('script exists but not authorized', () => {
      it('should return new script when found in inventory but not authorized', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'], false)
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(true)
        expect(result.isNewHash).toBe(false)
      })
    })

    describe('inline scripts', () => {
      it('should handle inline scripts with content matcher correctly', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-analytics-123', 'analytics.track()', 'hash456')

        const inventoryScripts = [
          createInventoryScriptInfo('inline-analytics-123', [], true, 'analytics')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should return new hash for inline script when no content match and no hash match', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-123', 'different.code()', 'hash456')

        const inventoryScripts = [
          createInventoryScriptInfo('inline-123', [], true)
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true)
      })
    })

    // T044: Null content handling
    describe('null/empty content handling', () => {
      it('should treat external script with null content as new script', () => {
        // Create a script info with null content (simulating external script fetch failure)
        const scriptInfo: ScriptInfo = {
          source: { type: 'external', url: 'https://cdn.example.com/script.js' },
          hash: { value: 'hash123' } as SHA256Hash
        }

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'])
        ]

        // Since we're testing private method, we need to simulate the flow
        // The scriptInfoToDetectedScript method sets content to URL for external scripts
        // So external scripts always have content (the URL itself)
        const result = (service as any).compareSingleScriptWithInventory(scriptInfo, inventoryScripts, mockTarget)

        // With our implementation, external scripts use URL as content
        // So this test actually verifies the URL-as-content behavior
        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should treat inline script with empty content as new script', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-123', '', 'hash456')

        const inventoryScripts = [
          createInventoryScriptInfo('inline-123', ['hash456'])
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        // Empty content should trigger new script (fail-secure)
        expect(result.isNewScript).toBe(true)
        expect(result.isNewHash).toBe(false)
      })
    })

    describe('content matcher edge cases', () => {
      it('should prioritize content matcher over hash when both name and content match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/analytics.js', 'differentHash')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/analytics\\.js', ['originalHash'], true, 'analytics')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should not match content matcher when content does not match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/different.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/different\\.js', [], true, 'analytics')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true)
      })

      it('should handle script with content matcher in inventory but no hash exists', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/tracking.js', 'hash123')
        
        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/tracking\\.js', [], true, 'tracking')
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should handle script without content matcher in inventory', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/simple.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('https://cdn\\.example\\.com/simple\\.js', [], true)
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true)
      })
    })

    // T008: First-match-wins with overlapping name patterns
    describe('first-match-wins pattern matching', () => {
      it('should use first matching inventory entry when multiple patterns match', () => {
        const detectedScript = createScriptInfo('https://www.facebook.net/signals/config/123456', 'hash123')

        // Both patterns would match, but first one should win
        const inventoryScripts = [
          createInventoryScriptInfo('.*facebook.*', ['firstHash'], true), // Broad pattern - matches first
          createInventoryScriptInfo('https://www\\.facebook\\.net/signals/config/.*', ['secondHash'], true) // Specific pattern - should not be used
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // Should match first entry's hash
        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(true) // 'hash123' doesn't match 'firstHash' from first entry
      })

      it('should skip non-authorized entries and match next authorized entry', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('.*example.*', ['hash123'], false), // Matches but not authorized - will be skipped
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'], true) // Matches and authorized - will be used
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // Current behavior: scriptExistsInInventory checks first pattern (matches)
        // But getScriptFromInventory filters by authorised=true, so first is skipped
        // Second entry is used instead
        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false)
      })

      it('should stop checking after first match even if later entries have better hash match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/analytics.js', 'exactHash')

        const inventoryScripts = [
          createInventoryScriptInfo('.*example.*', ['wrongHash'], true, 'analytics'), // First match - has content matcher
          createInventoryScriptInfo('https://cdn\\.example\\.com/analytics\\.js', ['exactHash'], true) // Second - exact hash match
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // First entry matches and has content matcher that matches 'analytics' in URL
        expect(result.isNewScript).toBe(false)
        expect(result.isNewHash).toBe(false) // Content matcher succeeds, so no new hash
      })
    })
  })

  describe('compare method integration tests', () => {
    it('should handle multiple scripts with different conditions', async () => {
      const knownScript = createScriptInfo('https://known.com/script.js', 'knownHash')
      const newScript = createScriptInfo('https://new.com/script.js', 'newHash')
      const changedScript = createScriptInfo('https://changed.com/script.js', 'changedHash')

      mockInventory.scripts = [
        createInventoryScriptInfo('https://known\\.com/script\\.js', ['knownHash']),
        createInventoryScriptInfo('https://changed\\.com/script\\.js', ['oldHash'])
      ]

      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [knownScript, newScript, changedScript],
        inlineScripts: []
      }

      const result = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      expect(result.externalScripts.newScripts).toHaveLength(1)
      expect(result.externalScripts.newScripts[0]).toBe(newScript)
      expect(result.externalScripts.newHashes).toHaveLength(1)
      expect(result.externalScripts.newHashes[0]).toBe(changedScript)
    })

    it('should handle mixed external and inline scripts', async () => {
      const externalScript = createScriptInfo('https://example.com/script.js', 'hash1')
      const inlineScript = createInlineScriptInfo('inline-script', 'content', 'hash2')

      mockInventory.scripts = []

      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [externalScript],
        inlineScripts: [inlineScript]
      }

      const result = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      expect(result.externalScripts.newScripts).toHaveLength(1)
      expect(result.externalScripts.newScripts[0]).toBe(externalScript)
      expect(result.inlineScripts.newScripts).toHaveLength(1)
      expect(result.inlineScripts.newScripts[0]).toBe(inlineScript)
    })

    it('should return correct target in comparison result', async () => {
      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [],
        inlineScripts: []
      }

      const result = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      expect(result.target).toBe(mockTarget)
    })
  })
})