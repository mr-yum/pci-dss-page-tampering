# Migration Guide: Legacy Comparison Summaries to Typed Results

**Feature**: 006-use-typed-comparison
**Date**: 2025-10-24

## Overview

This guide provides step-by-step instructions for updating code from legacy `ScriptComparisonSummary`/`HeaderComparisonSummary` to typed `ComparisonResultType[]`.

## Migration Steps

### Step 1: Update InventoryService.diff() Calls

**Before** (legacy):

```typescript
const scriptComparisonSummary: ScriptComparisonSummary = await scriptComparisonService.compare(...)
const headerComparisonSummary: HeaderComparisonSummary = await headerComparisonService.compare(...)

const diff = await inventoryService.diff(
  inventory,
  scriptComparisonSummary,
  headerComparisonSummary
)
```

**After** (typed):

```typescript
const comparisonResults: ComparisonResultType[] = [
  ...(await scriptComparisonService.compare(...)),
  ...(await headerComparisonService.compare(...))
]

const diff = await inventoryService.diff(inventory, comparisonResults)
```

**Key Changes**:

- Both comparison services now return `ComparisonResultType[]`
- Spread and concatenate results into single array
- Pass single array to `diff()` instead of separate summaries

---

### Step 2: Remove Legacy Summary Conversions

**Before** (legacy conversion code):

```typescript
// Convert ComparisonResultType[] to ScriptComparisonSummary
function toScriptComparisonSummary(
  results: ComparisonResultType[],
  target: Target
): ScriptComparisonSummary {
  const newScripts: ScriptInfo[] = []
  const newHashes: ScriptInfo[] = []

  results.forEach(result => {
    if (result.type === 'unknown_script_found') {
      newScripts.push(/* convert DetectedScript to ScriptInfo */)
    } else if (result.type === 'known_script_unauthorised_content') {
      newHashes.push(/* convert DetectedScript to ScriptInfo */)
    }
  })

  return {
    target,
    externalScripts: { newScripts: [...], newHashes: [...] },
    inlineScripts: { newScripts: [...], newHashes: [...] }
  }
}
```

**After** (no conversion needed):

```typescript
// Delete this function - conversion is no longer needed!
// InventoryService.diff() accepts ComparisonResultType[] directly
```

---

### Step 3: Update Type Imports

**Before**:

```typescript
import type { ScriptComparisonResult, ScriptComparisonSummary, HeaderComparisonSummary } from '../types/comparison'
```

**After**:

```typescript
import type { ComparisonResultType } from '../types/comparison/index'
```

**Files to Update**:

- [src/main.ts](../../../src/main.ts)
- [src/interfaces/inventory.ts](../../../src/interfaces/inventory.ts)
- Any test files importing legacy types

---

### Step 4: Update Alert Handlers (If Needed)

Alert handlers should already be using `ComparisonResultType[]` from Phase 4 refactoring. Verify no legacy types remain.

**Check**:

```typescript
// Alert handlers should look like this:
function sendAlert(result: ComparisonResultType) {
  switch (result.type) {
    case 'unknown_script_found':
      // Send alert with result.script details
      break
    case 'known_script_unauthorised_content':
      // Send alert with result.failureReason
      break
    // ... etc
  }
}
```

**If legacy types found**:

```typescript
// REMOVE THIS:
function sendAlert(summary: ScriptComparisonSummary) {
  summary.externalScripts.newScripts.forEach((script) => {
    // Alert logic
  })
}

// REPLACE WITH THIS:
function sendAlert(result: ComparisonResultType) {
  if (result.type === 'unknown_script_found') {
    // Alert logic using result.script
  }
}
```

---

### Step 5: Run Tests and Verify

1. **Type checking**:

   ```bash
   npm run check:typing
   ```

   - Should show no errors related to legacy types
   - May show errors in files that haven't been migrated yet

2. **Unit tests**:

   ```bash
   npm run test:unit
   ```

   - Existing tests should pass (behavior unchanged)
   - Add new tests for generic update handler

3. **Integration tests**:
   ```bash
   npm run test:integration
   ```

   - Full workflow tests should pass without modification

---

### Step 6: Remove Legacy Type Definitions

After all consumers are updated:

**File**: [src/types/comparison.ts](../../../src/types/comparison.ts)

**Remove**:

```typescript
export type ScriptComparisonResult = {
  newScripts: ScriptInfo[]
  newHashes: ScriptInfo[]
}

export type ScriptComparisonSummary = {
  target: Target
  externalScripts: ScriptComparisonResult
  inlineScripts: ScriptComparisonResult
}

export type HeaderComparisonSummary = {
  target: Target
  unauthorisedHeaders: Map<HeaderName, HeaderValues> | undefined
}
```

**Keep**:

```typescript
// Re-export typed comparison results from comparison/index.ts
export type { ComparisonResultType } from './comparison/index'
export { ComparisonResult, UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound } from './comparison/index'
```

---

## Verification Checklist

- [ ] InventoryService.diff() signature updated to accept ComparisonResultType[]
- [ ] IInventoryService interface updated
- [ ] Main.ts removes legacy summary conversions
- [ ] Alert handlers use ComparisonResultType (verify, may already be done)
- [ ] All imports updated from legacy types to ComparisonResultType
- [ ] Type checking passes (npm run check:typing)
- [ ] Unit tests pass (npm run test:unit)
- [ ] Integration tests pass (npm run test:integration)
- [ ] Legacy type definitions removed from src/types/comparison.ts
- [ ] No references to ScriptComparisonResult/ScriptComparisonSummary/HeaderComparisonSummary remain

---

## Common Issues

### Issue: Type error "Property 'newScripts' does not exist on type 'ComparisonResultType'"

**Cause**: Code is trying to access legacy summary properties on typed results

**Fix**: Use discriminated union pattern with switch statement

```typescript
// DON'T DO THIS:
results.newScripts.forEach(...)

// DO THIS:
results.forEach(result => {
  if (result.type === 'unknown_script_found') {
    const script = result.script
    // ... process script
  }
})
```

### Issue: "Cannot find name 'ScriptComparisonSummary'"

**Cause**: Import statement references removed legacy type

**Fix**: Update import

```typescript
// Change this:
import type { ScriptComparisonSummary } from '../types/comparison'

// To this:
import type { ComparisonResultType } from '../types/comparison/index'
```

### Issue: Tests fail with "Expected 2 arguments, but got 3"

**Cause**: Test is calling old InventoryService.diff() signature

**Fix**: Update test to pass single ComparisonResultType[] array

```typescript
// Change this:
await inventoryService.diff(inventory, scriptSummary, headerSummary)

// To this:
await inventoryService.diff(inventory, [...scriptResults, ...headerResults])
```

---

## Rollback Plan

If migration causes issues:

1. **Revert commits**: Use `git revert` to undo changes
2. **Keep typed results**: Don't revert comparison service changes (they're already deployed)
3. **Restore conversion logic**: Add back the conversion from ComparisonResultType[] to legacy summaries
4. **File issue**: Document the problem for future investigation

---

## Support

For questions or issues during migration:

- Check [data-model.md](../data-model.md) for entity definitions
- Review [research.md](../research.md) for implementation patterns
- See [inventory-service-examples.ts](./inventory-service-examples.ts) for usage examples
