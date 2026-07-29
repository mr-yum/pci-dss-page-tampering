import type { SHA256Hash } from '../../types/hash.js'
import type { Inventory, InventoryScriptInfo } from '../../types/inventory/model.js'
import { createMatcher } from '../../types/matcher/matcher-factory.js'
import type { ScriptDetectionSummary, ScriptInfo } from '../../types/script.js'
import type { Target } from '../../types/target.js'
import { createLogger } from '../../utils/logger.js'
import { ScriptComparisonService } from './script.js'

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
        definition: { steps: [] },
      },
      logger: createLogger('test'),
    }

    mockInventory = {
      fileName: 'test-inventory.json',
      target: {
        inventory: {
          type: 'inventory',
          url: 'https://staging.example.com',
          workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
          logger: createLogger('test-inventory'),
        },
        detection: {
          type: 'detection',
          url: 'https://example.com/payment',
          workflow: { fileName: 'test-workflow.json', definition: { steps: [] } },
          logger: createLogger('test-detection'),
        },
      },
      alerts: {
        inventory: {
          newScriptIdentified: { destination: 'test-channel' },
          newHeaderIdentified: { destination: 'test-channel' },
        },
        detection: {
          newScriptDetected: { destination: 'test-channel' },
          scriptMismatchDetected: { destination: 'test-channel' },
          newHeaderDetected: { destination: 'test-channel' },
        },
        successNotification: { destination: 'test-channel' },
      },
      scripts: [],
      headers: [],
    }
  })

  const createScriptInfo = (url: string, hashValue: string, content: string = 'console.log("external script body")'): ScriptInfo => ({
    source: { type: 'external', url, content },
    hash: { value: hashValue } as SHA256Hash,
  })

  const createInlineScriptInfo = (id: string, content: string, hashValue: string): ScriptInfo => ({
    source: { type: 'inline', id, content },
    hash: { value: hashValue } as SHA256Hash,
  })

  const createInventoryScriptInfo = (namePattern: string, hashes: string[] = [], authorised: boolean = true, contentPattern?: string): InventoryScriptInfo => {
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
        hashes: hashes.map((hash) => ({
          timestamp: new Date(),
          hash: { value: hash } as SHA256Hash,
        })),
      })
    } else {
      // No hashes and no content pattern means authorization will fail
      // This matches old behavior where both hashExists and contentMatchExists would be false
      // Use a contentMatcher that never matches to simulate this
      authoriseWith = createMatcher({ contentMatcher: '^$' }) // Only matches empty string
    }

    return {
      identifyWith,
      authoriseWith: {
        matcher: authoriseWith,
        authorisationInfo: {
          description: 'Test script',
          authorised,
          date: new Date(),
        },
      },
    }
  }

  describe('compareSingleScriptWithInventory', () => {
    it('supports exact-version identification with a hash matcher', () => {
      const hash = { timestamp: new Date(), hash: { value: 'hash123' } as SHA256Hash }
      const inventoryEntry: InventoryScriptInfo = {
        identifyWith: createMatcher({ hashes: [hash] }),
        authoriseWith: {
          matcher: createMatcher({ hashes: [hash] }),
          authorisationInfo: { description: 'Exact approved version', authorised: true, date: new Date() },
        },
      }

      const matchingResult = (service as any).compareSingleScriptWithInventory(createScriptInfo('https://cdn.example.com/payment.js', 'hash123'), [inventoryEntry], mockTarget)
      const changedResult = (service as any).compareSingleScriptWithInventory(createScriptInfo('https://cdn.example.com/payment.js', 'changed'), [inventoryEntry], mockTarget)

      expect(matchingResult.type).toBe('authorized_script')
      expect(changedResult.type).toBe('unknown_script_found')
    })

    it('uses the target workflow id when identifying scripts', () => {
      const detectedScript = createScriptInfo('https://cdn.example.com/payment.js', 'hash123')
      const workflowEntry: InventoryScriptInfo = {
        identifyWith: createMatcher({ andMatcher: [{ workflowMatcher: '^workflow-a$' }, { nameMatcher: 'payment\\.js$' }] }),
        authoriseWith: {
          matcher: createMatcher({ hashes: [{ timestamp: new Date(), hash: { value: 'hash123' } as SHA256Hash }] }),
          authorisationInfo: { description: 'Workflow A payment script', authorised: true, date: new Date() },
        },
      }

      const workflowAResult = (service as any).compareSingleScriptWithInventory(detectedScript, [workflowEntry], { ...mockTarget, workflowId: 'workflow-a' })
      const workflowBResult = (service as any).compareSingleScriptWithInventory(detectedScript, [workflowEntry], { ...mockTarget, workflowId: 'workflow-b' })

      expect(workflowAResult.type).toBe('authorized_script')
      expect(workflowBResult.type).toBe('unknown_script_found')
    })

    describe('script exists in inventory with content matcher and empty hashes', () => {
      it('should return AuthorizedScriptFound when content matcher matches', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/payment.js', 'hash123', 'initPayment({ amount: total })')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/payment\\.js', [], true, 'initPayment')]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      it('should return KnownScriptWithUnauthorisedContentFound when content matcher does not match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/payment.js', 'hash123')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/payment\\.js', [], true, 'analytics')]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })
    })

    describe('script not in inventory', () => {
      it('should return UnknownScriptFound when not found in inventory', () => {
        const detectedScript = createScriptInfo('https://unknown.com/script.js', 'hash123')
        const inventoryScripts: InventoryScriptInfo[] = []

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('unknown_script_found')
      })
    })

    describe('script exists in inventory with matching hash', () => {
      it('should return AuthorizedScriptFound when hash matches', () => {
        const hashValue = 'hash123'
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', hashValue)

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', [hashValue])]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      // T003: External script with dynamic query parameters (nameMatcher with wildcard)
      it('should match external script with dynamic query parameters using wildcard pattern', () => {
        const hashValue = 'hash123'
        const detectedScript = createScriptInfo('https://hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaLoad', hashValue)

        const inventoryScripts = [createInventoryScriptInfo('^https:\\/\\/hcaptcha\\.com\\/1\\/api\\.js\\?.*$', [hashValue])]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })
    })

    describe('script exists in inventory with different hash', () => {
      it('should return KnownScriptWithUnauthorisedContentFound when hash does not match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'newHash456')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['oldHash123'])]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })
    })

    describe('script exists but not authorized', () => {
      it('should return UnknownScriptFound when found in inventory but not authorized', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'hash123')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'], false)]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('unknown_script_found')
      })
    })

    describe('inline scripts', () => {
      it('should handle inline scripts with content matcher correctly', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-analytics-123', 'analytics.track()', 'hash456')

        const inventoryScripts = [createInventoryScriptInfo('inline-analytics-123', [], true, 'analytics')]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      it('should return KnownScriptWithUnauthorisedContentFound for inline script when authorization fails', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-123', 'different.code()', 'hash456')

        const inventoryScripts = [createInventoryScriptInfo('inline-123', [], true)]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })
    })

    // T044: Null content handling
    describe('null/empty content handling', () => {
      it('should pass the fetched body as content for external scripts (not the URL)', () => {
        const scriptInfo: ScriptInfo = {
          source: { type: 'external', url: 'https://cdn.example.com/script.js', content: 'window.checkout = () => {}' },
          hash: { value: 'hash123' } as SHA256Hash,
        }

        // Content matcher targets the script body; the URL must NOT satisfy it
        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', [], true, 'window\\.checkout')]

        const result = (service as any).compareSingleScriptWithInventory(scriptInfo, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      it('should NOT authorize an external script whose URL matches a content pattern its body does not', () => {
        const scriptInfo: ScriptInfo = {
          source: { type: 'external', url: 'https://cdn.example.com/window.checkout/script.js', content: 'stealCardData()' },
          hash: { value: 'hash123' } as SHA256Hash,
        }

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/.*', [], true, 'window\\.checkout')]

        const result = (service as any).compareSingleScriptWithInventory(scriptInfo, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })

      it('should treat external script with empty content as UnknownScriptFound (fail-secure)', () => {
        const scriptInfo = createScriptInfo('https://cdn.example.com/script.js', 'hash123', '')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'])]

        const result = (service as any).compareSingleScriptWithInventory(scriptInfo, inventoryScripts, mockTarget)

        expect(result.type).toBe('unknown_script_found')
      })

      it('should treat inline script with empty content as UnknownScriptFound (fail-secure)', () => {
        const detectedInlineScript = createInlineScriptInfo('inline-123', '', 'hash456')

        const inventoryScripts = [createInventoryScriptInfo('inline-123', ['hash456'])]

        const result = (service as any).compareSingleScriptWithInventory(detectedInlineScript, inventoryScripts, mockTarget)

        // Empty content should trigger UnknownScriptFound (fail-secure)
        expect(result.type).toBe('unknown_script_found')
      })
    })

    describe('content matcher edge cases', () => {
      it('should prioritize content matcher over hash when both match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/analytics.js', 'differentHash', 'analytics.track("pageview")')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/analytics\\.js', ['originalHash'], true, 'analytics')]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      it('should return KnownScriptWithUnauthorisedContentFound when content does not match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/different.js', 'hash123')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/different\\.js', [], true, 'analytics')]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })

      it('should return AuthorizedScriptFound when content matcher matches', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/tracking.js', 'hash123', 'tracking.start()')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/tracking\\.js', [], true, 'tracking')]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('authorized_script')
      })

      it('should return KnownScriptWithUnauthorisedContentFound without content matcher', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/simple.js', 'hash123')

        const inventoryScripts = [createInventoryScriptInfo('https://cdn\\.example\\.com/simple\\.js', [], true)]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        expect(result.type).toBe('known_script_unauthorised_content')
      })
    })

    // T008: First-match-wins with overlapping name patterns
    describe('first-match-wins pattern matching', () => {
      it('should use first matching inventory entry when multiple patterns match', () => {
        const detectedScript = createScriptInfo('https://www.facebook.net/signals/config/123456', 'hash123')

        // Both patterns would match, but first one should win
        const inventoryScripts = [
          createInventoryScriptInfo('.*facebook.*', ['firstHash'], true), // Broad pattern - matches first
          createInventoryScriptInfo('https://www\\.facebook\\.net/signals/config/.*', ['secondHash'], true), // Specific pattern - should not be used
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // Should match first entry but hash doesn't match
        expect(result.type).toBe('known_script_unauthorised_content')
      })

      it('should skip non-authorized entries and match next authorized entry', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/script.js', 'hash123')

        const inventoryScripts = [
          createInventoryScriptInfo('.*example.*', ['hash123'], false), // Matches but not authorized - will be skipped
          createInventoryScriptInfo('https://cdn\\.example\\.com/script\\.js', ['hash123'], true), // Matches and authorized - will be used
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // Second entry is used since first is not authorized
        expect(result.type).toBe('authorized_script')
      })

      it('should stop checking after first match even if later entries have better hash match', () => {
        const detectedScript = createScriptInfo('https://cdn.example.com/analytics.js', 'exactHash', 'analytics.track("pageview")')

        const inventoryScripts = [
          createInventoryScriptInfo('.*example.*', ['wrongHash'], true, 'analytics'), // First match - has content matcher
          createInventoryScriptInfo('https://cdn\\.example\\.com/analytics\\.js', ['exactHash'], true), // Second - exact hash match
        ]

        const result = (service as any).compareSingleScriptWithInventory(detectedScript, inventoryScripts, mockTarget)

        // First entry matches and has content matcher that matches 'analytics' in the script body
        expect(result.type).toBe('authorized_script')
      })
    })
  })

  describe('compare method integration tests', () => {
    it('should return typed results for multiple scripts with different conditions', async () => {
      const knownScript = createScriptInfo('https://known.com/script.js', 'knownHash')
      const newScript = createScriptInfo('https://new.com/script.js', 'newHash')
      const changedScript = createScriptInfo('https://changed.com/script.js', 'changedHash')

      mockInventory.scripts = [createInventoryScriptInfo('https://known\\.com/script\\.js', ['knownHash']), createInventoryScriptInfo('https://changed\\.com/script\\.js', ['oldHash'])]

      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [knownScript, newScript, changedScript],
        inlineScripts: [],
      }

      const results = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      // Should return array of 3 typed results
      expect(results).toHaveLength(3)

      // Known script should be authorized
      const knownResult = results.find((r) => 'script' in r && r.script.name === 'https://known.com/script.js')
      expect(knownResult?.type).toBe('authorized_script')

      // New script should be unknown
      const newResult = results.find((r) => 'script' in r && r.script.name === 'https://new.com/script.js')
      expect(newResult?.type).toBe('unknown_script_found')

      // Changed script should be known but unauthorized
      const changedResult = results.find((r) => 'script' in r && r.script.name === 'https://changed.com/script.js')
      expect(changedResult?.type).toBe('known_script_unauthorised_content')
    })

    it('should handle mixed external and inline scripts', async () => {
      const externalScript = createScriptInfo('https://example.com/script.js', 'hash1')
      const inlineScript = createInlineScriptInfo('inline-script', 'content', 'hash2')

      mockInventory.scripts = []

      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [externalScript],
        inlineScripts: [inlineScript],
      }

      const results = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      // Should have 2 results, both unknown
      expect(results).toHaveLength(2)
      expect(results.every((r) => r.type === 'unknown_script_found')).toBe(true)

      // Verify both scripts are present
      const externalResult = results.find((r) => 'script' in r && r.script.name === 'https://example.com/script.js')
      expect(externalResult).toBeDefined()

      const inlineResult = results.find((r) => 'script' in r && r.script.name === 'inline-script')
      expect(inlineResult).toBeDefined()
    })

    it('should include target in all comparison results', async () => {
      const scriptDetectionSummary: ScriptDetectionSummary = {
        externalScripts: [createScriptInfo('https://test.com/script.js', 'hash1')],
        inlineScripts: [],
      }

      const results = await service.compare(mockTarget, mockInventory, scriptDetectionSummary)

      expect(results).toHaveLength(1)
      expect(results[0]!.target).toBe(mockTarget)
    })
  })
})
