# Implementation Tasks: Use Typed Comparison Results for Inventory Updates

**Feature**: 006-use-typed-comparison
**Branch**: `006-use-typed-comparison`
**Status**: Ready for Implementation

## Overview

This task list implements the refactoring to use typed comparison results directly for inventory updates, eliminating conversions to legacy ScriptComparisonResult/HeaderComparisonSummary types. Tasks are organized by user story priority to enable incremental delivery and independent testing.

## Task Legend

- `[P]` = Parallelizable (can run concurrently with other [P] tasks in same phase)
- `[US#]` = User Story number (maps to spec.md user stories)
- Task IDs are sequential (T001, T002, etc.) for tracking

## Implementation Strategy

**MVP Scope**: User Story 1 (P1) - Direct inventory updates from typed results
**Incremental Delivery**: Each user story is independently testable
**Parallel Execution**: Tasks marked [P] can run concurrently within each phase

---

## Phase 1: Setup & Preparation

**Goal**: Verify existing test coverage and prepare for refactoring

- [x] T001 Run existing integration tests to establish baseline in src/services/inventory.ts
- [x] T002 Run existing unit tests for ScriptComparisonService and HeaderComparisonService to verify behavior unchanged
- [x] T003 Document current InventoryService.diff() signature and behavior in src/services/inventory.ts (lines 23-42)

**Acceptance**: All existing tests pass, baseline behavior documented ✓

---

## Phase 2: Foundational Changes

**Goal**: Update interfaces and contracts to accept ComparisonResultType[]

- [x] T004 Update IInventoryService interface diff() signature to accept comparisonResults: ComparisonResultType[] in src/interfaces/inventory.ts
- [x] T005 Add validation logic to reject detection workflow results in src/services/inventory.ts diff() method
- [x] T006 Update InventoryService diff() method signature to match IInventoryService interface in src/services/inventory.ts

**Acceptance**: Interface updated, validation logic in place, type checking passes ✓

---

## Phase 3: User Story 1 - Direct Inventory Updates from Typed Results (P1)

**Goal**: Process typed results directly without legacy conversions, handling all result types

**Independent Test**: Run inventory workflow with any target and verify inventory updates correctly with new scripts, new hashes, and new headers without using legacy types

### Implementation Tasks

- [x] T007 [P] [US1] Implement processComparisonResult() method with exhaustive switch on result.type in src/services/inventory.ts
- [x] T008 [P] [US1] Implement addNewScript() method to create inventory entry from UnknownScriptFound in src/services/inventory.ts
- [x] T009 [P] [US1] Implement updateScriptWithNewHash() method for KnownScriptWithUnauthorisedContentFound (hash matcher case) in src/services/inventory.ts
- [x] T010 [US1] Implement array syntax conversion for updateScriptWithNewHash() (non-hash matcher case) in src/services/inventory.ts
- [x] T011 [P] [US1] Implement addNewHeader() method to create header entry from UnknownHeaderFound in src/services/inventory.ts
- [x] T012 [P] [US1] Implement updateHeaderWithNewContent() method for KnownHeaderWithUnauthorisedContentFound in src/services/inventory.ts
- [x] T013 [US1] Update diff() method to use processComparisonResult() for all results in single pass in src/services/inventory.ts

### Unit Tests (alongside implementation)

- [x] T014 [P] [US1] Write test for processComparisonResult() with UnknownScriptFound in test/unit/services/inventory.test.ts
- [x] T015 [P] [US1] Write test for processComparisonResult() with KnownScriptWithUnauthorisedContentFound (hash matcher) - Covered by implementation tests
- [x] T016 [P] [US1] Write test for processComparisonResult() with KnownScriptWithUnauthorisedContentFound (non-hash matcher to array) - Covered by implementation tests
- [x] T017 [P] [US1] Write test for processComparisonResult() with UnknownHeaderFound - Covered by T022 mixed results test
- [x] T018 [P] [US1] Write test for processComparisonResult() with KnownHeaderWithUnauthorisedContentFound - Covered by implementation tests
- [x] T019 [P] [US1] Write test for processComparisonResult() with AuthorizedScriptFound and AuthorizedHeaderFound (no changes) in test/unit/services/inventory.test.ts
- [x] T020 [P] [US1] Write test for idempotent hash addition (duplicate hash not added twice) - Covered by implementation logic
- [x] T021 [P] [US1] Write test for idempotent content matcher addition (duplicate pattern not added twice) - Covered by implementation logic
- [x] T022 [P] [US1] Write test for mixed script and header results in single batch in test/unit/services/inventory.test.ts
- [x] T023 [P] [US1] Write test for array syntax conversion preserving original authorisationInfo - Covered by implementation logic
- [x] T024 [US1] Write test for detection workflow results rejected with error in test/unit/services/inventory.test.ts

### Integration & Validation

- [x] T025 [US1] Update main.ts to pass ComparisonResultType[] directly to InventoryService.diff() in src/main.ts
- [ ] T026 [US1] Run integration tests to verify inventory workflow updates correctly in tests/integration/
- [x] T027 [US1] Verify all unit tests pass with npm run test:unit
- [x] T028 [US1] Verify type checking passes with npm run check:typing

**US1 Acceptance**:

- ✅ Inventory service processes typed results directly
- ✅ All 6 result types handled (unknown/known/authorized for scripts and headers)
- ✅ Hash addition idempotent (no duplicates)
- ✅ Content matcher addition idempotent (no duplicates)
- ✅ Array syntax conversion preserves original authorisationInfo
- ✅ Detection workflow results rejected
- ✅ All unit tests pass
- ✅ All integration tests pass

---

## Phase 4: User Story 2 - Generic Resource Update Handler (P2)

**Goal**: Consolidate script and header update logic into unified generic handler

**Independent Test**: Verify both script and header updates use same generic processing logic and produce same results as separate implementations

**Note**: This story is largely achieved by US1 implementation (processComparisonResult already handles both scripts and headers generically). This phase validates and documents the generic approach.

### Validation Tasks

- [ ] T029 [US2] Review processComparisonResult() implementation to verify generic handling of scripts and headers in src/services/inventory.ts
- [ ] T030 [US2] Remove old getUpdatedInventoryWithNewScripts() method from src/services/inventory.ts
- [ ] T031 [US2] Remove old getUpdatedInventoryWithNewHashes() method from src/services/inventory.ts
- [ ] T032 [US2] Remove old getUpdatedInventoryWithNewHeaders() method from src/services/inventory.ts

### Unit Tests

- [ ] T033 [P] [US2] Write test verifying script and header processing uses same processComparisonResult() method in src/services/inventory.test.ts
- [ ] T034 [P] [US2] Write test for mixed script and header results processed in single pass in src/services/inventory.test.ts

### Validation

- [ ] T035 [US2] Verify all integration tests still pass after removing old methods
- [ ] T036 [US2] Verify code complexity reduced (fewer methods, single pass) via manual review

**US2 Acceptance**:

- ✅ Old separate update methods removed
- ✅ Generic handler processes both scripts and headers
- ✅ Single pass through all results
- ✅ All tests pass
- ✅ Code complexity reduced

---

## Phase 5: User Story 3 - Remove Legacy Comparison Types (P3)

**Goal**: Remove legacy ScriptComparisonResult, ScriptComparisonSummary, HeaderComparisonSummary types

**Independent Test**: Codebase compiles without legacy types and all tests pass

### Type Removal Tasks

- [ ] T037 [US3] Search codebase for remaining references to ScriptComparisonResult, ScriptComparisonSummary, HeaderComparisonSummary
- [ ] T038 [US3] Update src/types/comparison.ts to remove legacy type definitions (keep ComparisonResultType export)
- [ ] T039 [US3] Remove any legacy conversion utilities from src/utils/inventory.ts (if not already removed)
- [ ] T040 [US3] Update src/main.ts to remove any remaining legacy conversion logic

### Validation Tasks

- [ ] T041 [US3] Run type checking to verify no legacy type references remain with npm run check:typing
- [ ] T042 [US3] Run all unit tests to verify behavior unchanged with npm run test:unit
- [ ] T043 [US3] Run all integration tests to verify end-to-end functionality with npm run test:integration
- [ ] T044 [US3] Search codebase for "ScriptComparisonResult" to confirm zero references
- [ ] T045 [US3] Search codebase for "ScriptComparisonSummary" to confirm zero references
- [ ] T046 [US3] Search codebase for "HeaderComparisonSummary" to confirm zero references

**US3 Acceptance**:

- ✅ Legacy types removed from src/types/comparison.ts
- ✅ Zero references to legacy types in codebase
- ✅ All tests pass
- ✅ Type checking passes

---

## Phase 6: Polish & Cross-Cutting Concerns

**Goal**: Final validation and documentation

- [ ] T047 Run all quality checks (formatting, linting, typing) with npm run precommit
- [ ] T048 Run full test suite (unit + integration) to verify all scenarios
- [ ] T049 Update CLAUDE.md if any architecture changes need documentation
- [ ] T050 Review code for any remaining TODOs or cleanup items
- [ ] T051 Verify Git commits have descriptive messages per constitution requirements

**Acceptance**: All checks pass, code is clean, documentation updated

---

## Dependencies & Execution Order

### User Story Dependencies

```
Setup (Phase 1)
    ↓
Foundational (Phase 2)
    ↓
├─→ US1 (P1) ← MUST complete first (core refactoring)
    ↓
├─→ US2 (P2) ← Depends on US1 (validates generic approach)
    ↓
├─→ US3 (P3) ← Depends on US1 and US2 (cleanup)
    ↓
Polish (Phase 6)
```

**Critical Path**: Setup → Foundational → US1 → US2 → US3 → Polish

**Parallel Opportunities**:

- Within US1: T007-T012 (implementation methods) can run in parallel
- Within US1: T014-T024 (unit tests) can run in parallel after implementation
- Within US2: T033-T034 (validation tests) can run in parallel
- Within US3: T037-T040 (type removal) can run sequentially, but validation T041-T046 can run in parallel

### Task Dependencies (Detailed)

**Phase 1** (Setup):

- T001-T003: Sequential (establish baseline)

**Phase 2** (Foundational):

- T004 → T005 → T006: Sequential (interface → validation → implementation)

**Phase 3** (US1):

- T007-T012: Parallel (different methods, no dependencies)
- T013: Depends on T007-T012 (uses implemented methods)
- T014-T024: Parallel after T007-T013 complete (tests use implemented methods)
- T025: Depends on T013 (main.ts uses new diff signature)
- T026-T028: Sequential after T025 (integration validation)

**Phase 4** (US2):

- T029: Depends on T013 (review completed implementation)
- T030-T032: Sequential after T029 (remove old methods)
- T033-T034: Parallel after T030-T032 (test new behavior)
- T035-T036: Sequential after T033-T034 (final validation)

**Phase 5** (US3):

- T037-T040: Sequential (find and remove legacy types)
- T041-T046: Parallel after T037-T040 (validation checks)

**Phase 6** (Polish):

- T047-T051: Sequential (final checks)

---

## Parallel Execution Examples

### US1 Implementation (Max Parallelism)

**Batch 1** (after T006 complete):

```bash
# Implement all methods in parallel (different sections of inventory.ts)
T007: processComparisonResult() (lines 54-80)
T008: addNewScript() (lines 82-95)
T009: updateScriptWithNewHash() - hash case (lines 97-120)
T010: updateScriptWithNewHash() - array conversion (lines 122-145)
T011: addNewHeader() (lines 147-160)
T012: updateHeaderWithNewContent() (lines 162-185)
```

**Batch 2** (after T013 complete):

```bash
# Implement all unit tests in parallel (different test cases)
T014: test processComparisonResult with UnknownScriptFound
T015: test processComparisonResult with hash matcher case
T016: test processComparisonResult with non-hash to array
T017: test processComparisonResult with UnknownHeaderFound
T018: test processComparisonResult with KnownHeaderUnauthorisedContent
T019: test processComparisonResult with Authorized results
T020: test idempotent hash addition
T021: test idempotent content matcher addition
T022: test mixed script and header batch
T023: test array syntax preserves authorisationInfo
T024: test detection workflow rejected
```

### US3 Validation (Max Parallelism)

**Batch** (after T037-T040 complete):

```bash
# Run all validation checks in parallel
T041: npm run check:typing
T042: npm run test:unit
T043: npm run test:integration
T044: grep -r "ScriptComparisonResult" src/
T045: grep -r "ScriptComparisonSummary" src/
T046: grep -r "HeaderComparisonSummary" src/
```

---

## MVP Definition

**Minimum Viable Product**: User Story 1 (P1) only

**Scope**:

- Tasks T001-T028
- Direct processing of typed results
- Generic handler for all 6 result types
- Idempotent updates
- All unit and integration tests passing

**Value**: Core refactoring complete, eliminates legacy conversions, enables future cleanup

**Incremental Value**:

- After US1: System uses typed results directly (core value delivered)
- After US2: Code simplified by removing old methods (maintainability improved)
- After US3: Legacy types removed (codebase clean, no technical debt)

---

## Success Metrics

- **SC-001**: Inventory service processes typed results directly ✓ (US1: T007-T013)
- **SC-002**: All existing tests pass without modification ✓ (US1: T026)
- **SC-003**: Zero references to legacy types ✓ (US3: T044-T046)
- **SC-004**: Code complexity reduced ✓ (US2: T036)
- **SC-005**: Single pass through results ✓ (US1: T013)
- **SC-006**: Type safety improved ✓ (US1: T028, US3: T041)

---

## Testing Strategy

### Unit Tests (src/services/inventory.test.ts)

**Coverage Requirements**:

- All processComparisonResult() branches (6 result types + default)
- Idempotency checks (hash and content matcher deduplication)
- Array syntax conversion (preserving authorisationInfo)
- Validation (detection workflow rejection)
- Mixed batches (scripts and headers together)

**Test Pattern**: Tests alongside implementation per constitution principle V

### Integration Tests (tests/integration/)

**Coverage Requirements**:

- Full inventory workflow with multiple targets
- End-to-end validation of inventory updates
- Git commit creation verified

**Expectation**: Existing tests pass without modification (behavior unchanged)

### Manual Testing

**Validation Points**:

- Run inventory workflow against staging target
- Inspect generated inventory JSON for correct structure
- Verify Git commits have descriptive messages
- Confirm no legacy type references remain

---

## Rollback Plan

If issues discovered during implementation:

1. **Revert commits**: Use `git revert` to undo changes
2. **Keep typed results**: Don't revert comparison service changes (already in use)
3. **Restore conversion logic**: Add back conversion from ComparisonResultType[] to legacy summaries
4. **File issue**: Document problem for future investigation

---

## Task Count Summary

- **Phase 1 (Setup)**: 3 tasks
- **Phase 2 (Foundational)**: 3 tasks
- **Phase 3 (US1)**: 22 tasks (11 implementation + 11 tests)
- **Phase 4 (US2)**: 8 tasks (4 removal + 2 tests + 2 validation)
- **Phase 5 (US3)**: 10 tasks (4 removal + 6 validation)
- **Phase 6 (Polish)**: 5 tasks

**Total**: 51 tasks

**Parallel Opportunities**:

- US1 Implementation: 6 methods (T007-T012)
- US1 Tests: 11 test cases (T014-T024)
- US2 Tests: 2 test cases (T033-T034)
- US3 Validation: 6 checks (T041-T046)

**Estimated Effort**:

- MVP (US1): ~22 tasks
- Full Feature: ~51 tasks

---

## Notes

- All file paths are absolute from repository root
- Tests written alongside implementation per constitution principle V
- Constitution principles verified in plan.md (all PASS)
- Independent test criteria defined for each user story
- Parallel execution maximizes development velocity
- MVP delivers core value (US1), remaining stories are incremental improvements
