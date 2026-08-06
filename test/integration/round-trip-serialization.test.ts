/**
 * Round-Trip Serialization Integration Test
 *
 * Tests the complete serialization/deserialization cycle using complex-example.json
 * to ensure perfect fidelity when loading, processing, and saving inventory files.
 *
 * This test validates:
 * 1. Loading raw JSON from disk
 * 2. Deserializing to typed Inventory model
 * 3. Serializing back to raw JSON format
 * 4. Comparing serialized output with original input
 *
 * @see src/utils/inventory.ts
 * @see src/utils/script.ts
 * @see test/integration/complex-example.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Inventory } from '../../src/types/inventory/model.js'
import type { RawInventory } from '../../src/types/inventory/raw.js'
import { RawInventorySchema } from '../../src/types/inventory/zod.js'
import { inventoryToRawInventory, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../../src/utils/inventory.js'
import { rawInventoryScriptInfoToInventoryScriptInfo } from '../../src/utils/script.js'

describe('Round-Trip Serialization Integration Tests', () => {
  const complexExamplePath = path.join(__dirname, 'complex-example.json')

  /**
   * Helper function to convert RawInventory to typed Inventory.
   * Mimics the conversion logic in ScriptInventoryRepository.
   * Uses mock workflow for testing - we don't need real workflow files for serialization tests.
   */
  async function rawInventoryToInventory(raw: RawInventory, fileName: string): Promise<Inventory> {
    if (raw.target.workflows !== undefined) throw new Error('Legacy round-trip fixture unexpectedly contains multiple workflows')

    // Mock workflow for testing - serialization tests don't need real workflow execution
    const mockWorkflow = {
      fileName: raw.target.inventory.workflow,
      definition: { steps: [] },
    }

    const defaultName = fileName.replace(/\.json$/, '')
    const inventoryName = raw.target.inventory.name ?? defaultName
    const detectionName = raw.target.detection.name ?? defaultName

    return {
      fileName,
      alerts: raw.alerts,
      target: {
        inventory: {
          type: raw.target.inventory.type,
          name: inventoryName,
          url: raw.target.inventory.url,
          workflow: mockWorkflow,
          logger: undefined as any, // Not needed for serialization test
        },
        detection: {
          type: raw.target.detection.type,
          name: detectionName,
          url: raw.target.detection.url,
          workflow: { ...mockWorkflow, fileName: raw.target.detection.workflow },
          logger: undefined as any, // Not needed for serialization test
        },
      },
      scripts: raw.scripts.map(rawInventoryScriptInfoToInventoryScriptInfo),
      headers: (raw.headers || []).map(rawInventoryHeaderInfoToInventoryHeaderInfo),
    }
  }

  describe('complex-example.json round-trip', () => {
    it('should load, deserialize, serialize, and preserve array syntax', async () => {
      // Step 1: Load original JSON from disk
      const originalJson = fs.readFileSync(complexExamplePath, 'utf-8')
      const originalRaw: RawInventory = JSON.parse(originalJson)

      // Step 2: Validate raw inventory with Zod
      const parseResult = RawInventorySchema.safeParse(originalRaw)

      // Verify validation succeeded
      expect(parseResult.success).toBe(true)
      if (!parseResult.success) {
        console.error('Validation errors:', parseResult.error.issues)
        throw new Error('Failed to validate complex-example.json')
      }

      // Step 3: Convert to typed Inventory model
      const inventory: Inventory = await rawInventoryToInventory(parseResult.data, 'complex-example.json')

      // Step 4: Serialize back to raw format
      const serializedRaw = inventoryToRawInventory(inventory)

      // Step 5: Verify array syntax is preserved for top-level OrMatchers
      // The header with CSP should use array syntax, not orMatcher format
      const cspHeader = serializedRaw.headers.find((h) => {
        return 'headerNameMatcher' in h.identifyWith && h.identifyWith.headerNameMatcher === '^content-security-policy$'
      })

      expect(cspHeader).toBeDefined()
      expect(Array.isArray(cspHeader!.authoriseWith)).toBe(true)

      // Each array element should have authorisationInfo
      const authArray = cspHeader!.authoriseWith as any[]
      expect(authArray.length).toBeGreaterThan(0)
      for (const element of authArray) {
        expect(element.authorisationInfo).toBeDefined()
        expect(element.authorisationInfo.description).toBeTruthy()
        expect(typeof element.authorisationInfo.authorised).toBe('boolean')
        expect(element.authorisationInfo.date).toBeTruthy()
      }

      // Verify no orMatcher key exists (array syntax, not composite matcher syntax)
      expect(cspHeader!.authoriseWith).not.toHaveProperty('orMatcher')
    })

    it('should not leak the retained source text into serialized output', async () => {
      // `Inventory.source` carries the raw file text so the auditor report can
      // cite line numbers. It is in-memory provenance, not inventory content —
      // if it ever reached inventoryToRawInventory the pushed JSON would gain a
      // duplicate copy of itself on every inventory run.
      const originalJson = fs.readFileSync(complexExamplePath, 'utf-8')
      const parseResult = RawInventorySchema.safeParse(JSON.parse(originalJson))

      expect(parseResult.success).toBe(true)
      if (!parseResult.success) throw new Error('Failed to validate complex-example.json')

      const inventory: Inventory = await rawInventoryToInventory(parseResult.data, 'complex-example.json')
      const withSource: Inventory = { ...inventory, source: { file: 'targets/complex-example.json', text: originalJson } }

      const serializedRaw = inventoryToRawInventory(withSource)

      expect(serializedRaw).not.toHaveProperty('source')
      expect(Object.keys(serializedRaw).sort()).toEqual(['alerts', 'headers', 'scripts', 'target'])
    })

    it('should validate against Zod schema after round-trip', async () => {
      const originalJson = fs.readFileSync(complexExamplePath, 'utf-8')
      const originalRaw: RawInventory = JSON.parse(originalJson)

      const parseResult = RawInventorySchema.safeParse(originalRaw)
      expect(parseResult.success).toBe(true)
      if (!parseResult.success) return

      const inventory = await rawInventoryToInventory(parseResult.data, 'complex-example.json')
      const serializedRaw = inventoryToRawInventory(inventory)

      // Verify serialized output is valid according to Zod schema
      const parseResult2 = RawInventorySchema.safeParse(serializedRaw)
      expect(parseResult2.success).toBe(true)

      if (!parseResult2.success) {
        console.error('Schema validation errors after round-trip:', parseResult2.error.issues)
      }
    })

    it('should preserve script count and authorization metadata', async () => {
      const originalJson = fs.readFileSync(complexExamplePath, 'utf-8')
      const originalRaw: RawInventory = JSON.parse(originalJson)

      const parseResult = RawInventorySchema.safeParse(originalRaw)
      expect(parseResult.success).toBe(true)
      if (!parseResult.success) return

      const inventory = await rawInventoryToInventory(parseResult.data, 'complex-example.json')
      const serializedRaw = inventoryToRawInventory(inventory)

      // Verify same number of scripts
      expect(serializedRaw.scripts).toHaveLength(originalRaw.scripts.length)

      // Verify all scripts have authorization metadata
      for (const script of serializedRaw.scripts) {
        expect(script.authoriseWith.authorisationInfo).toBeDefined()
        expect(script.authoriseWith.authorisationInfo.description).toBeTruthy()
        expect(typeof script.authoriseWith.authorisationInfo.authorised).toBe('boolean')
        expect(script.authoriseWith.authorisationInfo.date).toBeTruthy()
      }
    })

    it('SECURITY: should preserve individual authorization metadata for each array element', async () => {
      // This test verifies that we don't lose individual authorization metadata
      // which could lead to security breaches (unauthorized content becoming authorized)

      const originalJson = fs.readFileSync(complexExamplePath, 'utf-8')
      const originalRaw: RawInventory = JSON.parse(originalJson)

      // Find the CSP header which has array syntax with different descriptions per child
      const cspHeader = originalRaw.headers.find((h) => {
        return 'headerNameMatcher' in h.identifyWith && h.identifyWith.headerNameMatcher === '^content-security-policy$'
      })

      expect(cspHeader).toBeDefined()
      expect(Array.isArray(cspHeader!.authoriseWith)).toBe(true)

      const originalArray = cspHeader!.authoriseWith as any[]
      const originalDescriptions = originalArray.map((el) => el.authorisationInfo.description)

      // Verify original has multiple unique descriptions (rich metadata)
      const uniqueDescriptions = new Set(originalDescriptions)
      expect(uniqueDescriptions.size).toBeGreaterThan(1) // Should have many unique descriptions

      // Now do round-trip
      const parseResult = RawInventorySchema.safeParse(originalRaw)
      expect(parseResult.success).toBe(true)
      if (!parseResult.success) return

      const inventory = await rawInventoryToInventory(parseResult.data, 'complex-example.json')
      const serializedRaw = inventoryToRawInventory(inventory)

      // Find the CSP header in serialized output
      const serializedCspHeader = serializedRaw.headers.find((h) => {
        return 'headerNameMatcher' in h.identifyWith && h.identifyWith.headerNameMatcher === '^content-security-policy$'
      })

      expect(serializedCspHeader).toBeDefined()
      expect(Array.isArray(serializedCspHeader!.authoriseWith)).toBe(true)

      const serializedArray = serializedCspHeader!.authoriseWith as any[]
      const serializedDescriptions = serializedArray.map((el: any) => el.authorisationInfo.description)

      // CRITICAL: Verify each child's authorization metadata is preserved
      // If this fails, we're losing security context that could allow unauthorized content
      expect(serializedDescriptions).toEqual(originalDescriptions)
    })
  })

  describe('Error handling and edge cases', () => {
    it('should provide helpful error messages for invalid JSON', () => {
      const invalidJson = '{ "target": { invalid json }'
      expect(() => JSON.parse(invalidJson)).toThrow()
    })

    it('should provide validation errors for malformed inventory', () => {
      const malformedInventory = {
        target: {},
        scripts: [],
      }

      const parseResult = RawInventorySchema.safeParse(malformedInventory)
      expect(parseResult.success).toBe(false)

      if (!parseResult.success) {
        expect(parseResult.error.issues.length).toBeGreaterThan(0)
      }
    })
  })
})
