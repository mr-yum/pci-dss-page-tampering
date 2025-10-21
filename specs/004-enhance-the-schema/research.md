# Research: Schema Enhancement for Nested Authorization Info

**Feature**: Embed Authorization Info in Authorization Entity
**Branch**: 004-enhance-the-schema
**Date**: 2025-10-21

## Executive Summary

This document consolidates research findings for enhancing the inventory schema to nest `authorisationInfo` within `authoriseWith`, creating a cohesive authorization structure. The current implementation has `authorisationInfo` as a sibling to `identifyWith` and `authoriseWith`, creating fragmentation. The enhanced schema will encapsulate all authorization-related data (matcher logic + metadata) in a single composite entity.

## Current State Analysis

### Existing Schema Structure

**Current Model** (`src/types/inventory/model.ts:25-29, 41-45`):
```typescript
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: InventoryAuthorisationInfo  // ← Sibling field
}

export type InventoryHeaderInfo = {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: InventoryAuthorisationInfo  // ← Sibling field
}
```

**Current Raw Schema** (`src/types/inventory/raw.ts:12-15, 25-28`):
```typescript
export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
  // authorisationInfo inherited from InventoryScriptInfo
}

export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
  // authorisationInfo inherited from InventoryHeaderInfo
}
```

### Data Flow Points

1. **Script Conversion** (`src/utils/script.ts`):
   - `scriptInfoToInventoryScriptInfo` (16-28): Creates new inventory entries during discovery
   - `rawInventoryScriptInfoToInventoryScriptInfo` (54-59): Loads from JSON
   - `inventoryScriptInfoToRawInventoryScriptInfo` (70-94): Saves to JSON

2. **Header Conversion** (`src/utils/inventory.ts`):
   - `rawInventoryHeaderInfoToInventoryHeaderInfo` (44-49): Loads from JSON
   - `inventoryHeaderInfoToRawInventoryHeaderInfo` (60-86): Saves to JSON

3. **Comparison Services**:
   - `ScriptComparisonService` (`src/services/comparison/script.ts`): Accesses `authorisationInfo` during comparison
   - `HeaderComparisonService` (`src/services/comparison/header.ts`): Accesses `authorisationInfo` during comparison

## Design Decisions

### Decision 1: Composite Authorization Entity Structure

**Chosen Approach**: Create a composite structure that wraps matcher configuration with authorization metadata.

**Rationale**:
- Improves data cohesion by grouping related information
- Eliminates sibling relationship between matcher and metadata
- Makes authorization context self-contained and portable
- Aligns with domain model: "authorization" includes both "how to authorize" and "authorization status"

**Alternatives Considered**:
1. **Keep current structure** - Rejected: Maintains fragmentation, doesn't address the core issue
2. **Flatten all fields** - Rejected: Would increase complexity and reduce clarity
3. **Separate authorization entity** - Rejected: Would require additional lookup/join logic

### Decision 2: Type Naming Convention

**Chosen Approach**: Introduce `AuthorizeWithConfig` type for the composite structure.

**Rationale**:
- Clear, descriptive name indicating it's a configuration object
- Distinguishes between the Matcher instance and the configuration wrapper
- Consistent with existing naming patterns (`RawMatcherConfig`, `MatcherConfig`)

**Alternatives Considered**:
1. **AuthorizationEntity** - Rejected: Too generic, doesn't indicate it's configuration
2. **MatcherWithMetadata** - Rejected: Implies matcher is primary, metadata is secondary
3. **AuthorizeWithInfo** - Rejected: "Info" is ambiguous (could be just metadata)

### Decision 3: Backward Compatibility Strategy

**Chosen Approach**: No automatic migration; manual inventory update expected.

**Rationale**:
- Per assumption A-001 in spec: "one-time migration or manual update is acceptable"
- Schema is internal to this service (not a public API)
- Inventory files are version-controlled; migration can be tracked via Git
- Reduces implementation complexity and testing burden

**Alternatives Considered**:
1. **Dual-format support** - Rejected: Increases complexity, requires maintaining two code paths
2. **Automatic migration on load** - Rejected: Hidden side effects, harder to audit
3. **Migration script** - Considered acceptable if needed, but not required for initial implementation

### Decision 4: Zod Schema Validation Approach

**Chosen Approach**: Update Zod schemas to validate nested structure, leverage discriminated unions for matcher types.

**Rationale**:
- Zod already used throughout codebase for schema validation (established pattern)
- Discriminated unions provide type-safe validation for different matcher types
- Fail-fast validation at deserialization boundary prevents invalid data from entering system
- Aligns with Constitution Principle VI (Minimal Complexity - use established patterns)

**Alternatives Considered**:
1. **Runtime validation with custom functions** - Rejected: More complex, less declarative
2. **TypeScript-only validation** - Rejected: Doesn't protect against malformed JSON input
3. **JSON Schema** - Rejected: Would require new dependency, Zod already established

## TypeScript Best Practices for Schema Refactoring

### Type-Safe Transformations

**Best Practice**: Use `Omit` and intersection types to construct derivative types from source types.

**Current Usage** (already established in codebase):
```typescript
export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
}
```

**Application**: Continue this pattern for new composite structure:
```typescript
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig  // New composite type
}

export type AuthorizeWithConfig = {
  matcher: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}
```

**Benefit**: Compiler enforces consistency between related types, reduces duplication.

### Zod Schema Composition

**Best Practice**: Compose complex schemas from smaller, reusable schema fragments.

**Existing Pattern** (from `src/types/inventory/matcher-config-schema.ts`):
```typescript
const NameMatcherSchema = z.object({ nameMatcher: z.string() })
const ContentMatcherSchema = z.object({ contentMatcher: z.string() })
const HashMatcherSchema = z.object({ hashes: z.array(InventoryScriptHashInfoSchema) })

const RawMatcherConfigSchema = z.discriminatedUnion('type', [
  NameMatcherSchema,
  ContentMatcherSchema,
  HashMatcherSchema
])
```

**Application**: Create AuthorizeWithConfigSchema by composing matcher schema with authorization info schema.

**Benefit**: DRY principle, easier to maintain, clearer validation errors.

### Conversion Function Patterns

**Best Practice**: Use small, focused conversion functions with clear responsibilities.

**Existing Pattern** (already in codebase):
- `rawInventoryScriptInfoToInventoryScriptInfo`: JSON → Runtime model
- `inventoryScriptInfoToRawInventoryScriptInfo`: Runtime model → JSON

**Application**: Update these functions to handle nested structure, maintain clear separation of concerns.

**Benefit**: Testability, maintainability, clear data flow.

## Testing Strategy

### Unit Test Coverage

**Required Tests** (from FR-010 through FR-013):

1. **Schema Validation Tests** (`src/types/inventory/zod.test.ts`):
   - Valid nested structure passes validation
   - Missing `authorisationInfo` fails validation
   - Invalid matcher configurations fail validation
   - Edge cases: null values, empty strings, invalid dates

2. **Round-Trip Serialization Tests** (new test file: `test/unit/utils/inventory/round-trip.test.ts`):
   - JSON → Model → JSON preserves structure
   - Nested `authorisationInfo` remains within `authoriseWith`
   - All fields preserved with correct types
   - Multiple entries with different matcher types

3. **Conversion Function Tests** (`test/unit/utils/script.test.ts`, `test/unit/utils/inventory.test.ts`):
   - `scriptInfoToInventoryScriptInfo` creates correct nested structure
   - `rawInventoryScriptInfoToInventoryScriptInfo` correctly parses nested JSON
   - `inventoryScriptInfoToRawInventoryScriptInfo` correctly serializes nested structure
   - Header equivalents for all above

4. **Comparison Service Tests** (`test/unit/services/comparison/script.test.ts`, `test/unit/services/comparison/header.test.ts`):
   - Services access `authorisationInfo` from new nested location
   - Authorization logic works correctly with nested structure
   - All comparison result types generated correctly

### Integration Test Considerations

**Scope**: Full workflow tests with mocked Puppeteer responses (existing pattern).

**Required Coverage**:
- Inventory workflow creates entries with nested authorization info
- Detection workflow reads entries with nested authorization info
- Git push/pull operations preserve nested structure
- Alert generation accesses authorization metadata correctly

### Edge Case Testing

**Critical Edge Cases** (from spec edge cases):

1. **Missing authorisationInfo**: Should fail validation (required field)
2. **Partially migrated inventories**: Not supported (per backward compatibility decision)
3. **Null/invalid fields**: Should fail Zod validation with clear error messages
4. **Different matcher types**: Each matcher type (NameMatcher, ContentMatcher, HashMatcher, HeaderNameMatcher) must work with nested structure

## Implementation Approach

### Phased Implementation

**Phase 1: Type Definitions** (Zero Runtime Impact)
- Update `InventoryScriptInfo` and `InventoryHeaderInfo` type definitions
- Create `AuthorizeWithConfig` type
- Update `RawInventoryScriptInfo` and `RawInventoryHeaderInfo` types
- TypeScript compilation will fail everywhere the structure is accessed (intentional)

**Phase 2: Schema Validation** (Isolated Change)
- Update Zod schemas to validate nested structure
- Add schema validation tests
- No runtime behavior change yet (no data using new schema)

**Phase 3: Conversion Functions** (Isolated Change)
- Update all conversion functions in `src/utils/script.ts` and `src/utils/inventory.ts`
- Add round-trip serialization tests
- Still no runtime behavior change (no services updated yet)

**Phase 4: Service Integration** (Runtime Behavior Change)
- Update `ScriptComparisonService` to access nested `authorisationInfo`
- Update `HeaderComparisonService` to access nested `authorisationInfo`
- Update any other services that access authorization metadata
- Add service integration tests

**Phase 5: End-to-End Validation** (Confidence Check)
- Run full test suite (unit + integration)
- Manually test with sample inventory files
- Validate Git operations preserve structure
- Validate alerts include correct authorization context

### Rollout Strategy

**Preparation**:
1. Implement all code changes (Phases 1-4)
2. Ensure 100% test coverage for new structure
3. Create sample inventory files in new format

**Deployment**:
1. Update all inventory files in Git repository to new format (manual update)
2. Deploy code changes
3. Run detection workflow to validate
4. Monitor alerts for any issues

**Rollback Plan**:
- Git revert for inventory files (version controlled)
- Git revert for code changes
- No data loss (Git history preserved)

## Technology-Specific Considerations

### Zod Version Compatibility

**Current Version**: Zod ^4.0.17 (per package.json)

**Relevant Features**:
- `z.discriminatedUnion`: Already in use for `RawMatcherConfig`
- `z.object`: Standard object validation
- `z.array`: Array validation
- Type inference: `z.infer<typeof Schema>` ensures TypeScript types match Zod schemas

**No New Features Required**: All necessary Zod features already in use.

### TypeScript Strict Mode

**Current Configuration**: Using `@mr-yum/node-builder` TypeScript config (strict mode enabled)

**Implications**:
- All fields must be explicitly typed (no implicit `any`)
- Null/undefined must be explicitly handled
- Type narrowing required for discriminated unions

**Benefit**: Compiler enforces correctness during refactoring, catches access pattern errors.

### Jest Testing Infrastructure

**Current Setup**: Jest via `@mr-yum/node-builder` preset

**Test Organization** (per existing pattern):
- `test/unit/`: Unit tests mirroring `src/` structure
- Descriptive test names using `describe` and `it`
- Arrange-Act-Assert pattern

**No Changes Required**: Existing infrastructure sufficient for new tests.

## Risk Assessment

### Low Risk

✅ **Type Safety**: TypeScript compiler will catch all access pattern changes
✅ **Test Coverage**: Comprehensive tests required by spec (FR-010 through FR-013)
✅ **Rollback**: Git version control enables easy rollback
✅ **Isolation**: Schema change doesn't affect security logic (matcher pipeline unchanged)

### Medium Risk

⚠️ **Manual Migration**: Inventory files must be manually updated (mitigated by Git version control)
⚠️ **Service Integration**: Comparison services must be updated to access nested field (mitigated by TypeScript compilation errors if missed)

### No High Risks Identified

All constitution gates passed, security logic unchanged, comprehensive testing required.

## Open Questions

None. All technical context is clear based on existing codebase analysis.

## References

- Feature Spec: `specs/004-enhance-the-schema/spec.md`
- Constitution: `.specify/memory/constitution.md`
- Current Implementation:
  - Types: `src/types/inventory/model.ts`, `src/types/inventory/raw.ts`
  - Utilities: `src/utils/script.ts`, `src/utils/inventory.ts`
  - Services: `src/services/comparison/script.ts`, `src/services/comparison/header.ts`
  - Schema: `src/types/inventory/zod.ts`, `src/types/inventory/matcher-config-schema.ts`
