# Data Model: Improve Serialization/Deserialization for Composite Matchers

**Feature**: 007-improve-serialization-deserialization
**Date**: 2025-10-24

## Overview

This document defines the data structures involved in serializing and deserializing composite matchers. The feature extends existing serialization utilities without introducing new entity types - all entities already exist in the codebase.

## Entity Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Inventory (In-Memory)                      │
├─────────────────────────────────────────────────────────────────┤
│ - scripts: InventoryScriptInfo[]                                │
│ - headers: InventoryHeaderInfo[]                                │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ inventoryToRawInventory()
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RawInventory (JSON-Serializable)              │
├─────────────────────────────────────────────────────────────────┤
│ - scripts: RawInventoryScriptInfo[]                             │
│ - headers: RawInventoryHeaderInfo[]                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              InventoryScriptInfo (In-Memory Entity)             │
├─────────────────────────────────────────────────────────────────┤
│ - identifyWith: Matcher                                         │
│ - authoriseWith: AuthorizeWithConfig                            │
│   - matcher: Matcher                                            │
│   - authorisationInfo: InventoryAuthorisationInfo               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ inventoryScriptInfoToRawInventoryScriptInfo()
                               │ (MODIFIED FOR THIS FEATURE)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│        RawInventoryScriptInfo (JSON-Serializable Entity)        │
├─────────────────────────────────────────────────────────────────┤
│ - identifyWith: RawMatcherConfig                                │
│ - authoriseWith: RawAuthorizeWithConfig                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  Matcher (Interface - In-Memory)                │
├─────────────────────────────────────────────────────────────────┤
│ + getType(): string                                             │
│ + getPattern(): string | InventoryScriptHashInfo[] | Matcher[]  │
│ + identify(resource: Matchable): boolean                        │
│ + authorize(resource: Matchable): AuthorizationResult           │
├─────────────────────────────────────────────────────────────────┤
│ Implementations:                                                │
│ - NameMatcher (getType='name', getPattern=string)               │
│ - HeaderNameMatcher (getType='header-name', getPattern=string)  │
│ - ContentMatcher (getType='content', getPattern=string)         │
│ - HashMatcher (getType='hash', getPattern=InventoryScriptHash[])│
│ - OrMatcher (getType='or', getPattern=Matcher[])         ◄──NEW │
│ - AndMatcher (getType='and', getPattern=Matcher[])       ◄──NEW │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ matcherToConfig() helper
                               │ (MODIFIED FOR THIS FEATURE)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│           RawMatcherConfig (Discriminated Union - JSON)         │
├─────────────────────────────────────────────────────────────────┤
│ Variants:                                                       │
│ - { nameMatcher: string }                                       │
│ - { headerNameMatcher: string }                                 │
│ - { contentMatcher: string }                                    │
│ - { hashes: InventoryScriptHashInfo[] }                         │
│ - { orMatcher: RawMatcherConfig[],                       ◄──NEW │
│     authorisationInfo?: InventoryAuthorisationInfoRaw }         │
│ - { andMatcher: RawMatcherConfig[],                      ◄──NEW │
│     authorisationInfo?: InventoryAuthorisationInfoRaw }         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│     InventoryAuthorisationInfo (In-Memory Authorization)        │
├─────────────────────────────────────────────────────────────────┤
│ - description: string                                           │
│ - authorised: boolean                                           │
│ - date: Date                                                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ date.toISOString()
                               │ (MODIFIED FOR THIS FEATURE)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  InventoryAuthorisationInfoRaw (JSON-Serializable Metadata)     │
├─────────────────────────────────────────────────────────────────┤
│ - description: string                                           │
│ - authorised: boolean                                           │
│ - date: string (ISO 8601 format)                                │
└─────────────────────────────────────────────────────────────────┘
```

## Core Entities

### 1. RawMatcherConfig (Discriminated Union)

**Location**: [src/types/inventory/matcher-config-schema.ts](../../../src/types/inventory/matcher-config-schema.ts)

**Purpose**: JSON-serializable configuration representing a matcher. Used for persisting inventories to Git.

**Type Definition**:

```typescript
type RawMatcherConfig =
  | { nameMatcher: string }
  | { headerNameMatcher: string }
  | { contentMatcher: string }
  | { hashes: InventoryScriptHashInfo[] }
  | { orMatcher: RawMatcherConfig[]; authorisationInfo?: InventoryAuthorisationInfoRaw } // NEW
  | { andMatcher: RawMatcherConfig[]; authorisationInfo?: InventoryAuthorisationInfoRaw } // NEW
```

**Relationships**:

- **Serialized from**: `Matcher` interface implementations via `matcherToConfig()` helper
- **Deserialized to**: `Matcher` instances via `createMatcher()` factory
- **Validated by**: `MatcherConfigSchema` Zod schema with `z.lazy()` for recursion

**Modified in This Feature**: Add support for `orMatcher` and `andMatcher` variants in serialization direction

### 2. Matcher (Interface)

**Location**: [src/types/matcher/matcher.interface.ts](../../../src/types/matcher/matcher.interface.ts)

**Purpose**: Strategy pattern interface for script/header identification and authorization logic.

**Interface Definition**:

```typescript
interface Matcher<T extends Matchable = Matchable> {
  getType(): string
  getPattern(): string | InventoryScriptHashInfo[] | Matcher[]
  getDescription(): string
  identify(resource: T): boolean
  authorize(resource: T): AuthorizationResult
}
```

**Implementations**:

- **NameMatcher**: `getType()='name'`, `getPattern()=string` (regex pattern)
- **HeaderNameMatcher**: `getType()='header-name'`, `getPattern()=string` (regex pattern)
- **ContentMatcher**: `getType()='content'`, `getPattern()=string` (regex pattern)
- **HashMatcher**: `getType()='hash'`, `getPattern()=InventoryScriptHashInfo[]` (hash array)
- **OrMatcher**: `getType()='or'`, `getPattern()=Matcher[]` (child matchers)
- **AndMatcher**: `getType()='and'`, `getPattern()=Matcher[]` (child matchers)

**Key Methods for Serialization**:

- `getType()`: Returns discriminator for selecting serialization strategy
- `getPattern()`: Returns data to serialize (string, hashes, or child matchers)

**Modified in This Feature**: No changes to interface or implementations. Feature uses existing reflection methods.

### 3. OrMatcher / AndMatcher (Composite Matchers)

**Location**:

- [src/types/matcher/or-matcher.ts](../../../src/types/matcher/or-matcher.ts)
- [src/types/matcher/and-matcher.ts](../../../src/types/matcher/and-matcher.ts)

**Purpose**: Composite matchers implementing OR/AND logic for authorization.

**Constructor**:

```typescript
constructor(
  children: Matcher<T>[],
  authorisationInfo?: InventoryAuthorisationInfo
)
```

**Key Properties**:

- `children: Matcher[]` - Child matchers (min 1, no max)
- `authorisationInfo?: InventoryAuthorisationInfo` - Top-level metadata

**Serialization Requirements**:

1. Extract `children` via `getPattern()` → returns `Matcher[]`
2. Recursively serialize each child via `matcherToConfig(child)`
3. Extract `authorisationInfo` (private field) → **NEW: requires accessor method**
4. Convert `authorisationInfo.date` to ISO string

**Modified in This Feature**:

- **ADD** public accessor for `authorisationInfo` (e.g., `getAuthorisationInfo(): InventoryAuthorisationInfo | undefined`)
- **Rationale**: Serialization needs access to metadata. Private field cannot be accessed by utility functions.

### 4. InventoryAuthorisationInfo (Authorization Metadata)

**Location**: [src/types/inventory/model.ts](../../../src/types/inventory/model.ts)

**Purpose**: Authorization metadata for matchers (description, authorization status, date).

**Type Definition**:

```typescript
interface InventoryAuthorisationInfo {
  description: string
  authorised: boolean
  date: Date
}
```

**Serialization**: Convert to `InventoryAuthorisationInfoRaw` using:

```typescript
{
  description: info.description,
  authorised: info.authorised,
  date: info.date.toISOString()
}
```

**Deserialization**: Zod schema coerces ISO string back to `Date` via `z.coerce.date()`

**Modified in This Feature**: Add serialization helper function `serializeAuthorisationInfo()`

### 5. RawInventoryScriptInfo (JSON-Serializable Inventory Entry)

**Location**: [src/types/inventory/raw.ts](../../../src/types/inventory/raw.ts)

**Purpose**: JSON-serializable representation of an inventory script entry.

**Type Definition**:

```typescript
interface RawInventoryScriptInfo {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig
}

interface RawAuthorizeWithConfig extends RawMatcherConfig {
  authorisationInfo: InventoryAuthorisationInfoRaw
}
```

**Example with Composite Matcher**:

```json
{
  "identifyWith": {
    "nameMatcher": "^https://example\\.com/analytics\\.js$"
  },
  "authoriseWith": {
    "orMatcher": [
      {
        "hashes": [
          {
            "timestamp": "2025-10-01T00:00:00.000Z",
            "hash": { "value": "abc123..." }
          }
        ]
      },
      {
        "hashes": [
          {
            "timestamp": "2025-10-15T00:00:00.000Z",
            "hash": { "value": "def456..." }
          }
        ]
      }
    ],
    "authorisationInfo": {
      "description": "Accept version 1.0.0 or 1.1.0",
      "authorised": true,
      "date": "2025-10-24T12:00:00.000Z"
    }
  }
}
```

**Modified in This Feature**:

- `inventoryScriptInfoToRawInventoryScriptInfo()` must handle composite matchers in `authoriseWith.matcher`
- Same pattern applies to `RawInventoryHeaderInfo` via `inventoryHeaderInfoToRawInventoryHeaderInfo()`

## State Transitions

### Serialization Flow (Inventory → Git)

```
1. InventoryService.updateInventory() calls inventoryToRawInventory()
2. inventoryToRawInventory() calls inventoryScriptInfoToRawInventoryScriptInfo() for each script
3. inventoryScriptInfoToRawInventoryScriptInfo() calls matcherToConfig() for identifyWith and authoriseWith.matcher
4. matcherToConfig() inspects matcher.getType():
   - 'or' → extract children via getPattern(), recursively call matcherToConfig() on each
   - 'and' → extract children via getPattern(), recursively call matcherToConfig() on each
   - leaf types → extract pattern directly
5. matcherToConfig() extracts authorisationInfo via getAuthorisationInfo() (NEW accessor)
6. matcherToConfig() serializes dates to ISO strings via date.toISOString()
7. Returns RawMatcherConfig with orMatcher/andMatcher array and authorisationInfo
8. JSON.stringify() converts to string for Git commit
```

### Deserialization Flow (Git → Inventory)

```
1. Inventory repository pulls JSON from Git
2. Zod schema validates JSON structure (MatcherConfigSchema with z.lazy() recursion)
3. rawInventoryScriptInfoToInventoryScriptInfo() calls createMatcher() for identifyWith and authoriseWith configs
4. createMatcher() inspects config discriminator:
   - 'orMatcher' → recursively call createMatcher() on children, construct OrMatcher
   - 'andMatcher' → recursively call createMatcher() on children, construct AndMatcher
   - leaf types → construct leaf matcher
5. Zod coerces ISO date strings to Date instances via z.coerce.date()
6. Returns Matcher instances ready for comparison logic
```

## Validation Rules

### Schema Validation (Zod)

**Location**: [src/types/inventory/matcher-config-schema.ts](../../../src/types/inventory/matcher-config-schema.ts)

**Rules**:

1. **Discriminated Union**: Exactly one variant field must be present (`nameMatcher` XOR `contentMatcher` XOR `hashes` XOR `orMatcher` XOR `andMatcher`)
2. **Regex Syntax**: Regex patterns must compile without errors (validated via `new RegExp()`)
3. **Non-Empty Arrays**:
   - `hashes` must contain ≥1 element
   - `orMatcher` must contain ≥1 child
   - `andMatcher` must contain ≥1 child
4. **Recursive Validation**: Composite matcher children validated recursively via `z.lazy()`
5. **Date Format**: `authorisationInfo.date` must be valid ISO 8601 string
6. **Non-Empty Strings**: All string fields must have length ≥1

### Runtime Validation (Serialization)

**Rules**:

1. **Unknown Matcher Types**: Throw error if `getType()` returns unrecognized value
2. **Null/Undefined Children**: Composite matchers with empty `children` rejected at construction (fail-secure)
3. **Date Serialization**: All `Date` instances converted to ISO strings (no null dates allowed)

## API Changes

### New Public Method: Matcher.getAuthorisationInfo()

**Location**: Add to `OrMatcher` and `AndMatcher` classes

**Signature**:

```typescript
class OrMatcher<T extends Matchable> implements Matcher<T> {
  // ... existing methods ...

  /**
   * Returns authorization metadata for serialization.
   * @returns Authorization info if present, undefined otherwise
   */
  getAuthorisationInfo(): InventoryAuthorisationInfo | undefined {
    return this.authorisationInfo
  }
}
```

**Rationale**:

- Serialization utilities need access to private `authorisationInfo` field
- Public accessor maintains encapsulation (read-only access)
- Alternative (making field public) violates encapsulation principle

### Modified Helper: matcherToConfig()

**Location**:

- [src/utils/script.ts](../../../src/utils/script.ts) (line 76-92)
- [src/utils/inventory.ts](../../../src/utils/inventory.ts) (line 66-84)

**Before (Leaf Matchers Only)**:

```typescript
function matcherToConfig(matcher: Matcher): RawMatcherConfig {
  const matcherType = matcher.getType()
  const pattern = matcher.getPattern()

  switch (matcherType) {
    case 'name':
      return { nameMatcher: pattern as string }
    case 'content':
      return { contentMatcher: pattern as string }
    case 'hash':
      return { hashes: pattern as InventoryScriptHashInfo[] }
    default:
      throw new Error(`Unknown matcher type: ${matcherType}`)
  }
}
```

**After (With Composite Matchers)**:

```typescript
function matcherToConfig(matcher: Matcher): RawMatcherConfig {
  const matcherType = matcher.getType()
  const pattern = matcher.getPattern()

  switch (matcherType) {
    case 'name':
      return { nameMatcher: pattern as string }
    case 'header-name':
      return { headerNameMatcher: pattern as string }
    case 'content':
      return { contentMatcher: pattern as string }
    case 'hash':
      return { hashes: pattern as InventoryScriptHashInfo[] }

    case 'or': {
      const children = pattern as Matcher[]
      const config: RawMatcherConfig = {
        orMatcher: children.map(matcherToConfig), // Recursive
      }
      const authInfo = matcher.getAuthorisationInfo() // NEW accessor
      if (authInfo) {
        config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      }
      return config
    }

    case 'and': {
      const children = pattern as Matcher[]
      const config: RawMatcherConfig = {
        andMatcher: children.map(matcherToConfig), // Recursive
      }
      const authInfo = matcher.getAuthorisationInfo() // NEW accessor
      if (authInfo) {
        config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      }
      return config
    }

    default:
      throw new Error(`Unknown matcher type during serialization: ${matcherType}`)
  }
}
```

### New Helper: serializeAuthorisationInfo()

**Location**:

- [src/utils/script.ts](../../../src/utils/script.ts) (new)
- [src/utils/inventory.ts](../../../src/utils/inventory.ts) (new)

**Signature**:

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): InventoryAuthorisationInfoRaw {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString(),
  }
}
```

**Purpose**: Convert in-memory authorization metadata to JSON-serializable format with ISO date strings.

## Edge Cases

### 1. Empty Composite Matcher Children

**Scenario**: OrMatcher or AndMatcher constructed with empty array

**Handling**:

- **Prevention**: Constructor throws error (fail-secure) - [or-matcher.ts:55-63](../../../src/types/matcher/or-matcher.ts#L55-L63)
- **Serialization**: Should never encounter (constructor prevents). If somehow reached, serialization produces empty array.
- **Deserialization**: Zod schema rejects empty arrays - `.min(1, 'orMatcher must contain at least 1 child')`

**Test Coverage**: Unit tests verify constructor rejection and Zod validation

### 2. Null/Undefined Authorization Info

**Scenario**: Composite matcher with `authorisationInfo=undefined`

**Handling**:

- **Serialization**: Skip `authorisationInfo` field in output JSON (conditional spread)
- **Deserialization**: Zod schema marks field as optional - `authorisationInfo: InventoryAuthorisationInfoRawSchema.optional()`
- **Behavior**: Matcher relies only on child authorization results (no override)

**Example Output**:

```json
{
  "orMatcher": [{ "contentMatcher": "pattern1" }, { "contentMatcher": "pattern2" }]
}
```

### 3. Deeply Nested Composites (10+ Levels)

**Scenario**: OrMatcher containing AndMatcher containing OrMatcher... (10 levels deep)

**Handling**:

- **Serialization**: Recursive `matcherToConfig()` calls up to 10 levels
- **Performance**: Spec requires completion in <100ms for 100 children
- **Stack Overflow**: Natural JavaScript limit (~10,000 levels) acts as fail-safe
- **Validation**: Zod schema validates all levels via `z.lazy()` recursion

**Test Coverage**: Integration tests verify 10-level nesting

### 4. Mixed Composite Children

**Scenario**: OrMatcher with mix of leaf matchers and composite matchers

**Example**:

```typescript
new OrMatcher([new ContentMatcher('pattern1'), new AndMatcher([new ContentMatcher('pattern2'), new ContentMatcher('pattern3')])])
```

**Handling**:

- **Serialization**: Each child serialized according to its type (recursive for composites, direct for leaves)
- **Deserialization**: Each child deserialized via `createMatcher()` (recursive for composites)
- **Validation**: Zod schema validates each child independently

**Output**:

```json
{
  "orMatcher": [
    { "contentMatcher": "pattern1" },
    {
      "andMatcher": [{ "contentMatcher": "pattern2" }, { "contentMatcher": "pattern3" }]
    }
  ]
}
```

### 5. Date Precision Preservation

**Scenario**: Authorization metadata with millisecond-precision timestamps

**Example**: `new Date('2025-10-24T12:34:56.789Z')`

**Handling**:

- **Serialization**: `date.toISOString()` preserves milliseconds → `"2025-10-24T12:34:56.789Z"`
- **JSON**: ISO string survives `JSON.stringify()` → `JSON.parse()` round-trip
- **Deserialization**: Zod `z.coerce.date()` parses ISO string back to `Date` with milliseconds
- **Verification**: Round-trip tests assert `original.date.getTime() === deserialized.date.getTime()`

**Test Coverage**: Round-trip tests verify millisecond precision

## Summary

This feature modifies two existing helper functions and adds one accessor method:

**Modified Functions**:

1. `matcherToConfig()` in `src/utils/script.ts` and `src/utils/inventory.ts` - add composite matcher cases
2. Add `getAuthorisationInfo()` accessor to `OrMatcher` and `AndMatcher` classes

**New Functions**:

1. `serializeAuthorisationInfo()` helper for date serialization

**No New Entities**: All data structures already exist. Feature completes bidirectional serialization support for existing composite matcher types.
