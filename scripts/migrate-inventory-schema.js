#!/usr/bin/env node

/**
 * Migration Script: Embed Authorization Info in Authorization Entity
 *
 * Purpose: Migrate inventory JSON files from old schema to new nested schema
 *
 * Old Schema (authorisationInfo as sibling):
 * {
 *   "identifyWith": { ... },
 *   "authoriseWith": { "hashes": [...] },
 *   "authorisationInfo": { ... }
 * }
 *
 * New Schema (authorisationInfo nested in authoriseWith):
 * {
 *   "identifyWith": { ... },
 *   "authoriseWith": {
 *     "hashes": [...],
 *     "authorisationInfo": { ... }
 *   }
 * }
 *
 * Usage:
 *   node scripts/migrate-inventory-schema.js <inventory-file.json>
 *   node scripts/migrate-inventory-schema.js <inventory-directory>
 */

const fs = require('fs').promises
const path = require('path')

/**
 * Migrate a single script/header entry from old to new schema
 * @param {Object} entry - Old format entry
 * @returns {Object} - New format entry
 */
function migrateEntry(entry) {
  // Validate entry has required fields
  if (!entry.identifyWith) {
    throw new Error('Entry missing identifyWith field')
  }
  if (!entry.authoriseWith) {
    throw new Error('Entry missing authoriseWith field')
  }
  if (!entry.authorisationInfo) {
    throw new Error('Entry missing authorisationInfo field')
  }

  // Create new nested structure
  return {
    identifyWith: entry.identifyWith,
    authoriseWith: {
      ...entry.authoriseWith, // Spread matcher config (nameMatcher/contentMatcher/hashes/headerNameMatcher)
      authorisationInfo: entry.authorisationInfo, // Nest authorisationInfo
    },
  }
}

/**
 * Migrate an inventory object (scripts and headers arrays)
 * @param {Object} inventory - Old format inventory
 * @returns {Object} - New format inventory
 */
function migrateInventory(inventory) {
  const migrated = { ...inventory }

  // Migrate scripts array
  if (Array.isArray(inventory.scripts)) {
    migrated.scripts = inventory.scripts.map((script, index) => {
      try {
        return migrateEntry(script)
      } catch (error) {
        throw new Error(`Failed to migrate script at index ${index}: ${error.message}`)
      }
    })
  }

  // Migrate headers array (stored as object with header names as keys)
  if (typeof inventory.headers === 'object' && inventory.headers !== null && !Array.isArray(inventory.headers)) {
    migrated.headers = {}
    for (const [headerName, headerEntry] of Object.entries(inventory.headers)) {
      try {
        migrated.headers[headerName] = migrateEntry(headerEntry)
      } catch (error) {
        throw new Error(`Failed to migrate header "${headerName}": ${error.message}`)
      }
    }
  }

  return migrated
}

/**
 * Check if entry is already in new format
 * @param {Object} entry - Entry to check
 * @returns {boolean} - True if already migrated
 */
function isAlreadyMigrated(entry) {
  if (!entry.authoriseWith) return false
  // If authoriseWith has authorisationInfo, it's new format
  if (entry.authoriseWith.authorisationInfo) return true
  // If entry has authorisationInfo as sibling, it's old format
  if (entry.authorisationInfo) return false
  // Otherwise, ambiguous or malformed
  return false
}

/**
 * Check if inventory is already in new format
 * @param {Object} inventory - Inventory to check
 * @returns {boolean} - True if already migrated
 */
function isInventoryMigrated(inventory) {
  // Check scripts
  if (Array.isArray(inventory.scripts) && inventory.scripts.length > 0) {
    return isAlreadyMigrated(inventory.scripts[0])
  }

  // Check headers
  if (typeof inventory.headers === 'object' && inventory.headers !== null) {
    const headerEntries = Object.values(inventory.headers)
    if (headerEntries.length > 0) {
      return isAlreadyMigrated(headerEntries[0])
    }
  }

  // Empty inventory - assume not migrated
  return false
}

/**
 * Migrate a single inventory JSON file
 * @param {string} filePath - Path to inventory JSON file
 * @param {boolean} dryRun - If true, only validate without writing
 */
async function migrateFile(filePath, dryRun = false) {
  console.log(`\nProcessing: ${filePath}`)

  try {
    // Read file
    const content = await fs.readFile(filePath, 'utf-8')
    const inventory = JSON.parse(content)

    // Check if already migrated
    if (isInventoryMigrated(inventory)) {
      console.log('  ✓ Already in new format (skipping)')
      return { status: 'skipped', file: filePath }
    }

    // Migrate
    const migrated = migrateInventory(inventory)

    // Validate migrated structure
    validateMigratedInventory(migrated)

    if (dryRun) {
      console.log('  ✓ Migration valid (dry run - not writing)')
      return { status: 'dry-run', file: filePath }
    }

    // Write back to file with pretty formatting
    await fs.writeFile(filePath, JSON.stringify(migrated, null, 2) + '\n', 'utf-8')
    console.log('  ✓ Migrated successfully')
    return { status: 'migrated', file: filePath }
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`)
    return { status: 'error', file: filePath, error: error.message }
  }
}

/**
 * Validate migrated inventory structure
 * @param {Object} inventory - Migrated inventory
 * @throws {Error} - If validation fails
 */
function validateMigratedInventory(inventory) {
  // Validate scripts
  if (Array.isArray(inventory.scripts)) {
    inventory.scripts.forEach((script, index) => {
      validateMigratedEntry(script, `script[${index}]`)
    })
  }

  // Validate headers
  if (typeof inventory.headers === 'object' && inventory.headers !== null) {
    for (const [headerName, headerEntry] of Object.entries(inventory.headers)) {
      validateMigratedEntry(headerEntry, `header["${headerName}"]`)
    }
  }
}

/**
 * Validate a single migrated entry
 * @param {Object} entry - Migrated entry
 * @param {string} context - Context for error messages
 * @throws {Error} - If validation fails
 */
function validateMigratedEntry(entry, context) {
  if (!entry.identifyWith) {
    throw new Error(`${context}: Missing identifyWith`)
  }
  if (!entry.authoriseWith) {
    throw new Error(`${context}: Missing authoriseWith`)
  }
  if (!entry.authoriseWith.authorisationInfo) {
    throw new Error(`${context}: Missing authoriseWith.authorisationInfo`)
  }

  const authInfo = entry.authoriseWith.authorisationInfo
  if (typeof authInfo.description !== 'string' || authInfo.description.length === 0) {
    throw new Error(`${context}: Invalid authorisationInfo.description`)
  }
  if (typeof authInfo.authorised !== 'boolean') {
    throw new Error(`${context}: Invalid authorisationInfo.authorised`)
  }
  if (typeof authInfo.date !== 'string') {
    throw new Error(`${context}: Invalid authorisationInfo.date`)
  }

  // Validate at least one matcher type exists in authoriseWith
  const hasNameMatcher = 'nameMatcher' in entry.authoriseWith
  const hasContentMatcher = 'contentMatcher' in entry.authoriseWith
  const hasHashes = 'hashes' in entry.authoriseWith
  const hasHeaderNameMatcher = 'headerNameMatcher' in entry.authoriseWith

  if (!hasNameMatcher && !hasContentMatcher && !hasHashes && !hasHeaderNameMatcher) {
    throw new Error(`${context}: No matcher found in authoriseWith`)
  }
}

/**
 * Find all JSON files in a directory recursively
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} - Array of file paths
 */
async function findJsonFiles(dir) {
  const files = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findJsonFiles(fullPath)
        files.push(...subFiles)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath)
      }
    }
  } catch (error) {
    throw new Error(`Failed to read directory ${dir}: ${error.message}`)
  }

  return files
}

/**
 * Main migration function
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error('Usage: node migrate-inventory-schema.js <file-or-directory> [--dry-run]')
    console.error('\nExamples:')
    console.error('  node migrate-inventory-schema.js inventory.json')
    console.error('  node migrate-inventory-schema.js ./inventories/')
    console.error('  node migrate-inventory-schema.js ./inventories/ --dry-run')
    process.exit(1)
  }

  const target = args[0]
  const dryRun = args.includes('--dry-run')

  if (dryRun) {
    console.log('Running in DRY RUN mode (no files will be modified)\n')
  }

  try {
    // Check if target exists
    const stat = await fs.stat(target)

    let filesToMigrate = []

    if (stat.isFile()) {
      if (!target.endsWith('.json')) {
        console.error('Error: File must be a JSON file')
        process.exit(1)
      }
      filesToMigrate = [target]
    } else if (stat.isDirectory()) {
      console.log(`Searching for JSON files in: ${target}\n`)
      filesToMigrate = await findJsonFiles(target)
      console.log(`Found ${filesToMigrate.length} JSON file(s)\n`)
    } else {
      console.error('Error: Target must be a file or directory')
      process.exit(1)
    }

    if (filesToMigrate.length === 0) {
      console.log('No JSON files found to migrate')
      process.exit(0)
    }

    // Migrate all files
    const results = []
    for (const file of filesToMigrate) {
      const result = await migrateFile(file, dryRun)
      results.push(result)
    }

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('MIGRATION SUMMARY')
    console.log('='.repeat(60))

    const migrated = results.filter((r) => r.status === 'migrated').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    const dryRunCount = results.filter((r) => r.status === 'dry-run').length
    const errors = results.filter((r) => r.status === 'error')

    console.log(`Total files processed: ${results.length}`)
    console.log(`Migrated: ${migrated}`)
    console.log(`Skipped (already migrated): ${skipped}`)
    if (dryRun) {
      console.log(`Validated (dry run): ${dryRunCount}`)
    }
    console.log(`Errors: ${errors.length}`)

    if (errors.length > 0) {
      console.log('\nERRORS:')
      errors.forEach((err) => {
        console.log(`  - ${err.file}: ${err.error}`)
      })
      process.exit(1)
    }

    console.log('\n✓ Migration completed successfully')
  } catch (error) {
    console.error(`\nFatal error: ${error.message}`)
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
}

// Export for testing
module.exports = {
  migrateEntry,
  migrateInventory,
  isAlreadyMigrated,
  isInventoryMigrated,
  validateMigratedEntry,
  validateMigratedInventory,
}
