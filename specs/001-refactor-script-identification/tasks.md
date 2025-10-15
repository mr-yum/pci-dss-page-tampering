---
description: "Task list for Script Identification and Authorisation Refactor"
---

# Tasks: Script Identification and Authorisation Refactor

**Input**: Design documents from `/specs/001-refactor-script-identification/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: This feature includes comprehensive test coverage per Constitution Refactoring Protocol and FR-012 (independent testability).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `- [ ] [ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Single project**: `src/`, at repository root (no `tests/` directory - tests colocated with source files)
- Paths follow existing codebase structure

---

## Phase 1: Setup & Pre-Refactoring Tests

**Purpose**: Capture current behavior before refactoring (Constitution Refactoring Protocol step 1)

**⚠️ CRITICAL**: Write tests that CAPTURE CURRENT BEHAVIOR and verify they PASS before any refactoring

- [X] T001 Create test file for current ScriptComparisonService behavior in src/services/comparison/script.test.ts
- [X] T002 [P] Add test case: external script with exact URL match and hash verification
- [X] T003 [P] Add test case: external script with dynamic query parameters (nameMatcher with wildcard)
- [X] T004 [P] Add test case: inline script identified by content pattern
- [X] T005 [P] Add test case: script found in inventory but hash doesn't exist (should return newHash)
- [X] T006 [P] Add test case: script not in inventory (should return newScript)
- [X] T007 [P] Add test case: authorized script with contentMatcher authorization (no hash check)
- [X] T008 [P] Add test case: first-match-wins with overlapping name patterns
- [X] T009 Run all pre-refactoring tests and verify they PASS with current implementation (green baseline)

**Checkpoint**: Pre-refactoring test suite passes - current behavior captured ✅

---

## Phase 2: Foundational (Matcher Infrastructure)

**Purpose**: Create matcher abstraction and implementations that MUST be complete before user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Core Matcher Types

- [ ] T010 Create Matcher interface in src/types/matcher/matcher.interface.ts with identify(), authorize(), getType(), and getPattern() methods
- [ ] T011 Create AuthorizationResult type in src/types/matcher/authorization-result.ts with authorized flag and optional reason field
- [ ] T012 Create Hash type export in src/types/hash.ts (if not already exported) for matcher usage
- [ ] T013 Create DetectedScript type in src/types/script.ts with name, content, hash, and context fields

### Matcher Implementations

- [ ] T014 [P] Implement NameMatcher class in src/types/matcher/name-matcher.ts with regex pattern matching on script.name
- [ ] T015 [P] Implement ContentMatcher class in src/types/matcher/content-matcher.ts with regex pattern matching on script.content and null/empty content handling
- [ ] T016 [P] Implement HashMatcher class in src/types/matcher/hash-matcher.ts with SHA-256 hash comparison against authorized hash array
- [ ] T017 Create matcher factory function in src/types/matcher/matcher-factory.ts that creates matcher instances from MatcherConfig

### Unit Tests for Matchers

- [ ] T018 [P] Create NameMatcher unit tests in src/types/matcher/name-matcher.test.ts covering exact URL match, wildcard patterns, non-matching URLs, null/empty names
- [ ] T019 [P] Create ContentMatcher unit tests in src/types/matcher/content-matcher.test.ts covering exact content match, regex patterns, null/empty content, multi-line content
- [ ] T020 [P] Create HashMatcher unit tests in src/types/matcher/hash-matcher.test.ts covering single hash match, multiple hashes, no match, null content
- [ ] T021 Run all matcher unit tests and verify they PASS independently (matcher isolation verified)

**Checkpoint**: Foundation ready - matcher system fully tested and operational ✅

---

## Phase 3: User Story 1 - Flexible Script Matching (Priority: P1) 🎯 MVP

**Goal**: Separate script identification from authorization using different matching strategies per inventory entry

**Independent Test**: Process an inventory containing scripts with different matcher combinations (nameMatcher+hashes, contentMatcher+hashes, nameMatcher+contentMatcher) and verify correct identification and authorization

### Zod Schema Updates for User Story 1

- [ ] T022 [P] [US1] Create MatcherConfig union type schema in src/types/inventory/matcher-config-schema.ts with nameMatcher, contentMatcher, and hashes variants
- [ ] T023 [P] [US1] Add regex validation custom refinement to MatcherConfig schema with detailed error messages showing pattern and error location
- [ ] T024 [US1] Update ScriptInventoryEntry schema in src/types/inventory/zod.ts to replace nameMatcher/contentMatcher/hashes fields with identifyWith and authoriseWith MatcherConfig fields
- [ ] T025 [US1] Update RawInventoryScriptInfoSchema in src/types/inventory/zod.ts to use new schema structure
- [ ] T026 [US1] Update InventoryScriptInfo type in src/types/inventory/model.ts to include identifyWith and authoriseWith as Matcher instances instead of raw regex

### Schema Validation Tests

- [ ] T027 [P] [US1] Create Zod schema validation tests in src/types/inventory/zod.test.ts covering invalid regex patterns, missing identifyWith/authoriseWith fields, empty hashes array
- [ ] T028 [P] [US1] Add test case: old schema format (without identifyWith/authoriseWith) should fail with clear error message
- [ ] T029 [P] [US1] Add test case: valid schema with nameMatcher for identify and hashes for authorize
- [ ] T030 [P] [US1] Add test case: valid schema with same matcher type for both identifyWith and authoriseWith
- [ ] T031 [US1] Run schema validation tests and verify all edge cases are detected correctly

### Repository Layer Updates

- [ ] T032 [US1] Update InventoryRepository in src/repositories/inventory.ts to parse new schema and create Matcher instances from MatcherConfig using matcher factory
- [ ] T033 [US1] Update GitInventoryStore in src/stores/inventory/git.ts to handle Zod validation errors and provide context about which inventory file failed
- [ ] T034 [US1] Update InMemoryInventoryStore in src/stores/inventory/in-memory.ts to use new schema structure for test fixtures

**Checkpoint**: At this point, User Story 1 schema updates are complete - inventories can be loaded with new matcher structure ✅

---

## Phase 4: User Story 2 - Modular Matcher System (Priority: P2)

**Goal**: Refactor ScriptComparisonService to use matcher pipeline, enabling extensibility without modifying core comparison logic

**Independent Test**: Add a new matcher type (e.g., SizeMatcher for testing) and verify it integrates without requiring changes to comparison service orchestration

### Comparison Service Refactoring

- [ ] T035 [US2] Refactor ScriptComparisonService.compareSingleScriptWithInventory() in src/services/comparison/script.ts to use matcher pipeline for identification (iterate inventory.scripts, call identifyWith.identify())
- [ ] T036 [US2] Update ScriptComparisonService to implement first-match-wins logic (return first inventory entry where identifyWith.identify() returns true)
- [ ] T037 [US2] Refactor authorization logic in ScriptComparisonService to call authoriseWith.authorize() on matched inventory entry
- [ ] T038 [US2] Add null/empty content handling in ScriptComparisonService (treat as newScript per clarification Q3)
- [ ] T039 [US2] Remove hardcoded nameMatcher.test() and contentMatcher?.test() logic from private methods (replaced by matcher abstraction)
- [ ] T040 [US2] Add matcher execution logging with matcher type, pattern, result, and execution time in ScriptComparisonService

### Refactoring Verification Tests

- [ ] T041 [US2] Run all pre-refactoring tests (T001-T009) and verify they still PASS with refactored implementation (zero behavior change)
- [ ] T042 [P] [US2] Add integration test for matcher pipeline in src/services/comparison/script.test.ts covering identification → authorization flow
- [ ] T043 [P] [US2] Add integration test for first-match-wins with multiple overlapping inventory entries
- [ ] T044 [P] [US2] Add integration test for null content handling (should return newScript)
- [ ] T045 [US2] Run all comparison service tests and verify matcher pipeline produces identical results to original implementation

### Interface Updates

- [ ] T046 [US2] Update IScriptComparisonService interface in src/interfaces/comparison.ts if method signatures changed (likely no changes needed)
- [ ] T047 [US2] Update ScriptComparisonResult type in src/types/comparison.ts to include matcher execution context if needed for logging

**Checkpoint**: At this point, User Story 2 is complete - matcher system is fully modular and independently testable ✅

---

## Phase 5: User Story 3 - Typed Comparison Results (Priority: P3)

**Goal**: Replace generic comparison results with typed result classes containing complete context for handlers

**Independent Test**: Trigger each comparison result type and verify handler receives complete context without additional lookups

### Typed Result Classes

- [ ] T048 [P] [US3] Create ComparisonResult abstract base class in src/types/comparison/comparison-result.ts with type discriminator, target, and timestamp fields
- [ ] T049 [P] [US3] Create UnknownScriptFound result class in src/types/comparison/unknown-script-found.ts extending ComparisonResult with script details
- [ ] T050 [P] [US3] Create KnownScriptWithUnauthorisedContentFound result class in src/types/comparison/known-script-unauthorised-content-found.ts with script, inventoryEntry, authorizationMatcher, and failureReason fields
- [ ] T051 [P] [US3] Create AuthorizedScriptFound result class in src/types/comparison/authorized-script-found.ts with script and inventoryEntry fields
- [ ] T052 [US3] Create ComparisonResultType union type in src/types/comparison/index.ts exporting all result classes

### Comparison Service Return Type Update

- [ ] T053 [US3] Update ScriptComparisonService.compare() in src/services/comparison/script.ts to return Array<ComparisonResultType> instead of ScriptComparisonSummary
- [ ] T054 [US3] Update ScriptComparisonService.compareSingleScriptWithInventory() to return ComparisonResultType instead of {isNewScript, isNewHash}
- [ ] T055 [US3] Update comparison logic to instantiate UnknownScriptFound when script not in inventory
- [ ] T056 [US3] Update comparison logic to instantiate KnownScriptWithUnauthorisedContentFound when authorization fails (include failureReason from AuthorizationResult)
- [ ] T057 [US3] Update comparison logic to instantiate AuthorizedScriptFound when script is fully compliant

### Handler Updates to Consume Typed Results

- [ ] T058 [US3] Update ScriptResponseHandler in src/handlers/script.ts to accept Array<ComparisonResultType> instead of ScriptComparisonSummary
- [ ] T059 [US3] Refactor ScriptResponseHandler.handle() to switch on result.type and route to appropriate alert method
- [ ] T060 [US3] Update alert generation in ScriptResponseHandler to use result context (script, inventoryEntry, failureReason) without additional queries
- [ ] T061 [US3] Update DetectionService in src/services/detection.ts to handle Array<ComparisonResultType> return type from comparison service

### Alert Service Context Updates

- [ ] T062 [US3] Update SlackAlertService in src/services/alert/slack.ts to accept typed result context in alert payload (script details, matcher info, failure reason)
- [ ] T063 [US3] Enhance alert messages with matcher details (which matcher failed, pattern/hashes, why it failed) for debugging and incident response

### Typed Result Tests

- [ ] T064 [P] [US3] Create typed result tests in src/types/comparison/comparison-result.test.ts verifying each result type contains complete context
- [ ] T065 [P] [US3] Add integration test for UnknownScriptFound alert flow in src/handlers/script.test.ts
- [ ] T066 [P] [US3] Add integration test for KnownScriptWithUnauthorisedContentFound alert flow in src/handlers/script.test.ts
- [ ] T067 [P] [US3] Add integration test for AuthorizedScriptFound (no alert generated) in src/handlers/script.test.ts
- [ ] T068 [US3] Run all handler and service tests to verify typed results provide sufficient context with zero additional lookups

**Checkpoint**: All user stories should now be independently functional - typed results provide complete context to handlers ✅

---

## Phase 6: Migration Documentation & Validation

**Purpose**: Ensure smooth transition for existing inventories

- [ ] T069 [P] Verify quickstart.md migration guide is accurate and complete (already exists in design docs)
- [ ] T070 [P] Create inventory schema migration validation script in src/utils/inventory/validate-migration.ts that runs Zod schema validation
- [ ] T071 Test migration validation script against example old and new inventory formats
- [ ] T072 Update README.md with migration instructions and link to quickstart.md
- [ ] T073 Create example inventory files in specs/001-refactor-script-identification/examples/ demonstrating all matcher combinations

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements affecting multiple components

- [ ] T074 [P] Run type checking (npm run check:typing) and resolve any TypeScript errors
- [ ] T075 [P] Run linting (npm run check:linting) and fix any ESLint issues
- [ ] T076 [P] Run formatting (npm run fix:formatting) to ensure code consistency
- [ ] T077 Run all unit tests (npm run test:unit) and verify 100% pass rate
- [ ] T078 Review code coverage report and ensure >90% coverage for matcher implementations and comparison service per plan.md
- [ ] T079 [P] Add JSDoc comments to all new matcher classes and comparison result types
- [ ] T080 [P] Update architecture documentation in CLAUDE.md to reflect new matcher system
- [ ] T081 Perform security review: verify hash verification unchanged, alert coverage maintained, no security regressions
- [ ] T082 Run quickstart.md validation scenarios to verify migration guide is executable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup & Pre-Refactoring Tests (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion - Schema updates enable matcher loading
- **User Story 2 (Phase 4)**: Depends on Phase 3 completion - Requires matcher instances from updated schema
- **User Story 3 (Phase 5)**: Depends on Phase 4 completion - Requires refactored comparison service using matchers
- **Migration Documentation (Phase 6)**: Can run in parallel with Phase 5
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Schema changes independent of other stories
- **User Story 2 (P2)**: DEPENDS ON User Story 1 - Requires matcher instances from new schema
- **User Story 3 (P3)**: DEPENDS ON User Story 2 - Requires refactored comparison service

### Within Each User Story

- **User Story 1**: Schema updates → validation tests → repository updates
- **User Story 2**: Comparison refactoring → verification tests → interface updates
- **User Story 3**: Typed result classes → service updates → handler updates → alert updates

### Parallel Opportunities

- **Phase 1**: T002-T008 (all pre-refactoring tests can be written in parallel)
- **Phase 2**: T014-T016 (matcher implementations), T018-T020 (matcher tests)
- **Phase 3**: T022-T023 (schema updates to different files), T027-T030 (validation tests)
- **Phase 4**: T042-T044 (integration tests)
- **Phase 5**: T048-T051 (typed result class implementations), T064-T067 (typed result tests)
- **Phase 7**: T074-T076 (code quality checks), T079-T080 (documentation)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all matcher implementations together (different files):
Task: "Implement NameMatcher class in src/types/matcher/name-matcher.ts"
Task: "Implement ContentMatcher class in src/types/matcher/content-matcher.ts"
Task: "Implement HashMatcher class in src/types/matcher/hash-matcher.ts"

# After implementations complete, launch all matcher tests together:
Task: "Create NameMatcher unit tests in src/types/matcher/name-matcher.test.ts"
Task: "Create ContentMatcher unit tests in src/types/matcher/content-matcher.test.ts"
Task: "Create HashMatcher unit tests in src/types/matcher/hash-matcher.test.ts"
```

---

## Parallel Example: Phase 5 (User Story 3)

```bash
# Launch all typed result class implementations together (different files):
Task: "Create UnknownScriptFound result class in src/types/comparison/unknown-script-found.ts"
Task: "Create KnownScriptWithUnauthorisedContentFound result class in src/types/comparison/known-script-unauthorised-content-found.ts"
Task: "Create AuthorizedScriptFound result class in src/types/comparison/authorized-script-found.ts"

# Launch all typed result tests together:
Task: "Add integration test for UnknownScriptFound alert flow in src/handlers/script.test.ts"
Task: "Add integration test for KnownScriptWithUnauthorisedContentFound alert flow in src/handlers/script.test.ts"
Task: "Add integration test for AuthorizedScriptFound in src/handlers/script.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup & Pre-Refactoring Tests
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Schema updates)
4. Complete Phase 4: User Story 2 (Matcher pipeline refactoring)
5. **STOP and VALIDATE**: Run all tests, verify zero regressions, test against staging inventory
6. Deploy/demo if ready (matcher system fully functional)

### Incremental Delivery

1. Complete Setup + Foundational → Matcher infrastructure ready
2. Add User Story 1 → Schema updates enable new inventory format
3. Add User Story 2 → Test independently with refactored comparison service → Deploy/Demo (MVP!)
4. Add User Story 3 → Test typed results independently → Deploy/Demo (Enhanced alerts!)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Phase 1 + 2 together (foundational work)
2. Once Phase 2 is done:
   - Developer A: User Story 1 (schema updates)
   - Developer B: Begin planning User Story 2 (review matcher interfaces)
3. After User Story 1 completes:
   - Developer A: User Story 3 (typed results)
   - Developer B: User Story 2 (comparison refactoring)
4. Stories integrate sequentially (US1 → US2 → US3)

---

## Notes

- **[P] tasks** = different files, no dependencies - can run in parallel
- **[Story] label** maps task to specific user story for traceability
- **Test-first approach**: Pre-refactoring tests (Phase 1) capture current behavior BEFORE any changes
- **Zero regressions**: All pre-refactoring tests must pass after refactoring (T041)
- **Matcher independence**: Each matcher type must be testable without full workflow execution (FR-012)
- **Schema validation**: All regex patterns validated at Zod schema level (FR-010)
- **Fail-secure**: Null/empty content treated as UnknownScriptFound (clarification Q3)
- **First-match-wins**: Inventory array iteration order determines precedence (clarification Q1)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, breaking existing behavior

---

## Summary

- **Total tasks**: 82
- **Phase 1 (Setup)**: 9 tasks - Pre-refactoring test baseline
- **Phase 2 (Foundational)**: 12 tasks - Matcher infrastructure (BLOCKS all user stories)
- **Phase 3 (User Story 1)**: 13 tasks - Schema updates for flexible matching
- **Phase 4 (User Story 2)**: 13 tasks - Modular matcher pipeline
- **Phase 5 (User Story 3)**: 21 tasks - Typed comparison results
- **Phase 6 (Migration)**: 5 tasks - Documentation and validation
- **Phase 7 (Polish)**: 9 tasks - Code quality and security review

**Parallel opportunities**: 32 tasks marked [P] can run concurrently
**Independent test criteria**:
- User Story 1: Load inventory with new schema, verify matchers created correctly
- User Story 2: Add test matcher type, verify integration without code changes
- User Story 3: Trigger each result type, verify complete context in handlers

**Suggested MVP scope**: Phase 1 + 2 + 3 + 4 (Foundational + User Stories 1-2) = Core matcher system with refactored comparison service

---

## Validation Checklist

Before deployment:

- [ ] All 82 tasks completed
- [ ] All pre-refactoring tests still pass (zero regressions)
- [ ] >90% code coverage for matchers and comparison service
- [ ] Schema validation detects all invalid configurations
- [ ] Typed results contain sufficient context (no additional queries in handlers)
- [ ] Migration guide tested against real inventory
- [ ] Security review confirms zero regressions (hash verification, alert coverage)
- [ ] Staging deployment successful with migrated inventory
- [ ] Production alerts match expected behavior for 24 hours post-deployment
