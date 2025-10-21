# Type Contracts: Schema Enhancement

**Feature**: Embed Authorization Info in Authorization Entity
**Branch**: 004-enhance-the-schema
**Date**: 2025-10-21

## Overview

This document defines the type contracts for the enhanced inventory schema. These contracts specify the interfaces between different layers of the system and ensure consistent data structures across serialization boundaries.

## Contract Definitions

### Contract 1: AuthorizeWithConfig Runtime Type

**Purpose**: Define the runtime structure for authorization configuration.

**Provider**: Type system (`src/types/inventory/model.ts`)

**Consumer**: Comparison services, inventory utilities

**Contract**:

```typescript
type AuthorizeWithConfig = {
  matcher: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}
```

**Guarantees**:

- `matcher` is a valid Matcher instance (NameMatcher | ContentMatcher | HashMatcher | HeaderNameMatcher)
- `authorisationInfo` contains valid metadata (non-empty description, boolean authorised, valid Date)
- Both fields are always present (required)

**Validation**: TypeScript compiler enforces structure at compile time

---

### Contract 2: RawAuthorizeWithConfig Serialization Format

**Purpose**: Define the JSON-serializable structure for persistence.

**Provider**: Conversion utilities (`src/utils/script.ts`, `src/utils/inventory.ts`)

**Consumer**: Git storage, inventory repository

**Contract**:

```typescript
type RawAuthorizeWithConfig = RawMatcherConfig & {
  authorisationInfo: {
    description: string
    authorised: boolean
    date: string // ISO 8601 format
  }
}
```

**Structure**: Intersection type where matcher configuration fields (one of: `nameMatcher`, `contentMatcher`, `hashes`, `headerNameMatcher`) and `authorisationInfo` are siblings in the same object.

**Guarantees**:

- Exactly one matcher field present (nameMatcher OR contentMatcher OR hashes OR headerNameMatcher)
- Matcher field conforms to RawMatcherConfig discriminated union
- `authorisationInfo.date` is ISO 8601 formatted string (parseable by `new Date()`)
- `authorisationInfo.description` is non-empty string
- JSON serialization is deterministic and reversible
- Matcher config and authorization metadata are siblings (flat structure)

**Validation**: Zod schema validates on deserialization

---

### Contract 3: InventoryScriptInfo with Nested Authorization

**Purpose**: Define the updated inventory script entry structure.

**Provider**: Inventory utilities

**Consumer**: Comparison services, inventory service

**Contract**:

```typescript
type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig // CHANGED: Was Matcher
}
```

**Breaking Changes from Previous Version**:

- `authoriseWith` type changed from `Matcher` to `AuthorizeWithConfig`
- `authorisationInfo` field removed from top level (now nested in `authoriseWith`)

**Migration Path**:

- Access authorization matcher: `entry.authoriseWith.matcher` (was: `entry.authoriseWith`)
- Access authorization info: `entry.authoriseWith.authorisationInfo` (was: `entry.authorisationInfo`)

**Guarantees**:

- All authorization-related data accessible from `authoriseWith` field
- Identification logic unchanged (`identifyWith` remains `Matcher`)

**Validation**: TypeScript compiler + Zod schema

---

### Contract 4: InventoryHeaderInfo with Nested Authorization

**Purpose**: Define the updated inventory header entry structure.

**Provider**: Inventory utilities

**Consumer**: Comparison services, inventory service

**Contract**:

```typescript
type InventoryHeaderInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig // CHANGED: Was Matcher
}
```

**Breaking Changes from Previous Version**:

- Same breaking changes as InventoryScriptInfo (see Contract 3)

**Migration Path**:

- Access authorization matcher: `entry.authoriseWith.matcher` (was: `entry.authoriseWith`)
- Access authorization info: `entry.authoriseWith.authorisationInfo` (was: `entry.authorisationInfo`)

**Guarantees**:

- Same guarantees as InventoryScriptInfo (see Contract 3)

**Validation**: TypeScript compiler + Zod schema

---

### Contract 5: Conversion Function Interfaces

**Purpose**: Define the interfaces for round-trip conversion between runtime and serializable types.

**Provider**: Utility functions (`src/utils/script.ts`, `src/utils/inventory.ts`)

**Consumer**: Inventory repository, inventory service

**Contract**:

#### Script Conversion Functions

```typescript
// Create new inventory entry from detected script
function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo

// Deserialize from JSON
function rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScriptInfo: RawInventoryScriptInfo): InventoryScriptInfo

// Serialize to JSON
function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo
```

#### Header Conversion Functions

```typescript
// Deserialize from JSON
function rawInventoryHeaderInfoToInventoryHeaderInfo(rawHeaderInfo: RawInventoryHeaderInfo): InventoryHeaderInfo

// Serialize to JSON
function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo
```

**Guarantees**:

- Round-trip conversion preserves data: `deserialize(serialize(x)) ≡ x`
- Date conversion is reversible: `new Date(date.toISOString()) ≡ date` (millisecond precision)
- Matcher conversion preserves identification and authorization behavior
- All functions throw on invalid input (fail-fast)

**Validation**: Unit tests must verify round-trip property

---

### Contract 6: Comparison Service Access Pattern

**Purpose**: Define how comparison services access authorization data.

**Provider**: Inventory entries (InventoryScriptInfo, InventoryHeaderInfo)

**Consumer**: ScriptComparisonService, HeaderComparisonService

**Contract**:

```typescript
// BEFORE (current):
const inventoryEntry: InventoryScriptInfo
const authMatcher: Matcher = inventoryEntry.authoriseWith
const authInfo: InventoryAuthorisationInfo = inventoryEntry.authorisationInfo

// AFTER (new):
const inventoryEntry: InventoryScriptInfo
const authMatcher: Matcher = inventoryEntry.authoriseWith.matcher
const authInfo: InventoryAuthorisationInfo = inventoryEntry.authoriseWith.authorisationInfo
```

**Breaking Changes**:

- Authorization matcher access: `entry.authoriseWith` → `entry.authoriseWith.matcher`
- Authorization info access: `entry.authorisationInfo` → `entry.authoriseWith.authorisationInfo`

**Guarantees**:

- All authorization context accessible from single `authoriseWith` field
- No null checks required (fields guaranteed present by type system)
- Behavior unchanged (matcher and info used identically, just accessed differently)

**Validation**: Comparison service tests must pass with new access pattern

---

### Contract 7: Zod Schema Validation

**Purpose**: Define runtime validation contracts for deserialized data.

**Provider**: Zod schemas (`src/types/inventory/zod.ts`)

**Consumer**: Inventory repository (during JSON load)

**Contract**:

```typescript
const RawAuthorizeWithConfigSchema = z.intersection(
  RawMatcherConfigSchema,
  z.object({
    authorisationInfo: z.object({
      description: z.string().min(1),
      authorised: z.boolean(),
      date: z.string().datetime(),
    }),
  }),
)

const RawInventoryScriptInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema,
})

const RawInventoryHeaderInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema,
})
```

**Note**: The intersection combines RawMatcherConfig fields with authorisationInfo as siblings, creating a flat structure where matcher fields and metadata coexist in the same object.

**Guarantees**:

- Invalid JSON fails validation with descriptive error
- Missing `authorisationInfo` fails validation (required field)
- Empty `description` fails validation (min 1 character)
- Invalid `date` format fails validation (must be ISO 8601)
- TypeScript inferred types match runtime validation: `z.infer<typeof Schema> === Type`

**Error Handling**:

- Validation failure throws ZodError with detailed error path
- Caller (inventory repository) logs error and rejects inventory load
- No partial data accepted (all-or-nothing validation)

---

## Integration Points

### Point 1: Inventory Load (JSON → Runtime)

**Flow**: `InventoryRepository.pull()` → Zod validation → Conversion utilities → `Inventory`

**Contracts Involved**:

- Contract 2: RawAuthorizeWithConfig format
- Contract 7: Zod schema validation
- Contract 5: Conversion functions
- Contract 3/4: InventoryScriptInfo/InventoryHeaderInfo structure

**Failure Modes**:

- Invalid JSON format → Zod validation fails → Error logged, inventory not loaded
- Missing fields → Zod validation fails → Error logged, inventory not loaded
- Invalid matcher config → Matcher factory throws → Error logged, inventory not loaded

---

### Point 2: Inventory Save (Runtime → JSON)

**Flow**: `InventoryService.push()` → Conversion utilities → JSON.stringify → Git commit

**Contracts Involved**:

- Contract 5: Conversion functions
- Contract 2: RawAuthorizeWithConfig format
- Contract 3/4: InventoryScriptInfo/InventoryHeaderInfo structure

**Failure Modes**:

- Unknown matcher type → Conversion function throws → Error logged, push aborted
- Invalid date → Conversion function throws → Error logged, push aborted

---

### Point 3: Script Comparison (Detection Workflow)

**Flow**: `DetectionService.detect()` → `ScriptComparisonService.compare()` → Access authorization data

**Contracts Involved**:

- Contract 3: InventoryScriptInfo structure
- Contract 6: Comparison service access pattern
- Contract 1: AuthorizeWithConfig structure

**Failure Modes**:

- None (type system guarantees all fields present)

---

### Point 4: New Script Discovery (Inventory Workflow)

**Flow**: Detect new script → `scriptInfoToInventoryScriptInfo()` → Add to inventory → Save to Git

**Contracts Involved**:

- Contract 5: Conversion function (scriptInfoToInventoryScriptInfo)
- Contract 1: AuthorizeWithConfig structure
- Contract 3: InventoryScriptInfo structure

**Failure Modes**:

- None (function creates valid structure by design)

---

## Testing Contracts

### Test 1: Round-Trip Serialization

**Requirement**: FR-011 (round-trip serialization preserves nested authorisationInfo)

**Contract**: `deserialize(serialize(x)) ≡ x`

**Test Cases**:

1. Script entry with NameMatcher + HashMatcher
2. Script entry with ContentMatcher + ContentMatcher
3. Header entry with HeaderNameMatcher + ContentMatcher
4. Entry with `authorised: false`
5. Entry with `authorised: true`

**Success Criteria**:

- All fields match after round-trip
- Date precision preserved (milliseconds)
- Matcher behavior preserved (identify/authorize results identical)

---

### Test 2: Schema Validation

**Requirement**: FR-010 (schema validation ensures correct nesting)

**Contract**: Valid structure passes, invalid structure fails

**Test Cases**:

1. Valid nested structure → Pass
2. Missing `authorisationInfo` → Fail
3. Missing `matcher` → Fail
4. Empty `description` → Fail
5. Invalid `date` format → Fail
6. Extra unknown fields → Pass (Zod strips by default)

**Success Criteria**:

- Valid structures pass without errors
- Invalid structures fail with descriptive error messages

---

### Test 3: Comparison Service Integration

**Requirement**: FR-012 (comparison services correctly access authorization data)

**Contract**: Services access nested data without errors

**Test Cases**:

1. Authorized script → Return AuthorizedScriptFound
2. Unauthorized content → Return KnownScriptWithUnauthorisedContentFound
3. Unknown script → Return UnknownScriptFound
4. Access `authorisationInfo.authorised` flag → No errors
5. Access `authorisationInfo.description` for alerts → No errors

**Success Criteria**:

- All comparison results generated correctly
- No runtime errors accessing nested fields
- Alert context includes authorization metadata

---

### Test 4: Conversion Function Correctness

**Requirement**: FR-005 (conversion utilities create and preserve nested structure)

**Contract**: Functions produce valid output for all valid inputs

**Test Cases**:

1. `scriptInfoToInventoryScriptInfo()` creates nested structure
2. `rawInventoryScriptInfoToInventoryScriptInfo()` parses nested JSON
3. `inventoryScriptInfoToRawInventoryScriptInfo()` serializes nested structure
4. Header conversion functions (equivalent tests)
5. Date conversion (ISO string ↔ Date)

**Success Criteria**:

- Output structure matches expected type
- No data loss during conversion
- Edge cases handled (e.g., special characters in description)

---

## Backward Compatibility

### Breaking Changes Summary

**Type-Level Changes** (compile-time impact):

- `InventoryScriptInfo.authoriseWith` type changed
- `InventoryHeaderInfo.authoriseWith` type changed
- `InventoryScriptInfo.authorisationInfo` field removed (moved to nested location)
- `InventoryHeaderInfo.authorisationInfo` field removed (moved to nested location)

**Runtime-Level Changes** (runtime impact):

- JSON structure changed (requires manual inventory migration)
- Access patterns changed (requires code updates in services)

**No Backward Compatibility**:

- Old JSON format will fail Zod validation
- Old access patterns will fail TypeScript compilation
- Manual migration required before deployment

### Migration Checklist

- [ ] Update all inventory JSON files to new format
- [ ] Update all service code accessing `authorisationInfo`
- [ ] Update all service code accessing `authoriseWith` matcher
- [ ] Run full test suite to verify changes
- [ ] Validate all inventory files with `npm run validate-inventory`
- [ ] Commit migrated inventories to Git
- [ ] Deploy code changes

---

## Contract Versioning

**Version**: 1.0.0 (Initial version with nested authorization)

**Change History**:

- 2025-10-21: Initial contract definition for nested authorization schema

**Future Compatibility**:

- Adding optional fields to `AuthorizeWithConfig`: Minor version bump
- Changing required fields or structure: Major version bump
- Changing validation rules: Minor version bump (if loosening), Major (if tightening)
