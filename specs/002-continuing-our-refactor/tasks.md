# Tasks: Header Comparison and Alert Refactor

**Input**: Design documents from `/specs/002-continuing-our-refactor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Constitution requires comprehensive test coverage (Principle V). All test tasks are REQUIRED per the constitution and testing strategy (research.md R9).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Project type: Single project (backend monitoring service)
- Source: `src/` at repository root
- Tests: `test/` at repository root
- Constitution requires test coverage for all security logic

---

## Phase 1: Setup (Not Applicable)

**Purpose**: This is a refactor of an existing system. No project setup required.

**Status**: ✅ Complete - Project structure already exists

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and base types that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Base Type Infrastructure

- [ ] T001 [P] Define DetectedHeader interface in src/types/header.ts with properties: name (string), value (string), target (Target), workflow (string)
- [ ] T002 [P] Update ComparisonResultType union in src/types/comparison/index.ts to prepare for header result types (add placeholder comment for header types)

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Typed Header Comparison Results (Priority: P1) 🎯 MVP

**Goal**: Implement typed comparison results for headers (UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound) with complete context for alert handlers

**Independent Test**: Can be fully tested by processing a header detection summary against an inventory and verifying each header generates the appropriate typed result with complete context

### Tests for User Story 1 (REQUIRED per Constitution Principle V)

**NOTE: Write these tests FIRST per refactoring protocol (research.md R9), ensure they FAIL before implementation**

- [ ] T003 [P] [US1] Write unit test for UnknownHeaderFound class instantiation and properties in test/unit/types/comparison/unknown-header-found.test.ts
- [ ] T004 [P] [US1] Write unit test for KnownHeaderWithUnauthorisedContentFound class with all required fields in test/unit/types/comparison/known-header-unauthorised-content-found.test.ts
- [ ] T005 [P] [US1] Write unit test for AuthorizedHeaderFound class with inventory entry in test/unit/types/comparison/authorized-header-found.test.ts
- [ ] T006 [US1] Write unit tests for HeaderComparisonService returning typed results in test/unit/services/comparison/header.test.ts - test cases: unknown header, known header with unauthorized content, authorized header
- [ ] T007 [US1] Write unit test for HeaderComparisonService case-insensitive name matching in test/unit/services/comparison/header.test.ts - verify "Content-Type" matches "content-type"
- [ ] T008 [US1] Write unit test for HeaderComparisonService case-sensitive value matching in test/unit/services/comparison/header.test.ts - verify "DENY" does not match "deny"
- [ ] T009 [US1] Write unit test for HeaderComparisonService first-match-wins logic in test/unit/services/comparison/header.test.ts - verify first inventory entry wins when patterns overlap
- [ ] T010 [US1] Write unit test for HeaderComparisonService empty value handling in test/unit/services/comparison/header.test.ts - verify empty string "" is valid input
- [ ] T011 [US1] Write unit test for HeaderComparisonService multiple values generating multiple results in test/unit/services/comparison/header.test.ts - verify header with 3 values produces 3 separate results

**Run tests - ALL MUST FAIL at this point (no implementation yet)**

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create UnknownHeaderFound class in src/types/comparison/unknown-header-found.ts extending ComparisonResult with type="unknown_header_found", header property
- [ ] T013 [P] [US1] Create KnownHeaderWithUnauthorisedContentFound class in src/types/comparison/known-header-unauthorised-content-found.ts extending ComparisonResult with type="known_header_unauthorised_content", header, inventoryEntry, authorizationMatcher, failureReason properties
- [ ] T014 [P] [US1] Create AuthorizedHeaderFound class in src/types/comparison/authorized-header-found.ts extending ComparisonResult with type="authorized_header", header, inventoryEntry properties
- [ ] T015 [US1] Update ComparisonResultType union in src/types/comparison/index.ts to include UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound
- [ ] T016 [US1] Export new header result types from src/types/comparison/index.ts
- [ ] T017 [US1] Update IHeaderComparisonService interface in src/interfaces/comparison.ts to return Promise<ComparisonResultType[]> instead of Promise<HeaderComparisonSummary>
- [ ] T018 [US1] Refactor HeaderComparisonService.compare() in src/services/comparison/header.ts to iterate over header Map entries and expand Set<values> to individual DetectedHeader instances (one result per value per BR-1 in data-model.md)
- [ ] T019 [US1] Implement compareSingleHeader() private method in src/services/comparison/header.ts with logic: normalize name to lowercase, find matching inventory entry (first-match-wins), create appropriate typed result
- [ ] T020 [US1] Implement findMatchingInventoryEntry() private method in src/services/comparison/header.ts with first-match-wins logic iterating inventory entries in array order
- [ ] T021 [US1] Add logging to HeaderComparisonService in src/services/comparison/header.ts for identification and authorization results (matcher type, pattern, success/failure, timing)
- [ ] T022 [US1] Handle empty string values in HeaderComparisonService in src/services/comparison/header.ts - do NOT skip, pass to ContentMatcher per BR-5 in data-model.md

**Run tests - ALL MUST PASS at this point (implementation complete for US1)**

**Checkpoint**: At this point, User Story 1 should be fully functional - HeaderComparisonService returns typed results with complete context. Test independently before proceeding to US2.

---

## Phase 4: User Story 2 - Alert Service Leveraging Typed Results (Priority: P2)

**Goal**: Migrate alert service to unified typed handler processing both script and header results, removing legacy alert methods

**Independent Test**: Can be tested by triggering each comparison result type (for both scripts and headers) and verifying alerts are routed correctly with complete context and no legacy methods invoked

**Dependency**: Requires US1 completion (header result types must exist)

### Tests for User Story 2 (REQUIRED per Constitution Principle V)

- [ ] T023 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling UnknownHeaderFound in test/unit/services/alert/slack.test.ts - verify alert category is workflow-appropriate (newHeaderIdentified vs uninventoriedHeaderDetected)
- [ ] T024 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling KnownHeaderWithUnauthorisedContentFound in test/unit/services/alert/slack.test.ts - verify alert includes matcher details and failure reason
- [ ] T025 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling AuthorizedHeaderFound in test/unit/services/alert/slack.test.ts - verify no alert generated
- [ ] T026 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling all script result types in test/unit/services/alert/slack.test.ts - verify scripts still work after header support added
- [ ] T027 [US2] Write unit test for SlackAlertService.alertForTypedResults switch statement exhaustive checking in test/unit/services/alert/slack.test.ts - verify TypeScript never type catches missing cases

**Run tests - ALL MUST FAIL at this point (no implementation yet)**

### Implementation for User Story 2

- [ ] T028 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'unknown_header_found' calling alertForUnknownHeader()
- [ ] T029 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'known_header_unauthorised_content' calling alertForKnownHeaderUnauthorised()
- [ ] T030 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'authorized_header' with no-op (no alert)
- [ ] T031 [P] [US2] Implement alertForUnknownHeader() private method in src/services/alert/slack.ts with workflow-based routing (inventory → newHeaderIdentified, detection → uninventoriedHeaderDetected)
- [ ] T032 [P] [US2] Implement alertForKnownHeaderUnauthorised() private method in src/services/alert/slack.ts including matcher pattern and failure reason in alert
- [ ] T033 [US2] Add try-catch to each case in SlackAlertService.alertForTypedResults() in src/services/alert/slack.ts to log errors without blocking (per constitution principle IV)
- [ ] T034 [US2] Update InventoryService in src/services/inventory.ts to call alertForTypedResults() with header comparison results from HeaderComparisonService
- [ ] T035 [US2] Update DetectionService in src/services/detection.ts to call alertForTypedResults() with header comparison results from HeaderComparisonService
- [ ] T036 [US2] Mark alertForScripts() method as @deprecated in src/services/alert/slack.ts with comment "Use alertForTypedResults instead"
- [ ] T037 [US2] Mark alertForHeaders() method as @deprecated in src/services/alert/slack.ts with comment "Use alertForTypedResults instead"

**Run tests - ALL MUST PASS at this point (implementation complete for US2)**

### Verification and Cleanup for User Story 2

- [ ] T038 [US2] Run integration tests to verify no regressions in script alerting after header support added - confirm alerts still generated correctly
- [ ] T039 [US2] Run integration tests with header violations to verify alert routing works correctly - test both inventory and detection workflows
- [ ] T040 [US2] Verify no references to legacy alertForScripts method - run grep -r "alertForScripts" src/ (should find only deprecation marker)
- [ ] T041 [US2] Verify no references to legacy alertForHeaders method - run grep -r "alertForHeaders" src/ (should find only deprecation marker)
- [ ] T042 [US2] Remove alertForScripts() method from src/services/alert/slack.ts after confirming all callers migrated
- [ ] T043 [US2] Remove alertForHeaders() method from src/services/alert/slack.ts after confirming all callers migrated
- [ ] T044 [US2] Update IAlertService interface in src/interfaces/alert.ts to remove alertForScripts and alertForHeaders method signatures

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - all alerts flow through unified typed handler. Test independently before proceeding to US3.

---

## Phase 5: User Story 3 - Header Matcher Architecture (Priority: P3)

**Goal**: Apply Matcher interface pattern to headers with InventoryHeaderInfo schema using identifyWith (NameMatcher) and authoriseWith (ContentMatcher)

**Independent Test**: Can be tested by configuring inventory entries with HeaderMatcher instances and verifying the comparison service correctly identifies and authorizes headers using the matcher pattern

**Dependency**: Requires US1 completion (header comparison service must be using typed results)

### Tests for User Story 3 (REQUIRED per Constitution Principle V)

- [ ] T045 [P] [US3] Write unit test for InventoryHeaderInfo Zod schema validation in test/unit/types/inventory/header-entry.test.ts - verify identifyWith must be NameMatcher
- [ ] T046 [P] [US3] Write unit test for InventoryHeaderInfo Zod schema validation in test/unit/types/inventory/header-entry.test.ts - verify authoriseWith must be ContentMatcher
- [ ] T047 [US3] Write unit test for HeaderComparisonService using NameMatcher.identify() in test/unit/services/comparison/header.test.ts - verify matcher's identify method called instead of inline regex
- [ ] T048 [US3] Write unit test for HeaderComparisonService using ContentMatcher.authorize() in test/unit/services/comparison/header.test.ts - verify matcher's authorize method called instead of inline content validation
- [ ] T049 [US3] Write unit test for HeaderComparisonService logging matcher type and pattern on failure in test/unit/services/comparison/header.test.ts - verify debug information includes getType() and getPattern()

**Run tests - WILL FAIL initially, PASS after implementation**

### Implementation for User Story 3

- [ ] T050 [P] [US3] Define InventoryHeaderInfo Zod schema in src/types/inventory/header-entry.ts with identifyWith (MatcherSchema), authoriseWith (MatcherSchema), authorisationInfo fields
- [ ] T051 [P] [US3] Export InventoryHeaderInfo type from src/types/inventory/header-entry.ts using z.infer<typeof InventoryHeaderInfoSchema>
- [ ] T052 [US3] Update HeaderComparisonService.findMatchingInventoryEntry() in src/services/comparison/header.ts to call entry.identifyWith.identify({ name: headerName }) instead of inline regex test
- [ ] T053 [US3] Update HeaderComparisonService.compareSingleHeader() in src/services/comparison/header.ts to call matchedEntry.authoriseWith.authorize({ content: header.value }) instead of inline content test
- [ ] T054 [US3] Update logging in HeaderComparisonService in src/services/comparison/header.ts to use matcher.getType() and JSON.stringify(matcher.getPattern()) for identification and authorization log messages
- [ ] T055 [US3] Update Inventory model in src/types/inventory/model.ts to include headers property as InventoryHeaderInfo[] array
- [ ] T056 [US3] Export InventoryHeaderInfo from src/types/inventory/index.ts for external use

**Run tests - ALL MUST PASS at this point (implementation complete for US3)**

### Migration for User Story 3 (Optional - depends on existing inventory data)

**NOTE**: Only execute if existing inventory has header entries using old schema (nameMatcher/contentMatcher as RegExp)

- [ ] T057 [US3] Create inventory migration script in scripts/migrate-header-inventory.ts to convert nameMatcher RegExp → NameMatcher(pattern, flags)
- [ ] T058 [US3] Update migration script in scripts/migrate-header-inventory.ts to convert contentMatcher RegExp → ContentMatcher(pattern, flags)
- [ ] T059 [US3] Add Zod validation to migration script in scripts/migrate-header-inventory.ts to verify migrated entries pass InventoryHeaderInfoSchema
- [ ] T060 [US3] Run migration script against test inventory data and verify output matches expected schema
- [ ] T061 [US3] Document migration procedure in specs/002-continuing-our-refactor/quickstart.md with before/after examples and validation steps

**Checkpoint**: All user stories should now be independently functional. Headers use consistent Matcher pattern with scripts.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [ ] T062 [P] Run npm run check:formatting to verify code formatting across all modified files
- [ ] T063 [P] Run npm run check:linting to verify ESLint rules pass for all modified files
- [ ] T064 [P] Run npm run check:typing to verify TypeScript compilation with no errors
- [ ] T065 Run npm run test:unit to verify all unit tests pass (scripts + headers)
- [ ] T066 Run npm run test:integration to verify integration tests pass in Docker environment
- [ ] T067 [P] Update CLAUDE.md if any new patterns or conventions were established during implementation
- [ ] T068 [P] Verify constitution compliance checklist in specs/002-continuing-our-refactor/plan.md - confirm all gates still pass
- [ ] T069 Verify success criteria in specs/002-continuing-our-refactor/spec.md - SC-001 through SC-007 all met
- [ ] T070 [P] Add inline documentation comments to new classes and methods explaining purpose and usage
- [ ] T071 Run quickstart.md validation - verify all examples and code snippets are accurate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ✅ Complete (existing project)
- **Foundational (Phase 2)**: No dependencies - can start immediately - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion
- **User Story 2 (Phase 4)**: Depends on User Story 1 completion (needs header result types)
- **User Story 3 (Phase 5)**: Depends on User Story 1 completion (needs header comparison service)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: **DEPENDS on US1** - needs header result types to exist before updating alert handler
- **User Story 3 (P3)**: **DEPENDS on US1** - needs header comparison service refactored to use typed results
- **US2 and US3**: Can proceed in parallel after US1 completes (different files)

### Within Each User Story

- **Tests FIRST**: All test tasks (T003-T011, T023-T027, T045-T049) MUST be written and FAIL before implementation
- **Result types before services**: T012-T016 (types) before T017-T022 (HeaderComparisonService)
- **Service before integration**: HeaderComparisonService complete before InventoryService/DetectionService updates
- **Implementation before cleanup**: T028-T037 (implementation) before T038-T044 (verification/cleanup)

### Parallel Opportunities

- **Foundational phase**: T001 and T002 can run in parallel (different files)
- **US1 tests**: T003, T004, T005 can run in parallel (different test files)
- **US1 types**: T012, T013, T014 can run in parallel (different type files)
- **US2 tests**: T023, T024, T025, T026 can run in parallel (different test cases)
- **US2 alert methods**: T031, T032 can run in parallel (different private methods)
- **US3 tests**: T045, T046 can run in parallel (different test scenarios)
- **US3 schemas**: T050, T051 can run in parallel with updates to HeaderComparisonService if careful coordination
- **US2 and US3**: Can be worked on in parallel after US1 completes (different files: alert/slack.ts vs comparison/header.ts and inventory types)
- **Polish phase**: T062, T063, T064, T067, T068, T070 can run in parallel (different verification tasks)

---

## Parallel Example: User Story 1

```bash
# Launch all type class creation tasks together:
Task: "T012 [P] [US1] Create UnknownHeaderFound class in src/types/comparison/unknown-header-found.ts"
Task: "T013 [P] [US1] Create KnownHeaderWithUnauthorisedContentFound class in src/types/comparison/known-header-unauthorised-content-found.ts"
Task: "T014 [P] [US1] Create AuthorizedHeaderFound class in src/types/comparison/authorized-header-found.ts"

# After types complete, continue with service implementation sequentially (T017-T022)
```

## Parallel Example: User Story 2 and User Story 3

```bash
# After US1 completes, these can run in parallel:
Task (Developer A): "US2 implementation tasks T028-T044 (alert service refactor)"
Task (Developer B): "US3 implementation tasks T050-T056 (matcher architecture for headers)"

# These work on different files and don't conflict
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T002)
2. Complete Phase 3: User Story 1 (T003-T022)
3. **STOP and VALIDATE**: Run tests, verify HeaderComparisonService returns typed results
4. Demonstrate typed header comparison working independently

### Incremental Delivery

1. Complete Foundational → Foundation ready (T001-T002)
2. Add User Story 1 → Test independently → Demo typed results (T003-T022)
3. Add User Story 2 → Test independently → Demo unified alerting (T023-T044)
4. Add User Story 3 → Test independently → Demo matcher consistency (T045-T061)
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Foundational together (T001-T002)
2. Once Foundational is done:
   - Team A: User Story 1 (T003-T022) - **BLOCKS** US2 and US3
3. After US1 completes:
   - Developer A: User Story 2 (T023-T044)
   - Developer B: User Story 3 (T045-T061)
4. Team reconvenes for Polish phase (T062-T071)

---

## Refactoring Protocol (Per Constitution Principle V)

**CRITICAL**: This is a refactor of security logic. Follow the refactoring protocol from research.md R9:

### Phase 1: Capture Current Behavior (Before Implementation)
- Write tests for current HeaderComparisonService behavior
- Write tests for current alert methods
- Verify all tests pass with current implementation

### Phase 2: Refactor with Test Protection
- Implement typed header result classes (US1)
- Update HeaderComparisonService to return typed results
- Verify tests still pass (behavior unchanged)

### Phase 3: Extend Coverage
- Add tests for new functionality (multiple values, empty values, case sensitivity)
- Add tests for unified alert handler
- Run integration tests for full workflows

**Test execution order for each story**:
1. Write tests FIRST (mark them to skip if needed)
2. Run tests - confirm they FAIL (no implementation yet)
3. Implement feature
4. Run tests - confirm they PASS (implementation correct)
5. Move to next story

---

## Notes

- **[P] tasks**: Different files, no dependencies - can run in parallel
- **[Story] label**: Maps task to specific user story for traceability
- **Constitution compliance**: Test coverage is MANDATORY (Principle V), not optional
- **Refactoring protocol**: Write tests capturing current behavior BEFORE refactoring (R9)
- **Each user story**: Independently completable and testable
- **Verify tests fail**: Before implementing, confirm tests actually fail (not false positives)
- **Commit frequency**: After each task or logical group
- **Checkpoints**: Stop at any checkpoint to validate story independently
- **US1 blocks US2+US3**: Must complete US1 before starting US2 or US3 (they need the types)
- **US2 and US3 parallel**: Can work in parallel after US1 (different files)

---

## Total Task Count: 71 tasks

**Breakdown by User Story:**
- Foundational (Phase 2): 2 tasks
- User Story 1 (P1): 20 tasks (9 tests + 11 implementation)
- User Story 2 (P2): 22 tasks (5 tests + 12 implementation + 5 verification)
- User Story 3 (P3): 17 tasks (5 tests + 7 implementation + 5 migration)
- Polish (Phase 6): 10 tasks

**Parallel Opportunities Identified:**
- Foundational: 2 parallel tasks
- US1: 5 parallel opportunities (3 tests, 3 types)
- US2: 5 parallel opportunities (4 tests, 2 methods) + US2 and US3 can proceed in parallel after US1
- US3: 2 parallel opportunities (2 tests, 2 schemas)
- Polish: 6 parallel tasks

**MVP Scope (Recommended)**: User Story 1 only (T001-T022 = 22 tasks)
- Delivers: Typed header comparison results with complete context
- Independent test: Verify HeaderComparisonService returns appropriate result types
- Value: Foundation for consistent alert handling, eliminates ambiguous header summaries
