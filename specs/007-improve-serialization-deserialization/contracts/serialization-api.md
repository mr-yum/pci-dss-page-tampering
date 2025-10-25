# Serialization API Contracts

**Feature**: 007-improve-serialization-deserialization
**Date**: 2025-10-24

## Overview

This document defines the function contracts for serialization/deserialization utilities. These are internal APIs used by `InventoryService` when persisting inventories to Git.

## Function Contracts

### matcherToConfig()

**Location**:

- `src/utils/script.ts` (internal helper)
- `src/utils/inventory.ts` (internal helper)

**Purpose**: Convert a Matcher instance to JSON-serializable configuration.

**Signature**:

```typescript
function matcherToConfig(matcher: Matcher): RawMatcherConfig
```

**Preconditions**:

- `matcher` is a valid Matcher implementation (NameMatcher, HeaderNameMatcher, ContentMatcher, HashMatcher, OrMatcher, AndMatcher)
- `matcher.getType()` returns one of: `'name'`, `'header-name'`, `'content'`, `'hash'`, `'or'`, `'and'`
- `matcher.getPattern()` returns data matching the matcher type

**Postconditions**:

- Returns a valid `RawMatcherConfig` discriminated union variant
- For composite matchers (`'or'`, `'and'`):
  - Recursively serializes all child matchers
  - Includes `authorisationInfo` if present (converted to ISO date strings)
- For leaf matchers:
  - Returns simple config object with pattern/hashes
- Throws error if `matcher.getType()` is unrecognized

**Error Cases**:

- **Unknown Matcher Type**: `Error('Unknown matcher type during serialization: ${type}')`
- **Invalid Pattern Type**: TypeError if pattern doesn't match expected type for matcher variant

**Example Usage**:

```typescript
// Leaf matcher
const nameMatcher = new NameMatcher('^https://example\\.com/.*$')
const config = matcherToConfig(nameMatcher)
// Returns: { nameMatcher: '^https://example\\.com/.*$' }

// Composite matcher
const orMatcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')], {
  description: 'Accept either pattern',
  authorised: true,
  date: new Date('2025-10-24T12:00:00.000Z'),
})
const config = matcherToConfig(orMatcher)
// Returns: {
//   orMatcher: [
//     { contentMatcher: 'pattern1' },
//     { contentMatcher: 'pattern2' }
//   ],
//   authorisationInfo: {
//     description: 'Accept either pattern',
//     authorised: true,
//     date: '2025-10-24T12:00:00.000Z'
//   }
// }
```

**Performance**:

- **Leaf matchers**: O(1) - constant time
- **Composite matchers**: O(n) where n = total number of matchers in tree (BFS traversal)
- **Constraint**: Must complete in <100ms for trees with 100 nodes

**Side Effects**: None (pure function)

---

### serializeAuthorisationInfo()

**Location**:

- `src/utils/script.ts` (new helper)
- `src/utils/inventory.ts` (new helper)

**Purpose**: Convert authorization metadata to JSON-serializable format with ISO date strings.

**Signature**:

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): InventoryAuthorisationInfoRaw
```

**Preconditions**:

- `info.description` is non-empty string
- `info.authorised` is boolean
- `info.date` is valid Date instance

**Postconditions**:

- Returns object with identical structure except `date` converted to ISO 8601 string
- ISO string includes millisecond precision (e.g., `"2025-10-24T12:00:00.789Z"`)

**Error Cases**:

- **Invalid Date**: `RangeError` if `info.date` is invalid Date (e.g., `new Date('invalid')`)

**Example Usage**:

```typescript
const info: InventoryAuthorisationInfo = {
  description: 'Analytics script for conversion tracking',
  authorised: true,
  date: new Date('2025-10-24T12:00:00.789Z'),
}

const serialized = serializeAuthorisationInfo(info)
// Returns: {
//   description: 'Analytics script for conversion tracking',
//   authorised: true,
//   date: '2025-10-24T12:00:00.789Z'
// }
```

**Performance**: O(1) - constant time

**Side Effects**: None (pure function)

---

### inventoryScriptInfoToRawInventoryScriptInfo()

**Location**: `src/utils/script.ts` (existing function, modified)

**Purpose**: Convert an InventoryScriptInfo (with Matcher instances) to RawInventoryScriptInfo (JSON-serializable).

**Signature**:

```typescript
function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo
```

**Preconditions**:

- `inventoryScriptInfo.identifyWith` is valid Matcher instance
- `inventoryScriptInfo.authoriseWith.matcher` is valid Matcher instance
- `inventoryScriptInfo.authoriseWith.authorisationInfo` has valid date

**Postconditions**:

- Returns RawInventoryScriptInfo with:
  - `identifyWith`: Matcher converted to RawMatcherConfig
  - `authoriseWith`: Object combining matcher config and authorization metadata (as siblings)
- Date in `authorisationInfo` converted to ISO string
- Structure matches Zod schema expectations

**Error Cases**:

- Propagates errors from `matcherToConfig()` if unknown matcher types encountered

**Example Usage**:

```typescript
const inventoryScriptInfo: InventoryScriptInfo = {
  identifyWith: new NameMatcher('^https://example\\.com/analytics\\.js$'),
  authoriseWith: {
    matcher: new OrMatcher([new HashMatcher([{ timestamp: new Date('2025-10-01'), hash: { value: 'abc123...' } }]), new HashMatcher([{ timestamp: new Date('2025-10-15'), hash: { value: 'def456...' } }])], {
      description: 'Accept version 1.0.0 or 1.1.0',
      authorised: true,
      date: new Date('2025-10-24T12:00:00.000Z'),
    }),
    authorisationInfo: {
      description: 'Analytics script',
      authorised: true,
      date: new Date('2025-10-24T12:00:00.000Z'),
    },
  },
}

const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo)
// Returns: {
//   identifyWith: { nameMatcher: '^https://example\\.com/analytics\\.js$' },
//   authoriseWith: {
//     orMatcher: [
//       { hashes: [{ timestamp: '2025-10-01T00:00:00.000Z', hash: { value: 'abc123...' } }] },
//       { hashes: [{ timestamp: '2025-10-15T00:00:00.000Z', hash: { value: 'def456...' } }] }
//     ],
//     authorisationInfo: {
//       description: 'Analytics script',
//       authorised: true,
//       date: '2025-10-24T12:00:00.000Z'
//     }
//   }
// }
```

**Performance**: Depends on `matcherToConfig()` - O(n) where n = total matchers in tree

**Side Effects**: None (pure function)

**Modifications in This Feature**:

- Extend `matcherToConfig()` helper to handle `'or'` and `'and'` matcher types
- No changes to function signature or high-level behavior

---

### inventoryHeaderInfoToRawInventoryHeaderInfo()

**Location**: `src/utils/inventory.ts` (existing function, modified)

**Purpose**: Convert an InventoryHeaderInfo (with Matcher instances) to RawInventoryHeaderInfo (JSON-serializable).

**Signature**:

```typescript
function inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo: InventoryHeaderInfo): RawInventoryHeaderInfo
```

**Preconditions**: Same as `inventoryScriptInfoToRawInventoryScriptInfo()` but for headers

**Postconditions**: Same as `inventoryScriptInfoToRawInventoryScriptInfo()` but for headers

**Example Usage**:

```typescript
const headerInfo: InventoryHeaderInfo = {
  identifyWith: new HeaderNameMatcher('^content-security-policy$'),
  authoriseWith: {
    matcher: new AndMatcher([
      new ContentMatcher('default-src\\s+https:'),
      new ContentMatcher('script-src\\s+https:'),
      new ContentMatcher('object-src\\s+\\'none\\'')
    ], {
      description: 'CSP requiring all three directives',
      authorised: true,
      date: new Date('2025-10-24T12:00:00.000Z')
    }),
    authorisationInfo: {
      description: 'Security header policy',
      authorised: true,
      date: new Date('2025-10-24T12:00:00.000Z')
    }
  }
}

const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(headerInfo)
// Returns: {
//   identifyWith: { headerNameMatcher: '^content-security-policy$' },
//   authoriseWith: {
//     andMatcher: [
//       { contentMatcher: 'default-src\\s+https:' },
//       { contentMatcher: 'script-src\\s+https:' },
//       { contentMatcher: 'object-src\\s+\\'none\\'' }
//     ],
//     authorisationInfo: {
//       description: 'Security header policy',
//       authorised: true,
//       date: '2025-10-24T12:00:00.000Z'
//     }
//   }
// }
```

**Performance**: Same as `inventoryScriptInfoToRawInventoryScriptInfo()`

**Side Effects**: None (pure function)

**Modifications in This Feature**: Same as `inventoryScriptInfoToRawInventoryScriptInfo()`

---

### Matcher.getAuthorisationInfo() (NEW)

**Location**:

- `src/types/matcher/or-matcher.ts` (new public method)
- `src/types/matcher/and-matcher.ts` (new public method)

**Purpose**: Expose authorization metadata for serialization without breaking encapsulation.

**Signature**:

```typescript
class OrMatcher<T extends Matchable> implements Matcher<T> {
  getAuthorisationInfo(): InventoryAuthorisationInfo | undefined
}

class AndMatcher<T extends Matchable> implements Matcher<T> {
  getAuthorisationInfo(): InventoryAuthorisationInfo | undefined
}
```

**Preconditions**: None

**Postconditions**:

- Returns the authorization metadata passed to constructor, or `undefined` if not provided
- Does not modify internal state (read-only accessor)

**Error Cases**: None (always succeeds)

**Example Usage**:

```typescript
const matcher = new OrMatcher([new ContentMatcher('pattern1')], {
  description: 'Test matcher',
  authorised: true,
  date: new Date('2025-10-24T12:00:00.000Z'),
})

const info = matcher.getAuthorisationInfo()
// Returns: {
//   description: 'Test matcher',
//   authorised: true,
//   date: Date('2025-10-24T12:00:00.000Z')
// }

const matcherNoInfo = new OrMatcher([new ContentMatcher('pattern1')])
const noInfo = matcherNoInfo.getAuthorisationInfo()
// Returns: undefined
```

**Performance**: O(1) - constant time

**Side Effects**: None (read-only accessor)

**Rationale**: Serialization utilities need access to private `authorisationInfo` field. Public accessor maintains encapsulation while enabling serialization.

---

## Integration Points

### InventoryService.updateInventory()

**Contract**: InventoryService calls serialization functions when pushing inventory updates to Git.

**Flow**:

1. Service receives typed comparison results (ComparisonResultType[])
2. Service updates in-memory Inventory (Matcher instances)
3. Service calls `inventoryToRawInventory(inventory)`
4. `inventoryToRawInventory` calls serialization functions for scripts and headers
5. Result is JSON.stringify'd and committed to Git

**Error Handling**:

- If serialization throws (unknown matcher type), service logs error and aborts commit
- Inventory repository state remains unchanged (atomic commit)
- Alert sent to operations team about serialization failure

### Zod Schema Validation

**Contract**: Zod schema validates deserialized JSON before conversion to Matcher instances.

**Flow**:

1. Git repository pulls JSON inventory
2. Zod schema validates structure via `InventorySchema.parse(json)`
3. If validation fails, throws error with detailed message
4. If validation passes, deserialization functions convert to Matcher instances

**Error Handling**:

- Validation errors include field path and expected format
- Inventory load fails fast on invalid JSON
- No partial inventories created (all-or-nothing)

## Testing Requirements

### Unit Tests

**Location**: `test/unit/utils/script.test.ts`, `test/unit/utils/inventory.test.ts`

**Required Test Cases**:

1. Serialize OrMatcher with leaf children → verify JSON structure
2. Serialize AndMatcher with leaf children → verify JSON structure
3. Serialize nested composites (OrMatcher containing AndMatcher) → verify recursion
4. Serialize composite with authorisationInfo → verify metadata preserved
5. Serialize composite without authorisationInfo → verify field omitted
6. Round-trip OrMatcher → verify behavioral equivalence
7. Round-trip AndMatcher → verify behavioral equivalence
8. Round-trip nested composites → verify structure preserved
9. Date precision preservation → verify milliseconds survive round-trip
10. Error case: unknown matcher type → verify descriptive error thrown

### Integration Tests

**Location**: `test/integration/inventory-service.test.ts`

**Required Test Cases**:

1. Full inventory workflow with composite matchers → verify Git commit
2. Load inventory with composite matchers → verify deserialization
3. Round-trip full inventory → verify all entries preserved
4. Performance test: serialize inventory with 100 scripts → verify <100ms

## Performance Guarantees

| Operation                        | Input Size           | Max Time | Notes                       |
| -------------------------------- | -------------------- | -------- | --------------------------- |
| `matcherToConfig()` leaf matcher | 1 matcher            | <1ms     | Constant time               |
| `matcherToConfig()` composite    | 100 matchers         | <100ms   | Linear in tree size         |
| `serializeAuthorisationInfo()`   | 1 metadata           | <1ms     | Constant time               |
| Full inventory serialization     | 50 scripts, 4 levels | <50ms    | Typical production workload |
| Nested composite serialization   | 10 levels deep       | <10ms    | Spec requirement            |

## Backward Compatibility

### JSON Schema

**Guarantee**: All existing inventory JSON files remain valid.

**Rationale**: Feature only adds support for new `orMatcher` and `andMatcher` fields. Existing leaf matcher fields unchanged.

**Migration**: None required. Existing inventories work unchanged. New inventories can mix leaf and composite matchers.

### API Compatibility

**Guarantee**: All existing function signatures unchanged.

**Changes**:

- `matcherToConfig()` - internal helper, extended with new cases
- `inventoryScriptInfoToRawInventoryScriptInfo()` - no signature change, behavior extended
- `inventoryHeaderInfoToRawInventoryHeaderInfo()` - no signature change, behavior extended
- `OrMatcher.getAuthorisationInfo()` - new method, additive change only

**No Breaking Changes**: All existing code continues to work. Only new functionality added.
