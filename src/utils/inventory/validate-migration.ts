#!/usr/bin/env node
/**
 * Inventory Schema Migration Validation Script
 *
 * Validates inventory JSON files against the new identifyWith/authoriseWith schema.
 * Can be run standalone via CLI or imported as a module.
 *
 * Usage:
 *   npm run validate-inventory <path-to-inventory.json>
 *   node dist/utils/inventory/validate-migration.js <path-to-inventory.json>
 *
 * Exit codes:
 *   0 - Validation successful
 *   1 - Validation failed (schema errors)
 *   2 - File not found or invalid JSON
 *
 * @see ../../../specs/001-refactor-script-identification/quickstart.md for migration guide
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { RawInventorySchema } from '../../types/inventory/zod'

interface ValidationResult {
  success: boolean
  errors?: string[]
  warnings?: string[]
}

/**
 * Validates an inventory object against the new schema.
 *
 * @param inventory - Raw inventory object (parsed JSON)
 * @returns ValidationResult with success flag and any errors/warnings
 */
export function validateInventory(inventory: unknown): ValidationResult {
  try {
    RawInventorySchema.parse(inventory)
    return { success: true }
  } catch (error) {
    if (error && typeof error === 'object' && 'errors' in error) {
      const zodErrors = (error as { errors: Array<{ message: string; path: Array<string | number> }> }).errors
      const formattedErrors = zodErrors.map((err) => {
        const path = err.path.length > 0 ? `at "${err.path.join('.')}"` : 'at root'
        return `  - ${err.message} ${path}`
      })
      return {
        success: false,
        errors: formattedErrors,
      }
    }
    return {
      success: false,
      errors: [`  - Unknown validation error: ${String(error)}`],
    }
  }
}

/**
 * Detects if inventory uses old schema format (pre-refactoring).
 * Old schema has 'matcher' field instead of 'identifyWith'/'authoriseWith'.
 *
 * @param inventory - Raw inventory object
 * @returns Warning message if old schema detected, null otherwise
 */
export function detectOldSchema(inventory: unknown): string | null {
  if (inventory && typeof inventory === 'object' && 'scripts' in inventory && Array.isArray(inventory.scripts) && inventory.scripts.length > 0) {
    const firstScript = inventory.scripts[0]
    if (firstScript && typeof firstScript === 'object') {
      // Check for old schema indicators
      if ('matcher' in firstScript) {
        return '⚠️  Old schema detected: Found "matcher" field. Please migrate to "identifyWith"/"authoriseWith" format.'
      }
      if ('hashes' in firstScript && !('identifyWith' in firstScript)) {
        return '⚠️  Old schema detected: Found top-level "hashes" field without "identifyWith"/"authoriseWith". Please migrate to new format.'
      }
    }
  }
  return null
}

/**
 * Validates an inventory file.
 *
 * @param filePath - Absolute or relative path to inventory JSON file
 * @returns ValidationResult with success flag and any errors/warnings
 */
export function validateInventoryFile(filePath: string): ValidationResult {
  try {
    const absolutePath = resolve(filePath)
    const fileContent = readFileSync(absolutePath, 'utf-8')
    const inventory = JSON.parse(fileContent)

    // Check for old schema before validating
    const oldSchemaWarning = detectOldSchema(inventory)
    if (oldSchemaWarning) {
      return {
        success: false,
        errors: [oldSchemaWarning],
        warnings: ['  Migration guide: specs/001-refactor-script-identification/quickstart.md', '  See examples: specs/001-refactor-script-identification/examples/'],
      }
    }

    return validateInventory(inventory)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        success: false,
        errors: [`  - File not found: ${filePath}`],
      }
    }
    if (error instanceof SyntaxError) {
      return {
        success: false,
        errors: [`  - Invalid JSON: ${error.message}`],
      }
    }
    return {
      success: false,
      errors: [`  - Error reading file: ${String(error)}`],
    }
  }
}

/**
 * CLI entry point when run directly.
 */
function main(): void {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('Usage: npm run validate-inventory <path-to-inventory.json>')
    console.error('   or: node dist/utils/inventory/validate-migration.js <path-to-inventory.json>')
    process.exit(2)
  }

  const inventoryPath = args[0]!
  console.log(`Validating inventory: ${inventoryPath}`)
  console.log('')

  const result = validateInventoryFile(inventoryPath)

  if (result.success) {
    console.log('✅ Inventory is valid!')
    console.log('')
    console.log('The inventory conforms to the new identifyWith/authoriseWith schema.')
    process.exit(0)
  } else {
    console.error('❌ Inventory validation failed:')
    console.error('')
    if (result.errors) {
      result.errors.forEach((err) => console.error(err))
    }
    if (result.warnings) {
      console.error('')
      console.error('Suggestions:')
      result.warnings.forEach((warn) => console.error(warn))
    }
    console.error('')
    process.exit(1)
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main()
}
