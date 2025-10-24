# Data Model: Use Typed Comparison Results for Inventory Updates

**Feature**: 006-use-typed-comparison
**Date**: 2025-10-24

## Overview

This document defines the data entities and relationships for the refactored inventory update system. The refactoring eliminates legacy ScriptComparisonResult/ScriptComparisonSummary types in favor of direct processing of typed ComparisonResultType union.

## Core Entities

### ComparisonResultType (Union - Existing)

**Location**: [src/types/comparison/index.ts](../../src/types/comparison/index.ts)

**Definition**:
```typescript
type ComparisonResultType =
  | UnknownScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | AuthorizedScriptFound
  | UnknownHeaderFound
  | KnownHeaderWithUnauthorisedContentFound
  | AuthorizedHeaderFound
```

**Purpose**: Discriminated union of all possible comparison results enabling exhaustive type checking

**Discriminator**: `type` property on each result class

**Usage**: Input to InventoryService.diff() method (replaces legacy ScriptComparisonSummary/HeaderComparisonSummary)

---

### InventoryUpdateAction (New Internal Type)

**Location**: Internal to [src/services/inventory.ts](../../src/services/inventory.ts) (not exported)

**Definition**:
```typescript
type InventoryUpdateAction =
  | { action: 'add_script'; script: InventoryScriptInfo }
  | { action: 'update_script_hash'; entryIndex: number; newHash: InventoryScriptHashInfo }
  | { action: 'convert_script_to_array'; entryIndex: number; arrayConfig: RawInventoryScriptInfo['authoriseWith'] }
  | { action: 'add_header'; header: InventoryHeaderInfo }
  | { action: 'update_header_content'; entryIndex: number; newMatcher: RawInventoryHeaderInfo['authoriseWith'] }
  | { action: 'convert_header_to_array'; entryIndex: number; arrayConfig: RawInventoryHeaderInfo['authoriseWith'] }
  | { action: 'no_change' }
```

**Purpose**: Represents the inventory mutation derived from a ComparisonResultType

**Usage**: Intermediate representation for clarity (optional - can be inlined into switch statement)

**Validation Rules**:
- `entryIndex` must be valid index in inventory.scripts or inventory.headers array
- `newHash` must have unique SHA-256 value (idempotency check)
- `arrayConfig` must preserve original authorisationInfo when converting single matcher

**State Transitions**: N/A (stateless transformation)

---

### InventoryUpdateResult (Renamed from InventoryDifferenceResult)

**Location**: [src/types/inventory/model.ts](../../src/types/inventory/model.ts)

**Definition** (unchanged):
```typescript
type InventoryDifferenceResult = {
  oldInventory: Inventory
  newInventory: Inventory
}
```

**Purpose**: Captures before/after state for Git commit generation

**Relationships**:
- Contains two `Inventory` instances (immutable update pattern)
- `newInventory` contains all changes derived from ComparisonResultType[]

**Usage**: Returned by InventoryService.diff(), passed to InventoryService.push()

---

### DetectedScript (Existing)

**Location**: [src/types/matcher/matcher.interface.ts](../../src/types/matcher/matcher.interface.ts)

**Definition**:
```typescript
interface DetectedScript {
  name: string        // URL for external scripts, ID for inline scripts
  content: string     // URL for external, actual content for inline
  hash: ScriptHash    // SHA-256 hash of content
}
```

**Purpose**: Normalized representation of detected script for matcher operations

**Relationships**:
- Used in UnknownScriptFound and KnownScriptWithUnauthorisedContentFound results
- Converted to InventoryScriptInfo when creating new inventory entries

**Validation Rules**:
- Empty/null content triggers UnknownScriptFound (fail-secure per Constitution)
- Hash must be valid SHA-256 hex string

---

### DetectedHeader (Existing)

**Location**: [src/types/header.ts](../../src/types/header.ts)

**Definition**:
```typescript
type DetectedHeader = {
  name: HeaderName      // Header name (case-insensitive per RFC 7230)
  value: HeaderValues   // Set of header values
  target: Target        // Target that detected this header
  workflow: Workflow    // Workflow that detected this header
}
```

**Purpose**: Normalized representation of detected header for matcher operations

**Relationships**:
- Used in UnknownHeaderFound and KnownHeaderWithUnauthorisedContentFound results
- Converted to InventoryHeaderInfo when creating new inventory entries

**Validation Rules**:
- Empty/null value Set triggers UnknownHeaderFound (fail-secure)
- Header name matching is case-insensitive via HeaderNameMatcher

---

## Modified Entities

### IInventoryService (Modified Interface)

**Location**: [src/interfaces/inventory.ts](../../src/interfaces/inventory.ts)

**Before**:
```typescript
interface IInventoryService {
  pull(target: PullTarget): Promise<Inventory[]>

  diff(
    inventory: Inventory,
    scriptComparisonSummary: ScriptComparisonSummary,
    headerComparisonSummary: HeaderComparisonSummary
  ): Promise<InventoryDifferenceResult>

  push(diffs: InventoryDifferenceResult[]): Promise<void>
}
```

**After**:
```typescript
interface IInventoryService {
  pull(target: PullTarget): Promise<Inventory[]>

  diff(
    inventory: Inventory,
    comparisonResults: ComparisonResultType[]
  ): Promise<InventoryDifferenceResult>

  push(diffs: InventoryDifferenceResult[]): Promise<void>
}
```

**Changes**:
- Replaced `scriptComparisonSummary` and `headerComparisonSummary` parameters with single `comparisonResults` array
- Maintains same return type (InventoryDifferenceResult)
- Validation logic moves inside diff() to check all results are from inventory workflow

---

### InventoryScriptInfo (Structure - No Schema Changes)

**Location**: [src/types/inventory/model.ts](../../src/types/inventory/model.ts)

**Relevant Properties**:
```typescript
interface InventoryScriptInfo {
  identifyWith: Matcher           // How to identify this script
  authoriseWith: MatcherConfig    // How to authorize (can be single or array)
}

type MatcherConfig = {
  matcher: Matcher                       // The authorization matcher
  authorisationInfo: InventoryAuthorisationInfo  // Metadata
}
```

**Update Operations**:
1. **Add new hash to existing entry** (FR-002a):
   - Convert to RawInventoryScriptInfo
   - If `authoriseWith` has `hashes` array, append new hash (if not duplicate)
   - Preserve existing `authorisationInfo` unchanged
   - Convert back to InventoryScriptInfo

2. **Convert single matcher to array** (FR-002b):
   - Convert to RawInventoryScriptInfo
   - Wrap `authoriseWith` in array with original config (including authorisationInfo)
   - Append new hash matcher with new authorisationInfo (discovery context, current timestamp)
   - Convert back to InventoryScriptInfo (processAuthorizeWith converts array to OrMatcher)

---

### InventoryHeaderInfo (Structure - No Schema Changes)

**Location**: [src/types/inventory/model.ts](../../src/types/inventory/model.ts)

**Relevant Properties**:
```typescript
interface InventoryHeaderInfo {
  identifyWith: Matcher           // HeaderNameMatcher (case-insensitive)
  authoriseWith: MatcherConfig    // ContentMatcher (can be single or array)
}
```

**Update Operations**:
1. **Add new content matcher to array** (FR-003a):
   - Convert to RawInventoryHeaderInfo
   - If `authoriseWith` is array, append new contentMatcher config (if pattern not duplicate)
   - Each matcher in array has its own authorisationInfo
   - Convert back to InventoryHeaderInfo

2. **Convert single matcher to array** (FR-003b):
   - Convert to RawInventoryHeaderInfo
   - Wrap `authoriseWith` in array with original config
   - Append new contentMatcher config with new authorisationInfo
   - Convert back to InventoryHeaderInfo

---

## Removed Entities (Legacy Types)

### ScriptComparisonResult (To Be Removed)

**Location**: [src/types/comparison.ts](../../src/types/comparison.ts)

**Definition** (legacy):
```typescript
type ScriptComparisonResult = {
  newScripts: ScriptInfo[]
  newHashes: ScriptInfo[]
}
```

**Why Removed**: Typed ComparisonResultType union provides same information with better type safety

---

### ScriptComparisonSummary (To Be Removed)

**Location**: [src/types/comparison.ts](../../src/types/comparison.ts)

**Definition** (legacy):
```typescript
type ScriptComparisonSummary = {
  target: Target
  externalScripts: ScriptComparisonResult
  inlineScripts: ScriptComparisonResult
}
```

**Why Removed**: ComparisonResultType[] already contains target and script details

---

### HeaderComparisonSummary (To Be Removed)

**Location**: [src/types/comparison.ts](../../src/types/comparison.ts)

**Definition** (legacy):
```typescript
type HeaderComparisonSummary = {
  target: Target
  unauthorisedHeaders: Map<HeaderName, HeaderValues> | undefined
}
```

**Why Removed**: UnknownHeaderFound and KnownHeaderWithUnauthorisedContentFound contain equivalent information

---

## Data Flow

### Inventory Update Flow (After Refactoring)

```
┌─────────────────────────────────────────────────────┐
│ ComparisonService.compare()                         │
│ Returns: ComparisonResultType[]                     │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ InventoryService.diff()                             │
│ Input: Inventory, ComparisonResultType[]            │
│                                                      │
│ 1. Validate all results from inventory workflow     │
│ 2. For each result, call processComparisonResult()  │
│ 3. Accumulate changes into updatedInventory         │
│                                                      │
│ Returns: InventoryDifferenceResult                  │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ InventoryService.processComparisonResult()          │
│ Switch on result.type:                              │
│                                                      │
│ • unknown_script_found                              │
│   → addNewScript()                                  │
│                                                      │
│ • known_script_unauthorised_content                 │
│   → updateScriptWithNewHash()                       │
│     - If authoriseWith has hashes: add to array     │
│     - Else: convert to array syntax                 │
│                                                      │
│ • unknown_header_found                              │
│   → addNewHeader()                                  │
│                                                      │
│ • known_header_unauthorised_content                 │
│   → updateHeaderWithNewContent()                    │
│     - If authoriseWith is array: append matcher     │
│     - Else: convert to array syntax                 │
│                                                      │
│ • authorized_script / authorized_header             │
│   → Return inventory unchanged                      │
│                                                      │
│ Returns: Updated Inventory                          │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│ InventoryService.push()                             │
│ Input: InventoryDifferenceResult[]                  │
│                                                      │
│ Delegates to InventoryRepository.push()             │
│ → Creates Git commits for changes                   │
└─────────────────────────────────────────────────────┘
```

### Comparison to Legacy Flow

**Legacy (Before)**:
1. ComparisonService → ComparisonResultType[]
2. Main handler → Convert to ScriptComparisonSummary/HeaderComparisonSummary
3. InventoryService.diff() → Process newScripts array (one pass)
4. InventoryService.diff() → Process newHashes array (another pass)
5. InventoryService.diff() → Process unauthorisedHeaders (another pass)
6. Return InventoryDifferenceResult

**Refactored (After)**:
1. ComparisonService → ComparisonResultType[]
2. InventoryService.diff() → Process all results (single pass)
3. Return InventoryDifferenceResult

**Improvement**: Two fewer conversions, three fewer passes, unified handling

---

## Validation Rules

### Input Validation

1. **All results must be from inventory workflow** (FR-008):
   - Check `result.target.type === 'inventory'` for all results
   - Reject with error if any detection workflow results found

2. **No null/empty content** (handled upstream):
   - Comparison service ensures null/empty content triggers UnknownScriptFound
   - InventoryService assumes DetectedScript content is valid if present in result

### Idempotency (FR-006a)

1. **Hash deduplication**:
   - Before adding hash to `authoriseWith.hashes` array, check if `hash.value` already exists
   - Use case-sensitive string comparison for SHA-256 hex strings

2. **Content matcher deduplication**:
   - Before adding contentMatcher to array, check if pattern already exists
   - Use case-sensitive string comparison for regex patterns

### Authorization Metadata (FR-011, FR-011a, FR-011b)

1. **Adding hash to existing hash matcher** (FR-011):
   - Append to `authoriseWith.hashes` array
   - Do NOT modify `authoriseWith.authorisationInfo` (preserve original)

2. **Converting to array syntax** (FR-011b):
   - Each matcher in resulting array has its own `authorisationInfo`
   - Original matcher preserves existing metadata
   - New matcher gets new metadata with discovery context and current timestamp

---

## Migration Impact

### Breaking Changes

- **IInventoryService.diff() signature**: Consumers must pass ComparisonResultType[] instead of legacy summaries
- **Main handler**: Must remove conversion logic from ComparisonResultType[] to legacy types

### Non-Breaking Changes

- **Inventory schema**: No changes to JSON structure
- **Git commit format**: No changes to commit messages or repository structure
- **Alert format**: No changes to alert payloads (alerts already use ComparisonResultType)
- **Test expectations**: Integration tests should pass without modification (behavior unchanged)

### Removed Code

- [src/types/comparison.ts](../../src/types/comparison.ts) - Remove ScriptComparisonResult, ScriptComparisonSummary, HeaderComparisonSummary
- Conversion utilities in [src/main.ts](../../src/main.ts) (if any) - Remove ComparisonResultType[] → legacy summary conversions

---

## Type Safety Guarantees

### Exhaustive Checking

TypeScript compiler ensures all ComparisonResultType cases are handled:
```typescript
switch (result.type) {
  case 'unknown_script_found': /* ... */ break
  case 'known_script_unauthorised_content': /* ... */ break
  case 'authorized_script': /* ... */ break
  case 'unknown_header_found': /* ... */ break
  case 'known_header_unauthorised_content': /* ... */ break
  case 'authorized_header': /* ... */ break
  default:
    // TypeScript error if any case is missing
    const _exhaustive: never = result
    throw new Error(`Unhandled type: ${(_exhaustive as any).type}`)
}
```

### Narrowing

Within each case, TypeScript narrows `result` to specific class:
```typescript
case 'known_script_unauthorised_content':
  // TypeScript knows result is KnownScriptWithUnauthorisedContentFound
  const script = result.script  // OK
  const inventoryEntry = result.inventoryEntry  // OK
  const failureReason = result.failureReason  // OK
```

---

## Summary

The refactored data model eliminates three legacy types (ScriptComparisonResult, ScriptComparisonSummary, HeaderComparisonSummary) in favor of direct processing of typed ComparisonResultType union. The InventoryService.diff() method signature simplifies from three parameters to two, and internal processing changes from multiple passes (newScripts → newHashes → unauthorisedHeaders) to a single pass with exhaustive switch-based dispatch. All existing entities (Inventory, InventoryScriptInfo, InventoryHeaderInfo) remain unchanged except for update logic. Type safety improves via TypeScript discriminated union exhaustiveness checking.
