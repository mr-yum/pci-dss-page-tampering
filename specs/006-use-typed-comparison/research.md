# Research: Use Typed Comparison Results for Inventory Updates

**Feature**: 006-use-typed-comparison
**Date**: 2025-10-24

## Overview

This document captures research findings for refactoring inventory updates to use typed comparison results directly, eliminating conversions to legacy ScriptComparisonResult/HeaderComparisonSummary types.

## R1: Current Inventory Update Flow

### Decision: Understand the multi-step legacy approach

**Current Flow**:
1. Comparison services return `ComparisonResultType[]` containing typed results (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, etc.)
2. Main handler converts these to legacy `ScriptComparisonSummary` and `HeaderComparisonSummary` types
3. InventoryService.diff() receives legacy summaries with `newScripts` and `newHashes` arrays
4. Three separate update methods process changes:
   - `getUpdatedInventoryWithNewScripts()` - adds new inventory entries
   - `getUpdatedInventoryWithNewHashes()` - updates existing entries with new hashes
   - `getUpdatedInventoryWithNewHeaders()` - adds new header entries
5. Multiple passes through inventory data structures

**Code Locations**:
- [src/services/inventory.ts](../../src/services/inventory.ts) - InventoryService with three separate update methods
- [src/types/comparison.ts](../../src/types/comparison.ts) - Legacy ScriptComparisonResult/ScriptComparisonSummary types
- [src/types/comparison/index.ts](../../src/types/comparison/index.ts) - Typed ComparisonResultType union

**Rationale**: Understanding the current flow reveals unnecessary conversions and multiple passes that can be eliminated.

**Alternatives Considered**: N/A (investigation)

---

## R2: Typed Comparison Result Structure

### Decision: Leverage discriminated union pattern for direct processing

**Typed Result Classes**:
- **UnknownScriptFound**: Contains `script: DetectedScript` with full context (name, content, hash)
- **KnownScriptWithUnauthorisedContentFound**: Contains `script`, `inventoryEntry`, `authorizationMatcher`, `failureReason`, `metadataPath`
- **AuthorizedScriptFound**: Contains `script`, `inventoryEntry`, `metadataPath` (no action needed)
- **UnknownHeaderFound**: Contains `header: DetectedHeader` with full context
- **KnownHeaderWithUnauthorisedContentFound**: Contains `header`, `inventoryEntry`, `authorizationMatcher`, `failureReason`, `metadataPath`
- **AuthorizedHeaderFound**: Contains `header`, `inventoryEntry`, `metadataPath` (no action needed)

**Discriminator**: Each class has a unique `type` property for TypeScript exhaustive checking

**Benefits**:
1. All information needed for inventory updates is present in typed results
2. No need to convert back to legacy types with arrays
3. TypeScript guarantees exhaustive handling via switch statements
4. Maintains complete audit context (target, timestamp, matcher details)

**Code Locations**:
- [src/types/comparison/unknown-script-found.ts](../../src/types/comparison/unknown-script-found.ts)
- [src/types/comparison/known-script-unauthorised-content-found.ts](../../src/types/comparison/known-script-unauthorised-content-found.ts)
- [src/types/comparison/unknown-header-found.ts](../../src/types/comparison/unknown-header-found.ts)

**Rationale**: Typed results contain all necessary information; conversion is purely overhead.

**Alternatives Considered**:
- Keep legacy types and add conversion utilities: Rejected because it maintains technical debt
- Create intermediate DTOs: Rejected because typed results already serve this purpose

---

## R3: TypeScript Discriminated Unions Best Practices

### Decision: Use switch statements with exhaustive checking

**Pattern for Generic Handler**:
```typescript
function processComparisonResult(result: ComparisonResultType): InventoryUpdateAction {
  switch (result.type) {
    case 'unknown_script_found':
      return createNewInventoryEntry(result.script, result.target, result.timestamp)

    case 'known_script_unauthorised_content':
      return updateExistingEntry(result.inventoryEntry, result.script, result.timestamp)

    case 'authorized_script':
      return noAction() // Already compliant

    case 'unknown_header_found':
      return createNewHeaderEntry(result.header, result.target, result.timestamp)

    case 'known_header_unauthorised_content':
      return updateExistingHeaderEntry(result.inventoryEntry, result.header, result.timestamp)

    case 'authorized_header':
      return noAction() // Already compliant

    default:
      // TypeScript ensures this is unreachable if all cases are handled
      const _exhaustive: never = result
      throw new Error(`Unhandled comparison result type: ${(_exhaustive as any).type}`)
  }
}
```

**Benefits**:
1. TypeScript narrows types within each case branch
2. Compiler error if new result type added but not handled
3. Clear mapping from result type to inventory action
4. Single pass through results array

**Rationale**: Discriminated unions are the TypeScript-idiomatic way to handle polymorphic data with type safety.

**Alternatives Considered**:
- Visitor pattern with classes: Rejected as over-engineered for this use case
- instanceof checks: Rejected because discriminator is simpler and faster

---

## R4: Idempotent Inventory Updates

### Decision: Check for existing hashes/matchers before adding

**Requirement (FR-006a)**: Processing duplicate typed results multiple times must produce the same final inventory state.

**Implementation Strategy**:
1. When adding a hash to existing entry's `authoriseWith.hashes` array, check if hash already exists
2. When adding a content matcher to header's `authoriseWith` array, check if pattern already exists
3. Use hash value comparison for scripts (SHA-256 strings)
4. Use pattern string comparison for content matchers (regex strings)

**Example Pattern**:
```typescript
// For hash matchers - check if hash value already exists
if ('hashes' in authoriseWith) {
  const hashAlreadyExists = authoriseWith.hashes.some(h => h.hash.value === newHash)
  if (!hashAlreadyExists) {
    authoriseWith.hashes.push(newHashInfo)
  }
}

// For content matchers in array - check if pattern already exists
if (Array.isArray(authoriseWith)) {
  const patternAlreadyExists = authoriseWith.some(m =>
    'contentMatcher' in m && m.contentMatcher === newPattern
  )
  if (!patternAlreadyExists) {
    authoriseWith.push(newContentMatcher)
  }
}
```

**Rationale**: Duplicate detection prevents inventory bloat when workflows detect the same script multiple times.

**Alternatives Considered**:
- Deduplicate typed results before processing: Rejected because inventory update layer should be defensive
- Rely on upstream deduplication: Rejected because it's not guaranteed by comparison service contract

---

## R5: Converting Single Matcher to Array Syntax

### Decision: Each matcher in array has its own authorisationInfo

**Requirement (FR-002b, FR-003b, FR-011b)**: When converting from single matcher to array syntax, preserve original matcher's authorisationInfo and give new matcher its own metadata.

**Pattern**:
```typescript
// Original single matcher structure
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

// After adding new hash, convert to array syntax
{
  identifyWith: { nameMatcher: "^https://example\\.com/script\\.js$" },
  authoriseWith: [
    {
      contentMatcher: "function analytics",
      authorisationInfo: {
        description: "Analytics script v1.0",  // Original preserved
        authorised: true,
        date: "2025-01-15T00:00:00.000Z"
      }
    },
    {
      hashes: [{ timestamp: "2025-10-24T12:00:00.000Z", hash: { value: "abc123..." } }],
      authorisationInfo: {
        description: "Hash detected during inventory run 2025-10-24",  // New context
        authorised: true,
        date: "2025-10-24T12:00:00.000Z"
      }
    }
  ]
}
```

**Implementation Steps**:
1. Extract original matcher config using `inventoryScriptInfoToRawInventoryScriptInfo()` or equivalent
2. Create array with original matcher config (preserving authorisationInfo)
3. Add new matcher config with new authorisationInfo indicating discovery context
4. Convert back to InventoryScriptInfo/InventoryHeaderInfo using existing conversion utilities

**Rationale**: Each authorization path needs its own metadata for audit trail. Original authorization context must not be lost.

**Alternatives Considered**:
- Share authorisationInfo between matchers in array: Rejected per clarification answer - each needs its own metadata
- Update original authorisationInfo date: Rejected because it loses original authorization date

---

## R6: Existing Conversion Utilities

### Decision: Reuse rawInventoryScriptInfoToInventoryScriptInfo() for array syntax conversion

**Existing Utilities**:
- `inventoryScriptInfoToRawInventoryScriptInfo()`: Converts matcher instances to JSON-serializable format
- `rawInventoryScriptInfoToInventoryScriptInfo()`: Converts JSON format to matcher instances (handles array syntax via `processAuthorizeWith()`)
- `processAuthorizeWith()`: Processes both single matcher and array syntax, automatically converting array to OrMatcher
- `inventoryHeaderInfoToRawInventoryHeaderInfo()`: Converts header matcher instances to JSON format
- `rawInventoryHeaderInfoToInventoryHeaderInfo()`: Converts JSON format to header matcher instances

**Usage Pattern**:
```typescript
// 1. Convert to raw format to manipulate matcher configs
const rawScript = inventoryScriptInfoToRawInventoryScriptInfo(inventoryEntry)

// 2. Modify authoriseWith (convert to array if needed)
if (!Array.isArray(rawScript.authoriseWith)) {
  rawScript.authoriseWith = [rawScript.authoriseWith, newMatcherConfig]
} else {
  rawScript.authoriseWith.push(newMatcherConfig)
}

// 3. Convert back to InventoryScriptInfo with updated matchers
const updatedScript = rawInventoryScriptInfoToInventoryScriptInfo(rawScript)
```

**Code Locations**:
- [src/utils/script.ts](../../src/utils/script.ts) - Script conversion utilities
- [src/utils/inventory.ts](../../src/utils/inventory.ts) - Header conversion utilities
- [src/types/inventory/zod.ts](../../src/types/inventory/zod.ts) - processAuthorizeWith() for array syntax handling

**Rationale**: Reusing existing utilities ensures consistency with inventory serialization/deserialization.

**Alternatives Considered**:
- Manually construct matcher instances: Rejected because it duplicates existing logic and increases error risk
- Directly manipulate matcher instances: Rejected because Matcher interface doesn't expose mutation methods (immutable by design)

---

## R7: Generic Update Handler Architecture

### Decision: Single method accepting ComparisonResultType[] with switch-based dispatch

**Proposed Signature**:
```typescript
class ScriptInventoryService {
  diff(
    inventory: Inventory,
    comparisonResults: ComparisonResultType[]
  ): Promise<InventoryDifferenceResult>
}
```

**Benefits**:
1. Eliminates separate scriptComparisonSummary and headerComparisonSummary parameters
2. Single pass through results array
3. Type-safe handling of all result types
4. No legacy type conversions

**Implementation Approach**:
```typescript
diff(inventory: Inventory, comparisonResults: ComparisonResultType[]): Promise<InventoryDifferenceResult> {
  // Validation: Ensure all results are from inventory workflow
  const hasDetectionResults = comparisonResults.some(r => r.target.type !== 'inventory')
  if (hasDetectionResults) {
    return Promise.reject(new Error('[Inventory → Service] Cannot run diff with results from detection target!'))
  }

  const updateDate = new Date()
  let updatedInventory = copyInventory(inventory)

  // Single pass through all results
  for (const result of comparisonResults) {
    updatedInventory = this.processComparisonResult(result, updatedInventory, updateDate)
  }

  return Promise.resolve({
    oldInventory: inventory,
    newInventory: updatedInventory,
  })
}

private processComparisonResult(
  result: ComparisonResultType,
  inventory: Inventory,
  updateDate: Date
): Inventory {
  switch (result.type) {
    case 'unknown_script_found':
      return this.addNewScript(result, inventory, updateDate)

    case 'known_script_unauthorised_content':
      return this.updateScriptWithNewHash(result, inventory, updateDate)

    case 'unknown_header_found':
      return this.addNewHeader(result, inventory, updateDate)

    case 'known_header_unauthorised_content':
      return this.updateHeaderWithNewContent(result, inventory, updateDate)

    case 'authorized_script':
    case 'authorized_header':
      return inventory // No change needed

    default:
      const _exhaustive: never = result
      throw new Error(`Unhandled comparison result type: ${(_exhaustive as any).type}`)
  }
}
```

**Rationale**: Functional approach with immutable updates maintains existing pattern while simplifying flow.

**Alternatives Considered**:
- Mutable updates to single inventory object: Rejected because existing code uses immutable copyInventory() pattern
- Separate methods for scripts vs headers: Rejected because switch statement handles both uniformly

---

## R8: Legacy Type Removal Strategy

### Decision: Remove after all consumers updated

**Files to Remove**:
- Legacy type definitions in [src/types/comparison.ts](../../src/types/comparison.ts):
  - `ScriptComparisonResult`
  - `ScriptComparisonSummary`
  - `HeaderComparisonSummary`

**Files to Update**:
- [src/services/inventory.ts](../../src/services/inventory.ts) - Change diff() signature to accept ComparisonResultType[]
- [src/interfaces/inventory.ts](../../src/interfaces/inventory.ts) - Update IInventoryService interface
- [src/main.ts](../../src/main.ts) - Remove conversion from ComparisonResultType[] to legacy summaries
- [src/services/alert/slack.ts](../../src/services/alert/slack.ts) - Verify it uses ComparisonResultType[] (may already be updated)

**Migration Steps**:
1. Update InventoryService.diff() signature and implementation
2. Update IInventoryService interface
3. Update main.ts to pass ComparisonResultType[] directly
4. Verify all tests pass
5. Remove legacy type definitions
6. Verify codebase compiles without legacy types

**Rationale**: Clean migration path ensures no broken references.

**Alternatives Considered**:
- Keep legacy types as deprecated: Rejected because dead code should be removed
- Gradual deprecation with runtime warnings: Rejected because TypeScript catches issues at compile time

---

## R9: Test Strategy

### Decision: Unit tests alongside implementation, integration tests verify end-to-end

**Unit Test Coverage** (new file: [src/services/inventory.test.ts](../../src/services/inventory.test.ts)):
1. **processComparisonResult() tests**:
   - UnknownScriptFound → creates new inventory entry with identifyWith and authoriseWith
   - KnownScriptWithUnauthorisedContentFound (hash matcher) → adds hash to existing hashes array
   - KnownScriptWithUnauthorisedContentFound (non-hash matcher) → converts to array syntax with original + new hash matcher
   - UnknownHeaderFound → creates new header inventory entry
   - KnownHeaderWithUnauthorisedContentFound (single matcher) → converts to array syntax with original + new content matcher
   - KnownHeaderWithUnauthorisedContentFound (array matcher) → adds new content matcher to existing array
   - AuthorizedScriptFound/AuthorizedHeaderFound → no changes to inventory

2. **Idempotency tests**:
   - Processing duplicate UnknownScriptFound twice doesn't create duplicate entries (relies on Git conflict detection)
   - Processing duplicate KnownScriptWithUnauthorisedContentFound twice doesn't add duplicate hashes
   - Processing duplicate header results doesn't add duplicate content matchers

3. **Edge cases**:
   - Mixed script and header results in single batch
   - Array syntax conversion preserves original authorisationInfo
   - Detection workflow results rejected with error

**Integration Test Coverage** (existing tests):
- Full workflow tests already verify inventory updates work correctly
- Should continue passing without modification (behavior unchanged)

**Rationale**: Unit tests ensure new logic is correct; integration tests ensure no regressions.

**Alternatives Considered**:
- Only integration tests: Rejected because unit tests provide faster feedback on specific scenarios
- Separate test files for each method: Rejected because InventoryService is cohesive and tests belong together

---

## Summary

This refactoring leverages TypeScript's discriminated union pattern to eliminate unnecessary conversions between typed comparison results and legacy types. The generic update handler uses a switch statement for type-safe, exhaustive handling of all result types. Existing conversion utilities enable safe manipulation of matcher configurations for array syntax conversion. The approach maintains all existing behaviors (audit trail, idempotency, fail-secure) while reducing code complexity.
