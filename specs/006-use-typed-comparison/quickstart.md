# Quickstart: Use Typed Comparison Results for Inventory Updates

**Feature**: 006-use-typed-comparison
**Date**: 2025-10-24

## Overview

This quickstart guide gets you up to speed on the refactored inventory update system that processes typed `ComparisonResultType[]` directly, eliminating conversions to legacy types.

## 5-Minute Understanding

### What Changed?

**Before (Legacy Flow)**:
```
ComparisonService → ComparisonResultType[]
                ↓
        Convert to ScriptComparisonSummary/HeaderComparisonSummary
                ↓
        InventoryService.diff(inventory, scriptSummary, headerSummary)
                ↓
        Process newScripts → Process newHashes → Process headers
                ↓
        Return InventoryDifferenceResult
```

**After (Refactored Flow)**:
```
ComparisonService → ComparisonResultType[]
                ↓
        InventoryService.diff(inventory, comparisonResults)
                ↓
        Single pass through all results (switch on result.type)
                ↓
        Return InventoryDifferenceResult
```

### Key Benefits

1. **Fewer conversions**: Eliminates 2 unnecessary type conversions
2. **Single pass**: Processes all results in one iteration instead of three
3. **Type safety**: Exhaustive checking ensures all result types are handled
4. **Simpler API**: One array parameter instead of separate summaries
5. **Less code**: Removes legacy ScriptComparisonResult/Summary/HeaderComparisonSummary types

---

## Quick Examples

### Example 1: Basic Usage (After Refactoring)

```typescript
import { ScriptComparisonService } from './services/comparison/script'
import { HeaderComparisonService } from './services/comparison/header'
import { ScriptInventoryService } from './services/inventory'

// Get comparison results from both services
const scriptResults = await scriptComparisonService.compare(target, inventory, scriptSummary)
const headerResults = await headerComparisonService.compare(target, inventory, headerSummary)

// Combine into single array
const allResults: ComparisonResultType[] = [...scriptResults, ...headerResults]

// Process all results in one call
const diff = await inventoryService.diff(inventory, allResults)

// Push changes if any
if (diff.oldInventory !== diff.newInventory) {
  await inventoryService.push([diff])
}
```

---

### Example 2: Understanding Typed Results

Each comparison result is a class with a `type` discriminator:

```typescript
// Unknown script found (needs to be added to inventory)
const result1: UnknownScriptFound = {
  type: 'unknown_script_found',
  target: { url: '...', type: 'inventory', ... },
  timestamp: new Date(),
  script: {
    name: 'https://example.com/script.js',
    content: 'https://example.com/script.js',
    hash: { algorithm: 'sha256', value: 'abc123...' }
  }
}

// Known script with unauthorized content (hash changed)
const result2: KnownScriptWithUnauthorisedContentFound = {
  type: 'known_script_unauthorised_content',
  target: { ... },
  timestamp: new Date(),
  script: { ... },
  inventoryEntry: { identifyWith: ..., authoriseWith: ... },
  authorizationMatcher: hashMatcher,
  failureReason: 'hash abc123... not in authorized list',
  metadataPath: [...]
}

// Authorized script (no action needed)
const result3: AuthorizedScriptFound = {
  type: 'authorized_script',
  target: { ... },
  timestamp: new Date(),
  script: { ... },
  inventoryEntry: { ... },
  metadataPath: [...]
}
```

---

### Example 3: How InventoryService Processes Results

Internal switch statement dispatches to specialized methods:

```typescript
private processComparisonResult(
  result: ComparisonResultType,
  inventory: Inventory,
  updateDate: Date
): Inventory {
  switch (result.type) {
    case 'unknown_script_found':
      // Create new inventory entry
      return this.addNewScript(result, inventory, updateDate)

    case 'known_script_unauthorised_content':
      // Add new hash to existing entry (or convert to array syntax)
      return this.updateScriptWithNewHash(result, inventory, updateDate)

    case 'authorized_script':
      // Already compliant, no change needed
      return inventory

    case 'unknown_header_found':
      // Create new header entry
      return this.addNewHeader(result, inventory, updateDate)

    case 'known_header_unauthorised_content':
      // Add new content matcher to existing entry
      return this.updateHeaderWithNewContent(result, inventory, updateDate)

    case 'authorized_header':
      // Already compliant, no change needed
      return inventory

    default:
      // TypeScript ensures this is unreachable
      const _exhaustive: never = result
      throw new Error(`Unhandled type: ${(_exhaustive as any).type}`)
  }
}
```

---

### Example 4: Adding New Hash to Existing Entry

When a known script's hash changes (e.g., CDN updated the file):

```typescript
// Before: Single hash matcher
{
  identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" },
  authoriseWith: {
    hashes: [
      { timestamp: "2025-01-15T00:00:00.000Z", hash: { value: "abc123..." } }
    ],
    authorisationInfo: {
      description: "Analytics script v1.0",
      authorised: true,
      date: "2025-01-15T00:00:00.000Z"
    }
  }
}

// After: New hash appended (authorisationInfo preserved)
{
  identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" },
  authoriseWith: {
    hashes: [
      { timestamp: "2025-01-15T00:00:00.000Z", hash: { value: "abc123..." } },
      { timestamp: "2025-10-24T12:00:00.000Z", hash: { value: "def456..." } }  // NEW
    ],
    authorisationInfo: {
      description: "Analytics script v1.0",  // UNCHANGED
      authorised: true,
      date: "2025-01-15T00:00:00.000Z"       // UNCHANGED
    }
  }
}
```

**Key Point**: When adding hash to existing hash matcher, `authorisationInfo` is NOT modified (FR-011).

---

### Example 5: Converting Single Matcher to Array

When a non-hash matcher needs to accept a new hash:

```typescript
// Before: Content matcher only
{
  identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" },
  authoriseWith: {
    contentMatcher: "function analytics",
    authorisationInfo: {
      description: "Analytics script v1.0",
      authorised: true,
      date: "2025-01-15T00:00:00.000Z"
    }
  }
}

// After: Array with original + new hash matcher
{
  identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" },
  authoriseWith: [
    {
      contentMatcher: "function analytics",
      authorisationInfo: {
        description: "Analytics script v1.0",        // Original preserved
        authorised: true,
        date: "2025-01-15T00:00:00.000Z"
      }
    },
    {
      hashes: [{ timestamp: "2025-10-24...", hash: { value: "def456..." } }],
      authorisationInfo: {
        description: "Hash detected during inventory run 2025-10-24",  // New context
        authorised: true,
        date: "2025-10-24T12:00:00.000Z"              // Current timestamp
      }
    }
  ]
}
```

**Key Point**: Each matcher in array has its own `authorisationInfo` (FR-011b).

---

### Example 6: Idempotent Processing

Processing duplicate results doesn't create duplicate hashes:

```typescript
const results: ComparisonResultType[] = [
  new KnownScriptWithUnauthorisedContentFound(/* hash: "abc123..." */),
  new KnownScriptWithUnauthorisedContentFound(/* same hash: "abc123..." */)
]

const diff = await inventoryService.diff(inventory, results)

// Result: Hash "abc123..." appears only once in inventory
// Second result is skipped because hash already exists (idempotency check)
```

**Implementation**: `updateScriptWithNewHash()` checks if hash already exists before appending.

---

## Common Patterns

### Pattern 1: Processing Mixed Results

```typescript
// Results can contain both scripts and headers
const results: ComparisonResultType[] = [
  new UnknownScriptFound(...),           // Script
  new UnknownHeaderFound(...),           // Header
  new KnownScriptWithUnauthorisedContentFound(...),  // Script
  new AuthorizedScriptFound(...),        // Script (no action)
  new KnownHeaderWithUnauthorisedContentFound(...),  // Header
]

// Single call processes all types
const diff = await inventoryService.diff(inventory, results)
```

### Pattern 2: Validation Errors

```typescript
// Detection workflow results are rejected
const detectionResults: ComparisonResultType[] = [
  new UnknownScriptFound({ url: '...', type: 'detection' }, ...)  // type: 'detection'!
]

try {
  await inventoryService.diff(inventory, detectionResults)
} catch (error) {
  // Error: "Cannot run diff with results from detection target!"
}
```

### Pattern 3: Exhaustive Handling in Custom Code

```typescript
function logResult(result: ComparisonResultType): void {
  switch (result.type) {
    case 'unknown_script_found':
      console.log(`New script: ${result.script.name}`)
      break

    case 'known_script_unauthorised_content':
      console.log(`Hash mismatch: ${result.script.name} - ${result.failureReason}`)
      break

    case 'authorized_script':
      console.log(`OK: ${result.script.name}`)
      break

    case 'unknown_header_found':
      console.log(`New header: ${result.header.name}`)
      break

    case 'known_header_unauthorised_content':
      console.log(`Header changed: ${result.header.name} - ${result.failureReason}`)
      break

    case 'authorized_header':
      console.log(`OK: ${result.header.name}`)
      break

    default:
      // TypeScript error if any case is missing
      const _exhaustive: never = result
      throw new Error(`Unhandled type: ${(_exhaustive as any).type}`)
  }
}
```

---

## Testing

### Unit Tests

Test the new generic update handler methods:

```typescript
describe('ScriptInventoryService.processComparisonResult', () => {
  it('adds new script from UnknownScriptFound', () => {
    const result = new UnknownScriptFound(target, timestamp, script)
    const updated = service.processComparisonResult(result, inventory, updateDate)

    expect(updated.scripts.length).toBe(inventory.scripts.length + 1)
    expect(updated.scripts[updated.scripts.length - 1].identifyWith).toBeDefined()
  })

  it('updates existing script with new hash (hash matcher)', () => {
    const result = new KnownScriptWithUnauthorisedContentFound(...)
    const updated = service.processComparisonResult(result, inventory, updateDate)

    const matchedEntry = updated.scripts.find(s => s === result.inventoryEntry)
    expect(matchedEntry.authoriseWith.matcher.getPattern()).toContain(newHash)
  })

  it('converts single matcher to array when adding hash (non-hash matcher)', () => {
    // Initial entry has contentMatcher
    const result = new KnownScriptWithUnauthorisedContentFound(...)
    const updated = service.processComparisonResult(result, inventory, updateDate)

    const rawEntry = inventoryScriptInfoToRawInventoryScriptInfo(matchedEntry)
    expect(Array.isArray(rawEntry.authoriseWith)).toBe(true)
    expect(rawEntry.authoriseWith).toHaveLength(2)
  })
})
```

### Integration Tests

Existing integration tests should pass without modification:

```bash
npm run test:integration
```

---

## Troubleshooting

### Issue: "Property 'newScripts' does not exist"

**Cause**: Code is accessing legacy ScriptComparisonResult properties

**Fix**: Use discriminated union pattern
```typescript
// DON'T:
summary.externalScripts.newScripts.forEach(...)

// DO:
results.forEach(result => {
  if (result.type === 'unknown_script_found') {
    const script = result.script
    // ...
  }
})
```

### Issue: "Type 'ComparisonResultType[]' is not assignable to parameter"

**Cause**: Function signature hasn't been updated to accept typed results

**Fix**: Update function parameter type
```typescript
// Change:
function processSummary(summary: ScriptComparisonSummary) { ... }

// To:
function processResults(results: ComparisonResultType[]) { ... }
```

---

## Next Steps

1. **Read [data-model.md](./data-model.md)** for detailed entity definitions
2. **Review [contracts/](./contracts/)** for API contracts and examples
3. **Check [migration-guide.md](./contracts/migration-guide.md)** for updating existing code
4. **Study [research.md](./research.md)** for implementation rationale

---

## Reference

### File Locations

- **InventoryService**: [src/services/inventory.ts](../../src/services/inventory.ts)
- **Comparison Results**: [src/types/comparison/index.ts](../../src/types/comparison/index.ts)
- **IInventoryService**: [src/interfaces/inventory.ts](../../src/interfaces/inventory.ts)
- **Main Handler**: [src/main.ts](../../src/main.ts)

### Key Methods

- `InventoryService.diff()` - Updated signature accepting ComparisonResultType[]
- `processComparisonResult()` - Internal switch dispatcher
- `addNewScript()` - Creates inventory entry from UnknownScriptFound
- `updateScriptWithNewHash()` - Updates entry from KnownScriptWithUnauthorisedContentFound
- `addNewHeader()` - Creates header entry from UnknownHeaderFound
- `updateHeaderWithNewContent()` - Updates header from KnownHeaderWithUnauthorisedContentFound

### Type Exports

```typescript
// Typed comparison results
import type { ComparisonResultType } from '../types/comparison/index'

// Individual result classes
import {
  UnknownScriptFound,
  KnownScriptWithUnauthorisedContentFound,
  AuthorizedScriptFound,
  UnknownHeaderFound,
  KnownHeaderWithUnauthorisedContentFound,
  AuthorizedHeaderFound
} from '../types/comparison/index'
```
