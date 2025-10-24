# Implementation Tasks: Improve Serialization/Deserialization for Composite Matchers

**Feature**: 007-improve-serialization-deserialization
**Branch**: `007-improve-serialization-deserialization`
**Status**: Ready for Implementation
**Generated**: 2025-10-24

## Overview

This document provides an actionable task breakdown for implementing serialization/deserialization support for composite matchers (OrMatcher, AndMatcher). Tasks are organized by user story to enable independent implementation and testing.

**Key Principles**:

- Each user story can be implemented and tested independently
- Tasks are ordered by dependencies within each phase
- Parallel execution opportunities are marked with [P]
- All tasks include specific file paths for clarity

## Implementation Strategy

### MVP Scope (Minimum Viable Product)

**Recommended MVP**: User Story 1 only (Serialize Composite Matchers to JSON)

**Rationale**:

- US1 is the core blocker preventing production use
- US2 (deserialization) already works via existing `createMatcher` factory
- US3 and US4 depend on US1+US2 working together
- Incremental delivery: ship serialization first, validate, then add comprehensive testing

**Post-MVP Increments**:

1. US1 → Enable composite matcher persistence (immediate value)
2. US3 → Add round-trip validation (data integrity)
3. US4 → Validate nested composites (edge cases)

### Execution Phases

- **Phase 1**: Setup & Prerequisites (foundational work)
- **Phase 2**: User Story 1 - Serialize Composite Matchers (P1 - MVP)
- **Phase 3**: User Story 2 - Deserialize Composite Matchers (P1 - validate existing behavior)
- **Phase 4**: User Story 3 - Round-Trip Preservation (P2 - data integrity)
- **Phase 5**: User Story 4 - Nested Composite Matchers (P3 - edge cases)
- **Phase 6**: Polish & Integration

---

## Phase 1: Setup & Prerequisites

**Goal**: Prepare development environment and validate existing infrastructure.

**Duration Estimate**: 10 minutes

### Tasks

- [x] T001 Verify TypeScript compilation succeeds with `npm run check:typing`
- [x] T002 Verify existing unit tests pass with `npm run test:unit`
- [x] T003 Verify existing integration tests pass with `npm run test:integration`
- [x] T004 Review existing serialization pattern in src/utils/script.ts lines 76-108
- [x] T005 Review existing deserialization pattern in src/types/matcher/matcher-factory.ts lines 74-107
- [x] T006 Verify OrMatcher constructor in src/types/matcher/or-matcher.ts accepts authorisationInfo parameter
- [x] T007 Verify AndMatcher constructor in src/types/matcher/and-matcher.ts accepts authorisationInfo parameter

**Completion Criteria**:

- [x] All existing tests pass (no regressions)
- [x] Code patterns for extension points identified
- [x] Understanding of existing matcher reflection methods (getType, getPattern)

---

## Phase 2: User Story 1 - Serialize Composite Matchers to JSON (P1)

**Story Goal**: Security engineers can persist inventory configurations with composite matchers to Git repositories without errors or data loss.

**Independent Test**: Create an InventoryScriptInfo with OrMatcher containing two ContentMatchers, call `inventoryScriptInfoToRawInventoryScriptInfo`, verify JSON structure contains `orMatcher` array with two `contentMatcher` entries.

**Priority**: P1 (Core blocker - MVP)

**Duration Estimate**: 45 minutes

### 2.1: Add Accessor Methods to Composite Matchers

- [x] T008 [P] [US1] Add getAuthorisationInfo() accessor method to OrMatcher class in src/types/matcher/or-matcher.ts after line 87
- [x] T009 [P] [US1] Add getAuthorisationInfo() accessor method to AndMatcher class in src/types/matcher/and-matcher.ts after line 87

**Implementation Details (T008, T009)**:

```typescript
/**
 * Returns authorization metadata for serialization.
 * @returns Authorization info if present, undefined otherwise
 */
getAuthorisationInfo(): InventoryAuthorisationInfo | undefined {
  return this.authorisationInfo
}
```

### 2.2: Add Serialization Helper for Authorization Metadata

- [x] T010 [P] [US1] Add serializeAuthorisationInfo() helper function in src/utils/script.ts after imports (line 10)
- [x] T011 [P] [US1] Add serializeAuthorisationInfo() helper function in src/utils/inventory.ts after imports (line 10)

**Implementation Details (T010, T011)**:

```typescript
function serializeAuthorisationInfo(info: InventoryAuthorisationInfo): { description: string; authorised: boolean; date: string } {
  return {
    description: info.description,
    authorised: info.authorised,
    date: info.date.toISOString(),
  }
}
```

### 2.3: Extend matcherToConfig() for Composite Matchers

- [x] T012 [US1] Extend matcherToConfig() helper in src/utils/script.ts to handle 'or' matcher type (add case before default at line 90)
- [x] T013 [US1] Extend matcherToConfig() helper in src/utils/script.ts to handle 'and' matcher type (add case before default at line 90)
- [x] T014 [US1] Extend matcherToConfig() helper in src/utils/inventory.ts to handle 'or' matcher type (add case before default at line 82)
- [x] T015 [US1] Extend matcherToConfig() helper in src/utils/inventory.ts to handle 'and' matcher type (add case before default at line 82)

**Implementation Details (T012-T015)**:

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

### 2.4: Unit Tests for User Story 1

- [x] T016 [P] [US1] Add test for getAuthorisationInfo() accessor in test/unit/types/matcher/or-matcher.test.ts
- [x] T017 [P] [US1] Add test for getAuthorisationInfo() accessor in test/unit/types/matcher/and-matcher.test.ts
- [x] T018 [P] [US1] Add test for serializeAuthorisationInfo() date conversion in test/unit/utils/script.test.ts
- [x] T019 [P] [US1] Add test for OrMatcher serialization with HashMatcher children in test/unit/utils/script.test.ts
- [x] T020 [P] [US1] Add test for AndMatcher serialization with ContentMatcher children in test/unit/utils/script.test.ts (Note: Added to script.test.ts instead)
- [x] T021 [P] [US1] Add test for composite matcher serialization with authorisationInfo in test/unit/utils/script.test.ts
- [x] T022 [P] [US1] Add test for composite matcher serialization without authorisationInfo in test/unit/utils/script.test.ts

**Test Pattern Example (T019)**:

```typescript
test('serializes OrMatcher with HashMatcher children', () => {
  const inventoryScript: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher([new HashMatcher([{ timestamp: new Date('2025-10-01'), hash: { value: 'abc123' } }]), new HashMatcher([{ timestamp: new Date('2025-10-15'), hash: { value: 'def456' } }])], {
        description: 'Accept version 1.0 or 1.1',
        authorised: true,
        date: new Date('2025-10-24T12:00:00.000Z'),
      }),
      authorisationInfo: { description: 'Analytics', authorised: true, date: new Date('2025-10-24') },
    },
  }

  const raw = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)

  expect(raw.authoriseWith).toHaveProperty('orMatcher')
  expect(raw.authoriseWith.orMatcher).toHaveLength(2)
  expect(raw.authoriseWith.orMatcher[0]).toHaveProperty('hashes')
  expect(raw.authoriseWith.orMatcher[1]).toHaveProperty('hashes')
  expect(raw.authoriseWith.authorisationInfo.date).toBe('2025-10-24T12:00:00.000Z')
})
```

### 2.5: Verify User Story 1 Completion

- [x] T023 [US1] Run unit tests with `npm run test:unit` and verify all US1 tests pass
- [x] T024 [US1] Run type checking with `npm run check:typing` and verify no TypeScript errors
- [x] T025 [US1] Manually test serialization with sample OrMatcher and verify JSON output structure

**Completion Criteria for US1**:

- [x] OrMatcher and AndMatcher instances serialize to valid JSON
- [x] Authorization metadata preserved with ISO date format
- [x] Recursive serialization works (composite containing composite)
- [x] No errors thrown during serialization
- [x] All unit tests pass

---

## Phase 3: User Story 2 - Deserialize Composite Matchers from JSON (P1)

**Story Goal**: Security engineers can load inventory configurations with composite matchers from Git without errors or data loss.

**Independent Test**: Create RawInventoryScriptInfo JSON with `orMatcher` array containing two matcher configs, call `rawInventoryScriptInfoToInventoryScriptInfo`, verify returned object contains OrMatcher instance with two child matchers.

**Priority**: P1 (Required for complete feature)

**Duration Estimate**: 20 minutes

**NOTE**: Deserialization already works via existing `createMatcher` factory. This phase validates and tests existing behavior.

### 3.1: Validate Existing Deserialization

- [x] T026 [US2] Review createMatcher() factory in src/types/matcher/matcher-factory.ts lines 93-103 for orMatcher/andMatcher support
- [x] T027 [US2] Verify Zod schema in src/types/inventory/matcher-config-schema.ts lines 69-77 validates composite matchers

### 3.2: Unit Tests for User Story 2

- [x] T028 [P] [US2] Add test for deserializing orMatcher with two HashMatchers in test/unit/utils/script.test.ts
- [x] T029 [P] [US2] Add test for deserializing andMatcher with three ContentMatchers in test/unit/utils/inventory.test.ts
- [x] T030 [P] [US2] Add test for deserializing composite matcher with authorisationInfo in test/unit/utils/script.test.ts
- [x] T031 [P] [US2] Add test for deserializing composite matcher without authorisationInfo in test/unit/utils/script.test.ts

**Test Pattern Example (T028)**:

```typescript
test('deserializes orMatcher with two HashMatchers', () => {
  const raw: RawInventoryScriptInfo = {
    identifyWith: { nameMatcher: '^https://example\\.com/.*$' },
    authoriseWith: {
      orMatcher: [{ hashes: [{ timestamp: '2025-10-01T00:00:00.000Z', hash: { value: 'abc123' } }] }, { hashes: [{ timestamp: '2025-10-15T00:00:00.000Z', hash: { value: 'def456' } }] }],
      authorisationInfo: {
        description: 'Accept version 1.0 or 1.1',
        authorised: true,
        date: '2025-10-24T12:00:00.000Z',
      },
    },
  }

  const inventoryScript = rawInventoryScriptInfoToInventoryScriptInfo(raw)

  expect(inventoryScript.authoriseWith.matcher.getType()).toBe('or')
  expect(inventoryScript.authoriseWith.matcher.getPattern()).toHaveLength(2)
  const children = inventoryScript.authoriseWith.matcher.getPattern() as Matcher[]
  expect(children[0].getType()).toBe('hash')
  expect(children[1].getType()).toBe('hash')
})
```

### 3.3: Verify User Story 2 Completion

- [x] T032 [US2] Run unit tests with `npm run test:unit` and verify all US2 tests pass
- [x] T033 [US2] Manually test deserialization with sample JSON and verify Matcher instances created

**Completion Criteria for US2**:

- [x] JSON with orMatcher/andMatcher deserializes to Matcher instances
- [x] Authorization metadata restored with Date instances
- [x] Recursive deserialization works (nested composites)
- [x] All unit tests pass

---

## Phase 4: User Story 3 - Round-Trip Preservation (P2)

**Story Goal**: Security engineers can modify inventory files with confidence that composite matchers survive serialization/deserialization cycles without data corruption.

**Independent Test**: Create InventoryScriptInfo with nested OrMatcher (containing AndMatcher with three children), serialize, deserialize, verify structure matches original (matcher types, patterns, authorization info, dates).

**Priority**: P2 (Data integrity validation)

**Duration Estimate**: 30 minutes

### 4.1: Round-Trip Tests for User Story 3

- [x] T034 [P] [US3] Add round-trip test for OrMatcher with ContentMatchers in test/unit/utils/script.test.ts
- [x] T035 [P] [US3] Add round-trip test for AndMatcher with nested OrMatcher in test/unit/utils/inventory.test.ts
- [x] T036 [P] [US3] Add round-trip test for composite matcher with special characters in description in test/unit/utils/script.test.ts
- [x] T037 [P] [US3] Add round-trip test for composite matcher with millisecond-precision date in test/unit/utils/script.test.ts
- [x] T038 [P] [US3] Add behavioral equivalence test (identify and authorize produce same results) in test/unit/utils/script.test.ts

**Test Pattern Example (T034)**:

```typescript
test('OrMatcher with ContentMatchers survives round-trip', () => {
  const original: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher([new ContentMatcher('pattern1'), new ContentMatcher('pattern2')], {
        description: 'Accept either pattern',
        authorised: true,
        date: new Date('2025-10-24T12:00:00.789Z'),
      }),
      authorisationInfo: { description: 'Test', authorised: true, date: new Date('2025-10-24') },
    },
  }

  // Serialize
  const serialized = inventoryScriptInfoToRawInventoryScriptInfo(original)

  // Deserialize
  const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(serialized)

  // Verify structure
  expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
  const children = deserialized.authoriseWith.matcher.getPattern() as Matcher[]
  expect(children).toHaveLength(2)
  expect(children[0].getType()).toBe('content')
  expect(children[1].getType()).toBe('content')

  // Verify metadata preserved
  const authInfo = (deserialized.authoriseWith.matcher as OrMatcher).getAuthorisationInfo()
  expect(authInfo?.description).toBe('Accept either pattern')
  expect(authInfo?.authorised).toBe(true)
  expect(authInfo?.date.getTime()).toBe(new Date('2025-10-24T12:00:00.789Z').getTime())

  // Verify behavioral equivalence
  const testScript = {
    source: { type: 'external' as const, url: 'https://example.com/test.js' },
    content: 'pattern1',
    hash: { value: 'test' },
  }
  expect(deserialized.authoriseWith.matcher.identify(testScript)).toBe(original.authoriseWith.matcher.identify(testScript))
})
```

### 4.2: Verify User Story 3 Completion

- [x] T039 [US3] Run unit tests with `npm run test:unit` and verify all US3 tests pass
- [x] T040 [US3] Verify date precision preserved (millisecond equality in tests)

**Completion Criteria for US3**:

- [x] Round-trip tests pass for all composite matcher types
- [x] Authorization metadata preserved exactly (including dates)
- [x] Behavioral equivalence verified (same identify/authorize results)
- [x] All unit tests pass

---

## Phase 5: User Story 4 - Nested Composite Matchers (P3)

**Story Goal**: Security engineers can define complex authorization policies with multiple nesting levels (up to 10 levels) without stack overflow or performance degradation.

**Independent Test**: Create OrMatcher containing AndMatcher containing OrMatcher containing three leaf matchers, serialize, deserialize, verify all nesting levels and leaf patterns preserved.

**Priority**: P3 (Edge cases and performance validation)

**Duration Estimate**: 25 minutes

### 5.1: Nested Composite Tests for User Story 4

- [ ] T041 [P] [US4] Add test for 3-level nested composites (OrMatcher > AndMatcher > ContentMatchers) in test/unit/utils/script.test.ts
- [ ] T042 [P] [US4] Add test for 10-level deeply nested structure in test/unit/utils/script.test.ts
- [ ] T043 [P] [US4] Add test for nested composites with authorization metadata at multiple levels in test/unit/utils/script.test.ts
- [ ] T044 [P] [US4] Add test for mixed child types (OrMatcher with leaf and composite children) in test/unit/utils/script.test.ts

**Test Pattern Example (T041)**:

```typescript
test('3-level nested composites preserve structure', () => {
  const inventoryScript: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher([new AndMatcher([new ContentMatcher('required1'), new ContentMatcher('required2')]), new ContentMatcher('pattern3')]),
      authorisationInfo: { description: 'Test', authorised: true, date: new Date('2025-10-24') },
    },
  }

  const serialized = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)
  const deserialized = rawInventoryScriptInfoToInventoryScriptInfo(serialized)

  expect(deserialized.authoriseWith.matcher.getType()).toBe('or')
  const orChildren = deserialized.authoriseWith.matcher.getPattern() as Matcher[]
  expect(orChildren).toHaveLength(2)
  expect(orChildren[0].getType()).toBe('and')
  expect(orChildren[1].getType()).toBe('content')

  const andChildren = orChildren[0].getPattern() as Matcher[]
  expect(andChildren).toHaveLength(2)
  expect(andChildren[0].getType()).toBe('content')
  expect(andChildren[1].getType()).toBe('content')
})
```

### 5.2: Performance Tests for User Story 4

- [ ] T045 [US4] Add performance test for serializing composite with 100 children in test/unit/utils/script.test.ts
- [ ] T046 [US4] Verify serialization completes in under 100ms for 100-child composite

**Test Pattern Example (T045)**:

```typescript
test('serializes composite with 100 children in under 100ms', () => {
  const children = Array.from({ length: 100 }, (_, i) => new ContentMatcher(`pattern${i}`))

  const inventoryScript: InventoryScriptInfo = {
    identifyWith: new NameMatcher('^https://example\\.com/.*$'),
    authoriseWith: {
      matcher: new OrMatcher(children),
      authorisationInfo: { description: 'Test', authorised: true, date: new Date('2025-10-24') },
    },
  }

  const start = performance.now()
  const serialized = inventoryScriptInfoToRawInventoryScriptInfo(inventoryScript)
  const end = performance.now()

  expect(end - start).toBeLessThan(100)
  expect(serialized.authoriseWith.orMatcher).toHaveLength(100)
})
```

### 5.3: Verify User Story 4 Completion

- [ ] T047 [US4] Run unit tests with `npm run test:unit` and verify all US4 tests pass
- [ ] T048 [US4] Verify no stack overflow for 10-level nesting
- [ ] T049 [US4] Verify performance requirement met (100 children < 100ms)

**Completion Criteria for US4**:

- [ ] Nested composites up to 10 levels work correctly
- [ ] Mixed child types (leaf + composite) serialize correctly
- [ ] Performance requirements met (100 children < 100ms)
- [ ] All unit tests pass

---

## Phase 6: Polish & Integration

**Goal**: Validate complete feature integration, run full test suite, and verify production readiness.

**Duration Estimate**: 20 minutes

### 6.1: Integration Testing

- [ ] T050 [P] Add integration test for full inventory workflow with composite matchers in test/integration/inventory-service.test.ts
- [ ] T051 [P] Add integration test for Git commit with composite matcher inventory in test/integration/inventory-service.test.ts

**Test Pattern Example (T050)**:

```typescript
test('full inventory workflow with composite matchers', async () => {
  // Create inventory with composite matcher
  const inventory: Inventory = {
    fileName: 'test-inventory.json',
    target: {
      /* ... */
    },
    alerts: {
      /* ... */
    },
    scripts: [
      {
        identifyWith: new NameMatcher('^https://example\\.com/.*$'),
        authoriseWith: {
          matcher: new OrMatcher([new HashMatcher([{ timestamp: new Date(), hash: { value: 'abc123' } }]), new HashMatcher([{ timestamp: new Date(), hash: { value: 'def456' } }])]),
          authorisationInfo: { description: 'Test', authorised: true, date: new Date() },
        },
      },
    ],
    headers: [],
  }

  // Save to Git (triggers serialization)
  await inventoryService.updateInventory(inventory)

  // Load from Git (triggers deserialization)
  const loaded = await inventoryRepository.loadInventory('test-inventory.json')

  // Verify round-trip
  expect(loaded.scripts[0].authoriseWith.matcher.getType()).toBe('or')
})
```

### 6.2: Code Quality & Documentation

- [ ] T052 Run full test suite with `npm run test:unit && npm run test:integration`
- [ ] T053 Run linting with `npm run check:linting` and fix any issues
- [ ] T054 Run formatting with `npm run check:formatting` and fix any issues
- [ ] T055 Run type checking with `npm run check:typing` and fix any issues
- [ ] T056 Review all modified files for code comments and documentation
- [ ] T057 Update CLAUDE.md if needed with composite matcher serialization details

### 6.3: Final Validation

- [ ] T058 Verify all user story acceptance criteria met (review spec.md)
- [ ] T059 Verify all success criteria met (review spec.md SC-001 through SC-006)
- [ ] T060 Run precommit checks with `npm run precommit`

**Completion Criteria for Phase 6**:

- [ ] All tests pass (unit + integration)
- [ ] No linting, formatting, or type errors
- [ ] All acceptance criteria met
- [ ] Code ready for pull request

---

## Dependency Graph

This graph shows the completion order for user stories. Most stories are independent and can be implemented in parallel by different team members.

```
Phase 1 (Setup)
    │
    ├─────────────────┬─────────────────┬─────────────────┐
    │                 │                 │                 │
    v                 v                 v                 v
Phase 2 (US1)    Phase 3 (US2)    Phase 4 (US3)    Phase 5 (US4)
Serialize        Deserialize      Round-Trip       Nested
[Required]       [Validate]       [Depends US1+2]  [Depends US1+2]
    │                 │                 │                 │
    └─────────────────┴─────────────────┴─────────────────┘
                          │
                          v
                    Phase 6 (Polish)
                    Integration Tests
```

**Dependencies**:

- **US1 → US3**: Round-trip tests require serialization to work
- **US2 → US3**: Round-trip tests require deserialization to work (already exists)
- **US1 → US4**: Nested composite tests require serialization to work
- **US2 → US4**: Nested composite tests require deserialization to work (already exists)
- **US1, US2 → Phase 6**: Integration tests require both directions working

**Parallel Opportunities**:

- US1 and US2 can be implemented in parallel (different code areas)
- After US1+US2 complete, US3 and US4 can be implemented in parallel
- All unit tests within a phase can be written in parallel

---

## Parallel Execution Examples

### Within Phase 2 (User Story 1)

**Parallel Group 1** (Independent files):

- T008: Add accessor to OrMatcher
- T009: Add accessor to AndMatcher
- T010: Add helper to script.ts
- T011: Add helper to inventory.ts

**Sequential Group 2** (Depends on Group 1):

- T012-T015: Extend matcherToConfig (requires T010-T011)

**Parallel Group 3** (Independent test files):

- T016-T022: All unit tests can run in parallel

### Across Phases

**After Phase 1 Complete**:

- Team Member A: Implement US1 (Phase 2)
- Team Member B: Validate US2 (Phase 3)
- Can run in parallel - no conflicts

**After Phase 2 & 3 Complete**:

- Team Member A: Implement US3 (Phase 4)
- Team Member B: Implement US4 (Phase 5)
- Can run in parallel - different test scenarios

---

## Task Summary

**Total Tasks**: 60

**Breakdown by Phase**:

- Phase 1 (Setup): 7 tasks
- Phase 2 (US1): 18 tasks
- Phase 3 (US2): 8 tasks
- Phase 4 (US3): 7 tasks
- Phase 5 (US4): 9 tasks
- Phase 6 (Polish): 11 tasks

**Breakdown by Type**:

- Setup/Validation: 10 tasks
- Implementation: 15 tasks
- Unit Tests: 27 tasks
- Integration Tests: 2 tasks
- Code Quality: 6 tasks

**Parallelization Opportunities**:

- 35 tasks marked with [P] can run in parallel within their phase
- Phases 2 and 3 can run in parallel (US1 + US2)
- Phases 4 and 5 can run in parallel (US3 + US4)

**Estimated Total Duration**:

- Sequential execution: ~150 minutes (2.5 hours)
- Parallel execution (2 developers): ~90 minutes (1.5 hours)
- MVP only (US1): ~55 minutes

---

## Success Validation Checklist

Before marking this feature complete, verify all items:

### Functional Completeness

- [ ] OrMatcher serializes to JSON with `orMatcher` array field (FR-001)
- [ ] AndMatcher serializes to JSON with `andMatcher` array field (FR-002)
- [ ] JSON with `orMatcher` deserializes to OrMatcher instances (FR-003)
- [ ] JSON with `andMatcher` deserializes to AndMatcher instances (FR-004)
- [ ] Authorization metadata preserved during serialization (FR-005, FR-010)
- [ ] Authorization metadata preserved during deserialization (FR-006, FR-011)
- [ ] Recursive serialization works for nested composites (FR-007)
- [ ] Recursive deserialization works for nested composites (FR-008)
- [ ] Metadata paths preserved through round-trips (FR-009)
- [ ] Unknown matcher types throw descriptive errors (FR-012)
- [ ] All leaf matcher types still serialize correctly (FR-013)
- [ ] Round-trip preserves behavior (identify/authorize results) (FR-014)
- [ ] Performance requirement met (100 children < 100ms) (FR-015)

### Success Criteria

- [ ] Inventory with composite matchers persists to Git without errors (SC-001)
- [ ] 100% of round-trip tests pass (SC-002)
- [ ] Serialization performance meets target (SC-003)
- [ ] No regressions in existing tests (SC-004)
- [ ] Date precision preserved (millisecond equality) (SC-005)
- [ ] Behavioral equivalence verified (SC-006)

### Code Quality

- [ ] All unit tests pass (`npm run test:unit`)
- [ ] All integration tests pass (`npm run test:integration`)
- [ ] No TypeScript errors (`npm run check:typing`)
- [ ] No linting errors (`npm run check:linting`)
- [ ] No formatting errors (`npm run check:formatting`)
- [ ] All precommit checks pass (`npm run precommit`)

### Documentation

- [ ] Code comments added to new functions
- [ ] CLAUDE.md updated if needed
- [ ] All acceptance criteria from spec.md verified

---

## Notes for Implementation

### Key Design Decisions

1. **Recursive Serialization**: Use existing pattern from deserialization (mirrors `createMatcher`)
2. **Authorization Metadata**: Serialize dates to ISO strings, deserialize back to Date instances
3. **No Depth Limits**: Rely on natural JavaScript call stack limits (~10,000 levels)
4. **Fail-Secure**: Unknown matcher types throw errors (cannot safely serialize)
5. **Accessor Method**: Add `getAuthorisationInfo()` to OrMatcher/AndMatcher for metadata access

### Important Files

**Modified**:

- `src/types/matcher/or-matcher.ts` - Add accessor method
- `src/types/matcher/and-matcher.ts` - Add accessor method
- `src/utils/script.ts` - Add helper + extend matcherToConfig
- `src/utils/inventory.ts` - Add helper + extend matcherToConfig

**Test Files Created**:

- `test/unit/types/matcher/or-matcher.test.ts` - Accessor tests
- `test/unit/types/matcher/and-matcher.test.ts` - Accessor tests
- `test/unit/utils/script.test.ts` - Serialization/round-trip tests (extended)
- `test/unit/utils/inventory.test.ts` - Header serialization tests (extended)
- `test/integration/inventory-service.test.ts` - Full workflow tests (extended)

### References

- **Design Documents**: [research.md](research.md), [data-model.md](data-model.md)
- **API Contracts**: [contracts/serialization-api.md](contracts/serialization-api.md)
- **Developer Guide**: [quickstart.md](quickstart.md)
- **Feature Spec**: [spec.md](spec.md)
- **Implementation Plan**: [plan.md](plan.md)
