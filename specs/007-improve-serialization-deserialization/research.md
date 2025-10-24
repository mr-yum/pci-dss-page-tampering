# Research: Improve Serialization/Deserialization for Composite Matchers

**Feature**: 007-improve-serialization-deserialization
**Date**: 2025-10-24
**Status**: Complete

## Overview

This research document captures design decisions for extending serialization support to composite matchers (OrMatcher, AndMatcher). The system currently supports deserialization via `createMatcher` factory but lacks the reverse direction (serialization back to JSON), preventing inventory updates from being persisted to Git.

## R1: Serialization Pattern for Composite Matchers

### Decision

Extend the existing `matcherToConfig` helper functions in `src/utils/script.ts:76-92` and `src/utils/inventory.ts:66-84` to handle composite matcher types using recursive serialization.

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
    case 'or':
      // NEW: Recursive serialization for OrMatcher
      const orChildren = pattern as Matcher[]
      return {
        orMatcher: orChildren.map(matcherToConfig),
        ...(matcher.authorisationInfo && { authorisationInfo: serializeAuthorisationInfo(matcher.authorisationInfo) })
      }
    case 'and':
      // NEW: Recursive serialization for AndMatcher
      const andChildren = pattern as Matcher[]
      return {
        andMatcher: andChildren.map(matcherToConfig),
        ...(matcher.authorisationInfo && { authorisationInfo: serializeAuthorisationInfo(matcher.authorisationInfo) })
      }
    default:
      throw new Error(`Unknown matcher type: ${matcherType}`)
  }
}
```

### Rationale

- **Consistency**: Mirrors the existing recursive deserialization in `createMatcher` factory ([src/types/matcher/matcher-factory.ts:74-107](../../../src/types/matcher/matcher-factory.ts#L74-L107))
- **Simplicity**: Single recursive function handles arbitrary nesting depth without explicit stack management
- **Type Safety**: TypeScript's type narrowing ensures `pattern` is correctly cast based on `matcherType`
- **Fail-Secure**: Unknown matcher types throw errors immediately (cannot serialize unexpected types)

### Alternatives Considered

1. **Visitor Pattern**: Create separate serializer classes implementing a visitor interface
   - **Rejected**: Over-engineered for this use case. Only 6 matcher types, single serialization operation per type.
   - **Complexity**: Would require modifying Matcher interface to add `accept(visitor)` method, violating Open/Closed Principle for simple extension.

2. **JSON.stringify with Custom Replacer**: Use `JSON.stringify(matcher, customReplacer)`
   - **Rejected**: Cannot access matcher internals (private fields). Would require exposing internal state or adding `toJSON()` methods to every matcher.
   - **Separation of Concerns**: Serialization is a utility concern, not a matcher responsibility.

3. **Explicit Stack-Based Iteration**: Iterate composite matchers with explicit stack instead of recursion
   - **Rejected**: More complex code for no performance benefit at typical nesting depths (2-4 levels).
   - **Readability**: Recursive approach is more readable and maintainable.

## R2: Authorization Metadata Serialization

### Decision

Extract `authorisationInfo` from composite matchers and serialize dates to ISO string format:

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): { description: string; authorised: boolean; date: string } {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString()
  }
}
```

Place `authorisationInfo` as a sibling field to the matcher config (not nested inside):

```json
{
  "orMatcher": [
    { "contentMatcher": "pattern1" },
    { "contentMatcher": "pattern2" }
  ],
  "authorisationInfo": {
    "description": "Accept either pattern",
    "authorised": true,
    "date": "2025-10-24T12:00:00.000Z"
  }
}
```

### Rationale

- **Consistency**: Matches the existing pattern for leaf matchers in `inventoryScriptInfoToRawInventoryScriptInfo` ([src/utils/script.ts:99-107](../../../src/utils/script.ts#L99-L107))
- **Schema Compatibility**: Aligns with `RawAuthorizeWithConfig` type where matcher config and `authorisationInfo` are siblings
- **Round-Trip Preservation**: ISO string format preserves millisecond precision, survives JSON.stringify/parse cycle
- **Validation**: Zod schema validates date strings via `z.string().datetime()` before deserialization

### Alternatives Considered

1. **Nested `authorisationInfo` Inside Matcher Config**: Place metadata inside `orMatcher` or `andMatcher` object
   - **Rejected**: Inconsistent with existing leaf matcher serialization pattern where metadata is spread at top level
   - **Schema Violation**: `RawAuthorizeWithConfig` expects matcher config and `authorisationInfo` as siblings

2. **Unix Timestamp**: Serialize dates as numbers (milliseconds since epoch)
   - **Rejected**: ISO strings are human-readable (Git diffs show actual dates), standard in JSON APIs
   - **Zod Schema**: Existing schema uses `z.string().datetime()` for validation

3. **Omit `authorisationInfo` if Undefined**: Skip field entirely when not present
   - **Accepted**: This is already part of the design using spread operator with conditional inclusion
   - **JSON Efficiency**: Reduces payload size for matchers without top-level metadata

## R3: Handling Deeply Nested Composite Matchers

### Decision

Use recursive serialization without depth limits or stack overflow protection. Rely on natural JavaScript call stack limits (~10,000 levels) as fail-safe.

### Rationale

- **Practical Limits**: Constitution specifies support up to 10 nesting levels ([spec.md:72](../spec.md#L72)). Production use cases rarely exceed 2-4 levels.
- **Performance Testing**: Spec requires performance testing at 10 levels ([spec.md:72](../spec.md#L72)). Stack overflow at this depth would fail tests early.
- **Fail-Fast**: If somehow an inventory with 10,000 nesting levels exists (likely data corruption), stack overflow error is preferable to silent data loss.
- **Simplicity**: No complexity overhead for artificial depth limits that would never be hit in practice.

### Alternatives Considered

1. **Explicit Depth Limit (e.g., 50 levels)**: Throw error if nesting exceeds threshold
   - **Rejected**: Arbitrary threshold with no clear failure mode. What happens at 51 levels? How do we recover?
   - **False Constraint**: May block legitimate advanced use cases without evidence they cause problems.

2. **Iterative Serialization with Explicit Stack**: Replace recursion with loop + stack data structure
   - **Rejected**: Significantly more complex code (30+ lines vs 5 lines) for no practical benefit
   - **Readability**: Harder to understand and maintain
   - **Performance**: No performance advantage at typical depths (2-4 levels)

3. **Memoization/Caching**: Cache serialized representations to avoid redundant work
   - **Rejected**: Composite matchers are immutable (no cache invalidation complexity) but serialization only happens during inventory commits (infrequent)
   - **Premature Optimization**: No evidence of performance bottleneck. YAGNI principle applies.

## R4: Error Handling for Unknown Matcher Types

### Decision

Throw descriptive errors for unknown matcher types with matcher details:

```typescript
default:
  throw new Error(`Unknown matcher type during serialization: ${matcherType}. Matcher: ${JSON.stringify(matcher)}`)
```

### Rationale

- **Fail-Secure**: Cannot safely serialize unknown types (could lose data or produce invalid JSON)
- **Debugging Context**: Include matcher type and full matcher state in error message
- **Schema Validation**: Unknown types should never reach serialization (Zod validates on load). Error indicates schema/factory mismatch.
- **Consistency**: Matches existing error pattern in `createMatcher` factory ([src/types/matcher/matcher-factory.ts:106](../../../src/types/matcher/matcher-factory.ts#L106))

### Alternatives Considered

1. **Log Warning and Skip**: Log error but continue serialization, omitting the unknown matcher
   - **Rejected**: Silent data loss. Inventory would be incomplete, authorization policies would be corrupted.
   - **Security Risk**: Skipping matchers could accidentally allow unauthorized scripts (fail-unsafe).

2. **Return Placeholder Config**: Serialize unknown types as `{ contentMatcher: "UNKNOWN_TYPE" }`
   - **Rejected**: Invalid authorization logic. Placeholder would match different content than original matcher.
   - **Confusion**: Creates inventory entries that don't match their purpose.

3. **Schema Validation Before Serialization**: Re-validate matcher against schema before serializing
   - **Rejected**: Expensive (re-validation on every commit). Schema is already validated on load.
   - **Redundant**: If matcher passed Zod validation on load, it's valid. Error indicates code bug, not data issue.

## R5: Round-Trip Preservation Strategy

### Decision

Implement round-trip testing for all matcher types using property-based testing pattern:

```typescript
// Test pattern (example)
test('OrMatcher with ContentMatchers survives round-trip', () => {
  const original: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher([
        new ContentMatcher('pattern1'),
        new ContentMatcher('pattern2')
      ], {
        description: 'Accept either pattern',
        authorised: true,
        date: new Date('2025-10-24T12:00:00.000Z')
      }),
      authorisationInfo: { /* ... */ }
    }
  }

  const serialized = inventoryScriptInfoToRawInventoryScriptInfo(original)
  const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(serialized)

  // Verify structure
  expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
  expect(deserialized.authoriseWith.matcher.getPattern()).toHaveLength(2)

  // Verify behavior (identify + authorize produce same results)
  const testScript = { /* mock script */ }
  expect(deserialized.authoriseWith.matcher.identify(testScript))
    .toBe(original.authoriseWith.matcher.identify(testScript))
  expect(deserialized.authoriseWith.matcher.authorize(testScript))
    .toEqual(original.authoriseWith.matcher.authorize(testScript))
})
```

### Rationale

- **Behavioral Equivalence**: Tests verify that deserialized matchers behave identically, not just structurally similar
- **Comprehensive Coverage**: Tests cover all matcher types (leaf + composite) and nesting combinations
- **Date Precision**: Verify millisecond precision survives round-trip (ISO string conversion)
- **Metadata Preservation**: Verify authorization metadata at all nesting levels preserved

### Alternatives Considered

1. **Deep Equality Checks**: Use `expect(deserialized).toEqual(original)` for structural equality
   - **Rejected**: Matcher instances have internal state (compiled regexes) that won't match even if functionally equivalent
   - **False Failures**: Tests would fail on irrelevant internal differences

2. **Snapshot Testing**: Use Jest snapshots to capture serialized JSON
   - **Supplementary**: Use snapshots IN ADDITION to behavioral tests for regression detection
   - **Limitation**: Snapshots don't verify behavioral equivalence, only structural

3. **Manual Integration Tests**: Test round-trips in real inventory workflows
   - **Supplementary**: Integration tests verify end-to-end, but unit tests provide faster feedback
   - **Coverage**: Unit tests can exhaustively test edge cases (10 nesting levels, 100 children)

## R6: Performance Considerations

### Decision

No upfront performance optimizations. Implement straightforward recursive serialization and measure performance in tests.

### Rationale

- **YAGNI**: No evidence of performance problems. Typical inventories have 10-50 scripts with 2-4 nesting levels.
- **Spec Requirements**: Feature spec requires <100ms for 100 children ([spec.md:115](../spec.md#L115)). Straightforward recursion likely meets this.
- **Measure First**: Constitution principle VI (Minimal Complexity) - optimize only when measurements show problems.
- **Easy to Optimize Later**: If performance issues emerge, can add memoization or iterative approach without changing interface.

### Alternatives Considered

1. **Memoization**: Cache serialized representations to avoid redundant work
   - **Deferred**: Only implement if performance tests show serialization taking >100ms
   - **Complexity**: Adds cache invalidation logic, memory overhead

2. **Parallel Serialization**: Use `Promise.all()` to serialize children in parallel
   - **Rejected**: Serialization is synchronous (no I/O), CPU-bound. Promises add overhead without benefit.
   - **JavaScript Limitation**: Single-threaded, no true parallelism without Workers (massive complexity)

3. **Lazy Serialization**: Serialize only when inventory is committed, not on every update
   - **Already Implemented**: Serialization only happens in `InventoryService.updateInventory()` when pushing to Git
   - **No Change Needed**: Current design already defers serialization to commit time

## Summary

All design decisions follow existing patterns in the codebase:
- **R1**: Recursive serialization mirrors recursive deserialization in `createMatcher`
- **R2**: Authorization metadata serialization matches existing leaf matcher pattern
- **R3**: No artificial depth limits, rely on natural JavaScript limits
- **R4**: Fail-secure error handling for unknown types
- **R5**: Behavioral round-trip testing ensures no regression
- **R6**: No premature optimization, measure first

No new abstractions, dependencies, or patterns introduced. Feature extends existing serialization utilities following Constitution Principle VI (Minimal Complexity).
