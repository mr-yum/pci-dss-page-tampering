# Quickstart: Improve Serialization/Deserialization for Composite Matchers

**Feature**: 007-improve-serialization-deserialization
**Date**: 2025-10-24
**Audience**: Developers implementing the feature

## What You're Building

You're extending the serialization utilities in `src/utils/script.ts` and `src/utils/inventory.ts` to support composite matchers (OrMatcher, AndMatcher). Currently, the system can deserialize composite matchers from JSON (via `createMatcher` factory) but cannot serialize them back (preventing inventory updates from being persisted to Git).

**In 5 Minutes**: You'll understand the problem, the solution approach, and the key files to modify.

## The Problem

```typescript
// ✅ WORKS: Deserialization (JSON → Matcher instances)
const json = {
  orMatcher: [
    { contentMatcher: 'pattern1' },
    { contentMatcher: 'pattern2' }
  ],
  authorisationInfo: { description: '...', authorised: true, date: '2025-10-24...' }
}
const matcher = createMatcher(json)  // ✅ Creates OrMatcher with 2 ContentMatchers

// ❌ BROKEN: Serialization (Matcher instances → JSON)
const inventoryScript: InventoryScriptInfo = {
  identifyWith: new NameMatcher('...'),
  authoriseWith: {
    matcher: new OrMatcher([...]),  // Composite matcher
    authorisationInfo: { ... }
  }
}
const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)
// ❌ Throws: Unknown matcher type: or
```

**Why It's Broken**: The `matcherToConfig()` helper only handles leaf matchers (`name`, `content`, `hash`). When it encounters composite matchers (`or`, `and`), it throws an error.

## The Solution (High Level)

Extend `matcherToConfig()` to recursively serialize composite matchers:

```typescript
function matcherToConfig(matcher: Matcher): RawMatcherConfig {
  const matcherType = matcher.getType()
  const pattern = matcher.getPattern()

  switch (matcherType) {
    // Existing leaf cases...
    case 'name':
      return { nameMatcher: pattern as string }
    case 'content':
      return { contentMatcher: pattern as string }
    case 'hash':
      return { hashes: pattern as InventoryScriptHashInfo[] }

    // NEW: Composite matchers (recursive)
    case 'or': {
      const children = pattern as Matcher[]
      const config = {
        orMatcher: children.map(matcherToConfig), // Recursive call
      }
      const authInfo = matcher.getAuthorisationInfo() // NEW accessor method
      if (authInfo) {
        config.authorisationInfo = serializeAuthorisationInfo(authInfo)
      }
      return config
    }

    case 'and': {
      // Similar to 'or' case...
    }

    default:
      throw new Error(`Unknown matcher type: ${matcherType}`)
  }
}
```

## Key Concepts

### 1. Recursive Serialization

Composite matchers contain child matchers. Serialization must recurse:

```
OrMatcher([ContentMatcher('p1'), ContentMatcher('p2')])
  ↓ serialize
{ orMatcher: [
    matcherToConfig(ContentMatcher('p1')),  ← recursive call
    matcherToConfig(ContentMatcher('p2'))   ← recursive call
  ]
}
  ↓ results
{ orMatcher: [
    { contentMatcher: 'p1' },
    { contentMatcher: 'p2' }
  ]
}
```

Nesting can be arbitrarily deep (up to 10 levels per spec).

### 2. Authorization Metadata

Composite matchers can have top-level authorization metadata:

```typescript
new OrMatcher([child1, child2], {
  description: 'Accept either version',
  authorised: true,
  date: new Date('2025-10-24T12:00:00.000Z'),
})
```

This metadata must be serialized alongside the matcher config:

```json
{
  "orMatcher": [...],
  "authorisationInfo": {
    "description": "Accept either version",
    "authorised": true,
    "date": "2025-10-24T12:00:00.000Z"
  }
}
```

**Problem**: `authorisationInfo` is a private field. Serialization utilities cannot access it.

**Solution**: Add public accessor method `getAuthorisationInfo()` to `OrMatcher` and `AndMatcher`.

### 3. Date Serialization

Authorization metadata contains `Date` instances. JSON cannot serialize `Date` objects directly.

**Solution**: Convert to ISO 8601 strings:

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo) {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString(), // "2025-10-24T12:00:00.000Z"
  }
}
```

Zod schema handles deserialization via `z.coerce.date()`.

## Files to Modify

### 1. `src/types/matcher/or-matcher.ts` (NEW METHOD)

**Change**: Add public accessor for authorization metadata

**Location**: After `getDescription()` method (~line 87)

```typescript
/**
 * Returns authorization metadata for serialization.
 * @returns Authorization info if present, undefined otherwise
 */
getAuthorisationInfo(): InventoryAuthorisationInfo | undefined {
  return this.authorisationInfo
}
```

**Why**: Serialization utilities need access to private field. Accessor maintains encapsulation.

### 2. `src/types/matcher/and-matcher.ts` (NEW METHOD)

**Change**: Same as OrMatcher - add `getAuthorisationInfo()` accessor

**Location**: After `getDescription()` method

### 3. `src/utils/script.ts` (EXTEND HELPER)

**Change 1**: Add `serializeAuthorisationInfo()` helper

**Location**: Near top of file, after imports (~line 10)

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): { description: string; authorised: boolean; date: string } {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString(),
  }
}
```

**Change 2**: Extend `matcherToConfig()` helper

**Location**: Inside `inventoryScriptInfoToRawInventoryScriptInfo()` function (~line 76)

**Current code** (lines 81-92):

```typescript
switch (matcherType) {
  case 'name':
    return { nameMatcher: pattern as string }
  case 'content':
    return { contentMatcher: pattern as string }
  case 'hash':
    return { hashes: pattern as import('../types/inventory/model').InventoryScriptHashInfo[] }
  default:
    throw new Error(`Unknown matcher type: ${matcherType}`)
}
```

**Add before `default` case**:

```typescript
case 'or': {
  const children = pattern as import('../types/matcher/matcher.interface').Matcher[]
  const config: any = {
    orMatcher: children.map(matcherToConfig)
  }
  const authInfo = (matcher as any).getAuthorisationInfo?.()
  if (authInfo) {
    config.authorisationInfo = serializeAuthorisationInfo(authInfo)
  }
  return config
}

case 'and': {
  const children = pattern as import('../types/matcher/matcher.interface').Matcher[]
  const config: any = {
    andMatcher: children.map(matcherToConfig)
  }
  const authInfo = (matcher as any).getAuthorisationInfo?.()
  if (authInfo) {
    config.authorisationInfo = serializeAuthorisationInfo(authInfo)
  }
  return config
}
```

**Note**: Use `as any` casts temporarily to avoid type conflicts. Can be cleaned up after implementation.

### 4. `src/utils/inventory.ts` (EXTEND HELPER)

**Change**: Same as `src/utils/script.ts` - add `serializeAuthorisationInfo()` and extend `matcherToConfig()`

**Location**: Inside `inventoryHeaderInfoToRawInventoryHeaderInfo()` function (~line 67)

Apply identical changes as for script serialization.

## Development Workflow

### Step 1: Add Accessor Methods (5 minutes)

```bash
# Edit OrMatcher and AndMatcher classes
code src/types/matcher/or-matcher.ts
code src/types/matcher/and-matcher.ts

# Add getAuthorisationInfo() method to both
```

**Test**: Run unit tests for matchers

```bash
npm run test:unit -- or-matcher
npm run test:unit -- and-matcher
```

### Step 2: Add Serialization Helper (5 minutes)

```bash
# Edit script and inventory utilities
code src/utils/script.ts
code src/utils/inventory.ts

# Add serializeAuthorisationInfo() helper to both
```

**Test**: Create simple unit test for helper

```typescript
test('serializeAuthorisationInfo converts date to ISO string', () => {
  const info = {
    description: 'Test',
    authorised: true,
    date: new Date('2025-10-24T12:00:00.789Z'),
  }
  const result = serializeAuthorisationInfo(info)
  expect(result.date).toBe('2025-10-24T12:00:00.789Z')
})
```

### Step 3: Extend matcherToConfig() (15 minutes)

```bash
# Add 'or' and 'and' cases to switch statement
code src/utils/script.ts
code src/utils/inventory.ts
```

**Test**: Create unit test for composite matcher serialization

```typescript
test('matcherToConfig serializes OrMatcher', () => {
  const matcher = new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')])
  const config = matcherToConfig(matcher)
  expect(config).toEqual({
    orMatcher: [{ contentMatcher: 'pattern1' }, { contentMatcher: 'pattern2' }],
  })
})
```

### Step 4: Round-Trip Testing (20 minutes)

```bash
# Create comprehensive round-trip tests
code test/unit/utils/script.test.ts
```

**Test Pattern**:

```typescript
test('OrMatcher survives round-trip', () => {
  const original: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')], {
        description: 'Accept either pattern',
        authorised: true,
        date: new Date('2025-10-24T12:00:00.000Z'),
      }),
      authorisationInfo: {/* ... */},
    },
  }

  // Serialize
  const serialized = inventoryScriptInfoToRawInventoryScriptInfo(original)

  // Deserialize
  const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(serialized)

  // Verify structure
  expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
  expect(deserialized.authoriseWith.matcher.getPattern()).toHaveLength(2)

  // Verify behavior
  const testScript = {/* mock */}
  expect(deserialized.authoriseWith.matcher.identify(testScript)).toBe(original.authoriseWith.matcher.identify(testScript))
})
```

**Run all tests**:

```bash
npm run test:unit
```

### Step 5: Integration Testing (10 minutes)

```bash
# Test full inventory workflow
npm run test:integration
```

**Verify**:

- Inventories with composite matchers can be loaded from Git
- Inventories with composite matchers can be saved to Git
- Round-trip through Git preserves all data

### Step 6: Code Quality (5 minutes)

```bash
# Run all quality checks
npm run check:formatting
npm run check:linting
npm run check:typing
```

**Fix any issues**:

```bash
npm run fix:formatting
npm run fix:linting
```

## Common Issues

### Issue 1: TypeScript Errors for getAuthorisationInfo()

**Symptom**: `Property 'getAuthorisationInfo' does not exist on type 'Matcher'`

**Solution**: Use type assertion `(matcher as any).getAuthorisationInfo?.()` in serialization code. Alternative: Add method to Matcher interface (but not all matchers need it).

### Issue 2: Stack Overflow on Deeply Nested Matchers

**Symptom**: `RangeError: Maximum call stack size exceeded`

**Diagnosis**: Check nesting depth. Spec supports up to 10 levels. If exceeding, investigate data corruption.

**Solution**: If legitimate deep nesting (>10 levels), consider iterative serialization with explicit stack.

### Issue 3: Date Precision Loss

**Symptom**: Dates differ by milliseconds after round-trip

**Diagnosis**: Ensure ISO string includes milliseconds (`.toISOString()` does this by default).

**Fix**: Verify test comparisons use `date.getTime()` for exact equality:

```typescript
expect(deserialized.date.getTime()).toBe(original.date.getTime())
```

### Issue 4: Missing authorisationInfo in Serialized Output

**Symptom**: JSON lacks `authorisationInfo` field even though matcher has metadata

**Diagnosis**: Check if `getAuthorisationInfo()` method is present and returning correct value.

**Fix**:

1. Verify method added to OrMatcher/AndMatcher classes
2. Verify serialization code calls method: `matcher.getAuthorisationInfo()`
3. Verify conditional spread: `if (authInfo) { config.authorisationInfo = ... }`

## Success Criteria Checklist

Before considering the feature complete, verify:

- [ ] `npm run test:unit` passes with 100% coverage for new code
- [ ] `npm run test:integration` passes
- [ ] Round-trip tests for OrMatcher pass
- [ ] Round-trip tests for AndMatcher pass
- [ ] Round-trip tests for nested composites (3+ levels) pass
- [ ] Date precision preserved (millisecond equality)
- [ ] Authorization metadata preserved through round-trips
- [ ] Unknown matcher types throw descriptive errors
- [ ] `npm run check:typing` passes
- [ ] `npm run check:linting` passes
- [ ] `npm run check:formatting` passes
- [ ] Performance: Serialize 100-child composite in <100ms

## Next Steps After Implementation

1. **Update CLAUDE.md**: Document the new serialization support for composite matchers
2. **Create Example Inventories**: Add example JSON files showing composite matcher usage
3. **Monitor Production**: After merge, monitor inventory commits for serialization errors
4. **Performance Profiling**: If needed, profile large inventories and optimize

## Need Help?

**Key Reference Documents**:

- [research.md](research.md) - Design decisions and alternatives considered
- [data-model.md](data-model.md) - Entity definitions and relationships
- [contracts/serialization-api.md](contracts/serialization-api.md) - Function contracts and examples
- [spec.md](spec.md) - Requirements and acceptance criteria

**Existing Patterns to Follow**:

- Leaf matcher serialization: [src/utils/script.ts:76-92](../../../src/utils/script.ts#L76-L92)
- Composite matcher deserialization: [src/types/matcher/matcher-factory.ts:74-107](../../../src/types/matcher/matcher-factory.ts#L74-L107)
- Round-trip testing: [test/unit/utils/script.test.ts](../../../test/unit/utils/script.test.ts)

**Constitution Compliance**:

- This feature extends existing patterns (Principle VI: Minimal Complexity)
- No new abstractions or dependencies introduced
- Fully covered by tests (Principle V: Test Coverage)
- Enhances audit trail (Principle III: Git-Based Audit Trail)
