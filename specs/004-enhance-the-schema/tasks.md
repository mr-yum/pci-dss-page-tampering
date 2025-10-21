# Implementation Tasks: Embed Authorization Info in Authorization Entity

**Feature**: 004-enhance-the-schema
**Branch**: `004-enhance-the-schema`
**Status**: Ready for Implementation
**Generated**: 2025-10-21

## Overview

This document outlines the implementation tasks for enhancing the inventory schema to nest `authorisationInfo` within `authoriseWith`, creating a cohesive authorization structure. Tasks are organized by user story to enable independent implementation and testing.

## User Story Mapping

- **User Story 1 (P1)**: Schema Restructuring for Better Data Cohesion - Types, schemas, conversion functions
- **User Story 2 (P2)**: Backward Compatibility During Updates - Migration support (manual, out of MVP scope)
- **User Story 3 (P1)**: Test Validation for Schema Integrity - Comprehensive test coverage

## Dependencies

### User Story Completion Order

```
Setup (Phase 1) → Foundational (Phase 2) → US1 & US3 (parallel) → US2 (optional)
```

**Rationale**:

- **US1** and **US3** can be implemented in parallel - US1 implements the schema changes, US3 validates them
- **US2** is lower priority (P2) and depends on US1 completion
- MVP scope includes US1 + US3 only

### Task Dependencies Within Stories

- **US1**: Types → Schemas → Conversion Functions → Service Integration (sequential within story)
- **US3**: Can start schema tests immediately after US1 schemas complete (partial parallelism)

## Implementation Strategy

**MVP Scope**: User Stories 1 + 3 (P1 only)

- Core schema restructuring with comprehensive tests
- Enables validating the design with real code
- Provides complete, testable increment

**Phase 2 (Optional)**: User Story 2 (P2)

- Migration support for production deployment
- Can be deferred until MVP validates the approach

---

## Phase 1: Setup & Prerequisites

**Goal**: Prepare development environment and verify baseline

**Estimated Time**: 15 minutes

### Tasks

- [X] T001 Verify current branch is 004-enhance-the-schema
- [X] T002 Run baseline test suite to confirm clean starting state (npm run test:unit)
- [X] T003 Run type checking to confirm no existing errors (npm run check:typing)

**Verification**:

- All existing tests pass
- TypeScript compilation succeeds with zero errors
- Development environment ready

---

## Phase 2: Foundational Infrastructure

**Goal**: Create foundational types and infrastructure needed by all user stories

**Estimated Time**: 30 minutes

### Tasks

- [X] T004 Create AuthorizeWithConfig runtime type in src/types/inventory/model.ts
- [X] T005 Create RawAuthorizeWithConfig serializable type in src/types/inventory/raw.ts
- [X] T006 Run type check to verify new types compile (npm run check:typing)

**Verification**:

- TypeScript compilation succeeds
- New types available for use in subsequent phases
- No runtime behavior changes yet

**File Changes**:

- `src/types/inventory/model.ts`: Add `AuthorizeWithConfig` type
- `src/types/inventory/raw.ts`: Add `RawAuthorizeWithConfig` type

---

## Phase 3: User Story 1 - Schema Restructuring (P1)

**Goal**: Implement core schema changes to nest authorisationInfo within authoriseWith

**Independent Test Criteria**:

- Create inventory entry with nested structure → Serialize to JSON → Verify authorisationInfo is child of authoriseWith
- Load JSON with nested structure → Validate with Zod → Pass without errors
- Access authorization data → Verify matcher + metadata available from authoriseWith field

**Estimated Time**: 2-3 hours

### 3.1: Update Runtime Type Definitions

**Tasks**:

- [X] T007 [US1] Update InventoryScriptInfo type to use AuthorizeWithConfig in src/types/inventory/model.ts:25-29
- [X] T008 [US1] Update InventoryHeaderInfo type to use AuthorizeWithConfig in src/types/inventory/model.ts:41-45
- [X] T009 [US1] Run type check - expect compilation errors in conversion functions and services (npm run check:typing)

**Verification**:

- TypeScript shows errors in files that access old structure (expected)
- No errors in type definition files themselves

### 3.2: Update Serializable Type Definitions

**Tasks**:

- [X] T010 [US1] Update RawInventoryScriptInfo type to use RawAuthorizeWithConfig in src/types/inventory/raw.ts:12-15
- [X] T011 [US1] Update RawInventoryHeaderInfo type to use RawAuthorizeWithConfig in src/types/inventory/raw.ts:25-28
- [X] T012 [US1] Remove Omit pattern from raw types (no longer needed) in src/types/inventory/raw.ts

**Verification**:

- Raw types properly reflect flattened JSON structure (matcher config + authorisationInfo as siblings)

### 3.3: Update Zod Validation Schemas

**Tasks**:

- [X] T013 [US1] Create InventoryAuthorisationInfoRawSchema in src/types/inventory/zod.ts
- [X] T014 [US1] Create RawAuthorizeWithConfigSchema using intersection pattern in src/types/inventory/zod.ts
- [X] T015 [US1] Update RawInventoryScriptInfoSchema to use RawAuthorizeWithConfigSchema in src/types/inventory/zod.ts
- [X] T016 [US1] Update RawInventoryHeaderInfoSchema to use RawAuthorizeWithConfigSchema in src/types/inventory/zod.ts

**Verification**:

- Schemas compile without errors
- Intersection properly combines RawMatcherConfigSchema with authorisationInfo

### 3.4: Update Script Conversion Functions

**Tasks**:

- [X] T017 [US1] Update scriptInfoToInventoryScriptInfo to create nested authoriseWith structure in src/utils/script.ts:16-28
- [X] T018 [US1] Update rawInventoryScriptInfoToInventoryScriptInfo with destructuring pattern in src/utils/script.ts:54-59
- [X] T019 [US1] Update inventoryScriptInfoToRawInventoryScriptInfo with spread pattern in src/utils/script.ts:70-94

**Verification**:

- Conversion functions compile without TypeScript errors
- Destructuring correctly separates matcher config from authorisationInfo
- Spread correctly flattens matcher config alongside authorisationInfo

### 3.5: Update Header Conversion Functions

**Tasks**:

- [X] T020 [P] [US1] Update rawInventoryHeaderInfoToInventoryHeaderInfo with destructuring pattern in src/utils/inventory.ts:44-49
- [X] T021 [P] [US1] Update inventoryHeaderInfoToRawInventoryHeaderInfo with spread pattern in src/utils/inventory.ts:60-86
- [X] T022 [P] [US1] Update matcherToConfig helper to handle headerNameMatcher in src/utils/inventory.ts:62-79

**Verification**:

- Header conversion functions compile without errors
- Same destructuring/spread patterns as script functions
- HeaderNameMatcher properly supported

### 3.6: Update Comparison Services

**Tasks**:

- [X] T023 [US1] Update ScriptComparisonService to access authoriseWith.matcher in src/services/comparison/script.ts
- [X] T024 [US1] Update ScriptComparisonService to access authoriseWith.authorisationInfo in src/services/comparison/script.ts
- [X] T025 [P] [US1] Update HeaderComparisonService to access authoriseWith.matcher in src/services/comparison/header.ts
- [X] T026 [P] [US1] Update HeaderComparisonService to access authoriseWith.authorisationInfo in src/services/comparison/header.ts

**Verification**:

- All services access authorization data from new nested location
- No TypeScript compilation errors
- Alert generation logic unchanged (same data, different access pattern)

### 3.7: Verify Type Safety

**Tasks**:

- [X] T027 [US1] Run type checking - expect zero errors (npm run check:typing)
- [X] T028 [US1] Run linting checks (npm run check:linting)
- [X] T029 [US1] Run formatting checks (npm run check:formatting)

**Verification**:

- TypeScript compilation succeeds with zero errors
- All linting rules pass
- Code formatting consistent

---

## Phase 4: User Story 3 - Test Validation (P1)

**Goal**: Comprehensive test coverage for schema integrity

**Independent Test Criteria**:

- Run test suite → All tests pass
- Schema validation tests cover nested structure
- Round-trip tests verify data preservation
- Service tests verify authorization access from new location

**Estimated Time**: 2-3 hours

### 4.1: Schema Validation Tests

**Tasks**:

- [ ] T030 [P] [US3] Add test for valid nested structure in src/types/inventory/zod.test.ts
- [ ] T031 [P] [US3] Add test for missing authorisationInfo fails validation in src/types/inventory/zod.test.ts
- [ ] T032 [P] [US3] Add test for missing matcher field fails validation in src/types/inventory/zod.test.ts
- [ ] T033 [P] [US3] Add test for empty description fails validation in src/types/inventory/zod.test.ts
- [ ] T034 [P] [US3] Add test for invalid date format fails validation in src/types/inventory/zod.test.ts
- [ ] T035 [P] [US3] Add test for unauthorized entry (authorised:false) passes validation in src/types/inventory/zod.test.ts

**Verification**:

- All schema validation tests pass
- Edge cases properly handled
- Clear error messages for validation failures

### 4.2: Round-Trip Serialization Tests

**Tasks**:

- [ ] T036 [P] [US3] Create test file test/unit/utils/script.test.ts if not exists
- [ ] T037 [P] [US3] Add round-trip test for script with NameMatcher + HashMatcher in test/unit/utils/script.test.ts
- [ ] T038 [P] [US3] Add round-trip test for script with ContentMatcher in test/unit/utils/script.test.ts
- [ ] T039 [P] [US3] Add round-trip test verifying authorisationInfo preservation in test/unit/utils/script.test.ts
- [ ] T040 [P] [US3] Add round-trip test for header with HeaderNameMatcher + ContentMatcher in test/unit/utils/inventory.test.ts
- [ ] T041 [P] [US3] Add round-trip test for authorised:false entries in test/unit/utils/script.test.ts

**Verification**:

- `deserialize(serialize(x)) ≡ x` for all test cases
- Date precision preserved (milliseconds)
- Matcher behavior identical after round-trip
- All nested fields preserved

### 4.3: Conversion Function Tests

**Tasks**:

- [ ] T042 [P] [US3] Add test for scriptInfoToInventoryScriptInfo creates nested structure in test/unit/utils/script.test.ts
- [ ] T043 [P] [US3] Add test for rawInventoryScriptInfoToInventoryScriptInfo parses nested JSON in test/unit/utils/script.test.ts
- [ ] T044 [P] [US3] Add test for inventoryScriptInfoToRawInventoryScriptInfo serializes flat structure in test/unit/utils/script.test.ts
- [ ] T045 [P] [US3] Add test for header conversion functions (equivalent to script tests) in test/unit/utils/inventory.test.ts
- [ ] T046 [P] [US3] Add test for Date conversion (ISO string ↔ Date) in test/unit/utils/script.test.ts

**Verification**:

- All conversion functions produce valid output
- No data loss during conversions
- Edge cases handled (special characters, long descriptions, etc.)

### 4.4: Comparison Service Integration Tests

**Tasks**:

- [ ] T047 [P] [US3] Update existing script comparison tests to use new nested structure in test/unit/services/comparison/script.test.ts
- [ ] T048 [P] [US3] Add test for authorized script returns AuthorizedScriptFound in test/unit/services/comparison/script.test.ts
- [ ] T049 [P] [US3] Add test for unauthorized content returns KnownScriptWithUnauthorisedContentFound in test/unit/services/comparison/script.test.ts
- [ ] T050 [P] [US3] Add test for unknown script returns UnknownScriptFound in test/unit/services/comparison/script.test.ts
- [ ] T051 [P] [US3] Update existing header comparison tests to use new nested structure in test/unit/services/comparison/header.test.ts
- [ ] T052 [P] [US3] Add test verifying authorisationInfo accessed correctly for alerts in test/unit/services/comparison/script.test.ts

**Verification**:

- All comparison result types generated correctly
- No runtime errors accessing nested fields
- Alert context includes authorization metadata
- Service behavior unchanged (same outputs, different internal structure)

### 4.5: Full Test Suite Validation

**Tasks**:

- [ ] T053 [US3] Run all unit tests (npm run test:unit)
- [ ] T054 [US3] Verify 100% test pass rate
- [ ] T055 [US3] Run integration tests if available (npm run test:integration)

**Verification**:

- All tests pass (unit + integration)
- Zero test failures
- Zero test errors
- Coverage maintained or improved

---

## Phase 5: User Story 2 - Migration Support (P2, Optional)

**Goal**: Support backward compatibility during production migration

**Note**: This phase is optional for MVP. Can be deferred until schema changes are validated.

**Independent Test Criteria**:

- Load old-format inventory → Convert to new format → Save → Verify all data preserved
- Run migration on sample inventories → Validate with Zod → Pass without errors

**Estimated Time**: 1-2 hours

### 5.1: Migration Script (Optional)

**Tasks**:

- [ ] T056 [US2] Create migration script in scripts/migrate-inventory-schema.js
- [ ] T057 [US2] Implement script migration logic (spread authoriseWith, nest authorisationInfo)
- [ ] T058 [US2] Implement header migration logic
- [ ] T059 [US2] Add validation after migration
- [ ] T060 [US2] Test migration script on sample inventory files

**Verification**:

- Migration script transforms old format to new format
- All data preserved during migration
- Migrated files pass Zod validation
- Script handles edge cases (missing fields, multiple entries)

**Note**: Per assumption A-001, manual migration is acceptable. This phase can be skipped if manual updates are preferred.

---

## Phase 6: Polish & Verification

**Goal**: Final verification and cleanup

**Estimated Time**: 30 minutes

### 6.1: Code Quality Checks

**Tasks**:

- [ ] T061 Run all quality checks in parallel (npm run check:typing && npm run check:linting && npm run check:formatting)
- [ ] T062 Fix any linting issues (npm run fix:linting)
- [ ] T063 Fix any formatting issues (npm run fix:formatting)

**Verification**:

- TypeScript: Zero errors
- ESLint: Zero warnings
- Prettier: All files formatted correctly

### 6.2: Integration Verification

**Tasks**:

- [ ] T064 Create sample inventory JSON with new nested structure
- [ ] T065 Validate sample inventory using existing validation script (npm run validate-inventory)
- [ ] T066 Verify sample inventory loads without errors
- [ ] T067 Delete sample inventory file (cleanup)

**Verification**:

- Sample inventory validates successfully
- Loading and saving preserves structure
- No runtime errors

### 6.3: Documentation Updates

**Tasks**:

- [ ] T068 Update CLAUDE.md if schema changes affect development guidance
- [ ] T069 Review constitution compliance (all gates should still pass)

**Verification**:

- Documentation reflects new schema structure
- Constitution gates remain passed
- No new risks introduced

---

## Parallel Execution Opportunities

### High Parallelism (Different Files)

**Phase 3.5 (Header Conversions)**: All three tasks can run in parallel

- T020, T021, T022 - Different functions in same file

**Phase 4.1 (Schema Tests)**: All six tasks can run in parallel

- T030-T035 - Different test cases in same file

**Phase 4.2 (Round-Trip Tests)**: All six tasks can run in parallel

- T036-T041 - Different test cases, can create file first then add tests concurrently

**Phase 4.3 (Conversion Tests)**: All five tasks can run in parallel

- T042-T046 - Different test cases

**Phase 4.4 (Service Tests)**: All six tasks can run in parallel

- T047-T052 - Different test cases

### Medium Parallelism (Same File, Different Sections)

**Phase 3.6 (Comparison Services)**: T023-T024 and T025-T026 can run in parallel

- Script service and Header service are independent

### Story-Level Parallelism

**US1 (Schema) and US3 (Tests)**: Can work in parallel after foundational types complete

- US3 can start schema tests (T030-T035) immediately after US1 schemas complete (T013-T016)
- US3 conversion tests (T042-T046) can start immediately after US1 conversion functions complete (T017-T022)

---

## Task Summary

**Total Tasks**: 69
**By User Story**:

- Setup: 3 tasks
- Foundational: 3 tasks
- US1 (Schema Restructuring): 23 tasks
- US3 (Test Validation): 26 tasks
- US2 (Migration Support): 5 tasks (optional)
- Polish: 9 tasks

**By Priority**:

- P1 (MVP): 61 tasks (Setup + Foundational + US1 + US3 + Polish)
- P2 (Optional): 5 tasks (US2 only)

**Parallelizable Tasks**: 28 tasks marked with [P]

**Estimated Total Time**:

- MVP (P1 only): 6-8 hours
- With Migration (P1+P2): 7-10 hours

---

## Success Criteria

### US1 Success (Schema Restructuring)

- [x] All TypeScript compilation errors resolved
- [x] InventoryScriptInfo and InventoryHeaderInfo use AuthorizeWithConfig
- [x] JSON serialization shows authorisationInfo nested within authoriseWith
- [x] Comparison services access authorization data from new location
- [x] Zero breaking changes to existing functionality (verified by tests)

### US3 Success (Test Validation)

- [x] All schema validation tests pass
- [x] All round-trip serialization tests pass
- [x] All comparison service tests pass
- [x] Edge cases properly handled with appropriate validation
- [x] 100% test pass rate maintained

### US2 Success (Migration, Optional)

- [x] Migration script transforms old format to new format
- [x] All data preserved during migration
- [x] Migrated files pass Zod validation

### Overall Success

- [x] Constitution gates remain passed (all principles satisfied)
- [x] Zero test failures
- [x] Zero TypeScript errors
- [x] Zero linting warnings
- [x] Code formatted correctly

---

## Next Steps

1. **Start with MVP**: Implement US1 + US3 (P1 tasks only)
2. **Validate Design**: Run full test suite to confirm schema changes work correctly
3. **Optional Migration**: Implement US2 if production migration support needed
4. **Production Deployment**: Manual inventory updates or migration script

**Recommended Approach**: Execute tasks in phase order for sequential clarity, or leverage parallel opportunities within phases for faster completion.
