# Tasks: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
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

- [X] T001 [P] Define DetectedHeader interface in src/types/header.ts with properties: name (string), value (string), target (Target), workflow (string)
- [X] T002 [P] Update ComparisonResultType union in src/types/comparison/index.ts to prepare for header result types (add placeholder comment for header types)

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
- [ ] T009 [US1] Write unit test for HeaderComparisonService first-match-wins logic in test/unit/services/comparison/header.test.ts - verify first inventory entry wins when patterns overlap (per FR-010c)
- [ ] T010 [US1] Write unit test for HeaderComparisonService empty value handling in test/unit/services/comparison/header.test.ts - verify empty string "" is valid input (per FR-013a)
- [ ] T011 [US1] Write unit test for HeaderComparisonService multiple values generating multiple results in test/unit/services/comparison/header.test.ts - verify header with 3 values produces 3 separate results (per FR-013)

**Run tests - ALL MUST FAIL at this point (no implementation yet)**

### Implementation for User Story 1

- [X] T012 [P] [US1] Create UnknownHeaderFound class in src/types/comparison/unknown-header-found.ts extending ComparisonResult with type="unknown_header_found", header property (per FR-001, FR-003)
- [X] T013 [P] [US1] Create KnownHeaderWithUnauthorisedContentFound class in src/types/comparison/known-header-unauthorised-content-found.ts extending ComparisonResult with type="known_header_unauthorised_content", header, inventoryEntry, authorizationMatcher, failureReason properties (per FR-001, FR-004)
- [X] T014 [P] [US1] Create AuthorizedHeaderFound class in src/types/comparison/authorized-header-found.ts extending ComparisonResult with type="authorized_header", header, inventoryEntry properties (per FR-001, FR-005)
- [X] T015 [US1] Update ComparisonResultType union in src/types/comparison/index.ts to include UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound (per FR-014)
- [X] T016 [US1] Export new header result types from src/types/comparison/index.ts
- [X] T017 [US1] Update IHeaderComparisonService interface in src/interfaces/comparison.ts to return Promise<ComparisonResultType[]> instead of Promise<HeaderComparisonSummary> (per FR-006)
- [X] T018 [US1] Refactor HeaderComparisonService.compare() in src/services/comparison/header.ts to iterate over header Map entries and expand Set<values> to individual DetectedHeader instances (one result per value per FR-013, data-model.md BR-1)
- [X] T019 [US1] Implement compareSingleHeader() private method in src/services/comparison/header.ts with logic: normalize name to lowercase (per FR-010b), find matching inventory entry (first-match-wins per FR-010c), create appropriate typed result
- [X] T020 [US1] Implement findMatchingInventoryEntry() private method in src/services/comparison/header.ts with first-match-wins logic iterating inventory entries in array order (per data-model.md BR-2)
- [X] T021 [US1] Add logging to HeaderComparisonService in src/services/comparison/header.ts for identification and authorization results (matcher type, pattern, success/failure, timing)
- [X] T022 [US1] Handle empty string values in HeaderComparisonService in src/services/comparison/header.ts - do NOT skip, pass to ContentMatcher per FR-013a and data-model.md BR-5

**Run tests - ALL MUST PASS at this point (implementation complete for US1)**

**Checkpoint**: At this point, User Story 1 should be fully functional - HeaderComparisonService returns typed results with complete context (per FR-012). Test independently before proceeding to US2.

---

## Phase 4: User Story 2 - Alert Service Leveraging Typed Results (Priority: P2)

**Goal**: Migrate alert service to unified typed handler processing both script and header results, removing legacy alert methods

**Independent Test**: Can be tested by triggering each comparison result type (for both scripts and headers) and verifying alerts are routed correctly with complete context and no legacy methods invoked

**Dependency**: Requires US1 completion (header result types must exist)

### Tests for User Story 2 (REQUIRED per Constitution Principle V)

- [ ] T023 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling UnknownHeaderFound in test/unit/services/alert/slack.test.ts - verify alert category is workflow-appropriate (newHeaderIdentified vs uninventoriedHeaderDetected per FR-011)
- [ ] T024 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling KnownHeaderWithUnauthorisedContentFound in test/unit/services/alert/slack.test.ts - verify alert includes matcher details and failure reason
- [ ] T025 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling AuthorizedHeaderFound in test/unit/services/alert/slack.test.ts - verify no alert generated
- [ ] T026 [P] [US2] Write unit test for SlackAlertService.alertForTypedResults handling all script result types in test/unit/services/alert/slack.test.ts - verify scripts still work after header support added
- [ ] T027 [US2] Write unit test for SlackAlertService.alertForTypedResults switch statement exhaustive checking in test/unit/services/alert/slack.test.ts - verify TypeScript never type catches missing cases (per FR-009)

**Run tests - ALL MUST FAIL at this point (no implementation yet)**

### Implementation for User Story 2

- [ ] T028 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'unknown_header_found' calling alertForUnknownHeader() (per FR-007)
- [ ] T029 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'known_header_unauthorised_content' calling alertForKnownHeaderUnauthorised() (per FR-007)
- [ ] T030 [US2] Update SlackAlertService.alertForTypedResults() switch statement in src/services/alert/slack.ts to add case 'authorized_header' with no-op (no alert)
- [ ] T031 [P] [US2] Implement alertForUnknownHeader() private method in src/services/alert/slack.ts with workflow-based routing (inventory → newHeaderIdentified, detection → uninventoriedHeaderDetected per FR-011)
- [ ] T032 [P] [US2] Implement alertForKnownHeaderUnauthorised() private method in src/services/alert/slack.ts including matcher pattern and failure reason in alert
- [ ] T033 [US2] Add try-catch to each case in SlackAlertService.alertForTypedResults() in src/services/alert/slack.ts to log errors without blocking (per constitution principle IV)
- [ ] T034 [US2] Update InventoryService in src/services/inventory.ts to call alertForTypedResults() with header comparison results from HeaderComparisonService
- [ ] T035 [US2] Update DetectionService in src/services/detection.ts to call alertForTypedResults() with header comparison results from HeaderComparisonService
- [ ] T036 [US2] Mark alertForScripts() method as @deprecated in src/services/alert/slack.ts with comment "Use alertForTypedResults instead"
- [ ] T037 [US2] Mark alertForHeaders() method as @deprecated in src/services/alert/slack.ts with comment "Use alertForTypedResults instead"

**Run tests - ALL MUST PASS at this point (implementation complete for US2)**

### Verification and Cleanup for User Story 2

- [ ] T038 [US2] Run integration tests to verify no regressions in script alerting after header support added - confirm alerts still generated correctly (per SC-006)
- [ ] T039 [US2] Run integration tests with header violations to verify alert routing works correctly - test both inventory and detection workflows (per FR-011)
- [ ] T040 [US2] Verify no references to legacy alertForScripts method - run grep -r "alertForScripts" src/ (should find only deprecation marker, per SC-003)
- [ ] T041 [US2] Verify no references to legacy alertForHeaders method - run grep -r "alertForHeaders" src/ (should find only deprecation marker, per SC-003)
- [ ] T042 [US2] Remove alertForScripts() method from src/services/alert/slack.ts after confirming all callers migrated (per FR-008)
- [ ] T043 [US2] Remove alertForHeaders() method from src/services/alert/slack.ts after confirming all callers migrated (per FR-008)
- [ ] T044 [US2] Update IAlertService interface in src/interfaces/alert.ts to remove alertForScripts and alertForHeaders method signatures

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - all alerts flow through unified typed handler (per SC-004). Test independently before proceeding to US3.

---

## Phase 5: User Story 3 - Header Matcher Architecture (Priority: P3)

**Goal**: Apply Matcher interface pattern to headers with distinct HeaderNameMatcher and ContentMatcher implementations, while maintaining ScriptNameMatcher for scripts

**Important**: Per FR-010a and spec clarification, HeaderNameMatcher and ScriptNameMatcher are DISTINCT implementations of the Matcher interface with different matching behaviors (case-insensitive vs case-sensitive)

**Independent Test**: Can be tested by configuring inventory entries with HeaderNameMatcher instances and verifying the comparison service correctly identifies and authorizes headers using case-insensitive name matching and case-sensitive value matching

**Dependency**: Requires US1 completion (header comparison service must be using typed results)

### Tests for User Story 3 (REQUIRED per Constitution Principle V)

- [ ] T045 [P] [US3] Write unit test for HeaderNameMatcher.identify() in test/unit/types/matcher/header-name-matcher.test.ts - verify case-insensitive matching ("Content-Type" matches "content-type" per FR-010b and spec acceptance scenario 1)
- [ ] T046 [P] [US3] Write unit test for HeaderNameMatcher.authorize() in test/unit/types/matcher/header-name-matcher.test.ts - verify case-sensitive content matching (reuses pattern logic but for header values)
- [ ] T047 [P] [US3] Write unit test for HeaderNameMatcher and ScriptNameMatcher both implementing Matcher interface in test/unit/types/matcher/matcher-interface.test.ts - verify domain-appropriate behaviors (per FR-010a and spec acceptance scenario 4)
- [ ] T048 [US3] Write unit test for InventoryHeaderInfo Zod schema validation in test/unit/types/inventory/header-entry.test.ts - verify identifyWith accepts HeaderNameMatcher and authoriseWith accepts ContentMatcher
- [ ] T049 [US3] Write unit test for HeaderComparisonService using HeaderNameMatcher.identify() in test/unit/services/comparison/header.test.ts - verify matcher's identify method called instead of inline regex
- [ ] T050 [US3] Write unit test for HeaderComparisonService using ContentMatcher.authorize() in test/unit/services/comparison/header.test.ts - verify matcher's authorize method called instead of inline content validation
- [ ] T051 [US3] Write unit test for HeaderComparisonService logging matcher type and pattern on failure in test/unit/services/comparison/header.test.ts - verify debug information includes getType() and getPattern() (per spec acceptance scenario 3)

**Run tests - WILL FAIL initially, PASS after implementation**

### Implementation for User Story 3

#### Matcher Implementation

- [ ] T052 [P] [US3] Create HeaderNameMatcher class in src/types/matcher/header-name-matcher.ts implementing Matcher interface with case-insensitive identify() method for HTTP header names per RFC 7230 (per FR-010a, FR-010b)
- [ ] T053 [P] [US3] Implement HeaderNameMatcher.identify() in src/types/matcher/header-name-matcher.ts to normalize input name to lowercase before regex test (per data-model.md BR-3)
- [ ] T054 [P] [US3] Implement HeaderNameMatcher.authorize() in src/types/matcher/header-name-matcher.ts for case-sensitive content matching (same pattern as NameMatcher but header-specific semantics)
- [ ] T055 [P] [US3] Implement HeaderNameMatcher.getType() in src/types/matcher/header-name-matcher.ts to return 'header-name' as discriminator
- [ ] T056 [P] [US3] Implement HeaderNameMatcher.getPattern() in src/types/matcher/header-name-matcher.ts to return regex pattern string for logging
- [ ] T057 [US3] Add HeaderNameMatcher to MatcherFactory in src/types/matcher/matcher-factory.ts for deserialization from JSON inventory with type discriminator 'header-name'
- [ ] T058 [US3] Update Matcher.getType() return type in src/types/matcher/matcher.interface.ts to include 'header-name' | 'name' | 'content' | 'hash' (currently only 'name' | 'content' | 'hash')

#### Inventory Schema

- [ ] T059 [P] [US3] Define InventoryHeaderInfo Zod schema in src/types/inventory/header-entry.ts with identifyWith (HeaderNameMatcher), authoriseWith (ContentMatcher), authorisationInfo fields (per FR-010a)
- [ ] T060 [P] [US3] Export InventoryHeaderInfo type from src/types/inventory/header-entry.ts using z.infer<typeof InventoryHeaderInfoSchema>
- [ ] T061 [US3] Update Inventory model in src/types/inventory/model.ts to include headers property as InventoryHeaderInfo[] array
- [ ] T062 [US3] Export InventoryHeaderInfo from src/types/inventory/index.ts for external use

#### Service Integration

- [ ] T063 [US3] Update HeaderComparisonService.findMatchingInventoryEntry() in src/services/comparison/header.ts to call entry.identifyWith.identify({ name: headerName }) instead of inline regex test (per FR-010)
- [ ] T064 [US3] Update HeaderComparisonService.compareSingleHeader() in src/services/comparison/header.ts to call matchedEntry.authoriseWith.authorize({ content: header.value }) instead of inline content test (per FR-010)
- [ ] T065 [US3] Update logging in HeaderComparisonService in src/services/comparison/header.ts to use matcher.getType() and JSON.stringify(matcher.getPattern()) for identification and authorization log messages

**Run tests - ALL MUST PASS at this point (implementation complete for US3)**

### Documentation and Migration for User Story 3

- [ ] T066 [P] [US3] Document HeaderNameMatcher vs ScriptNameMatcher distinction in CLAUDE.md - clarify both implement Matcher but have different matching semantics (per FR-010a)
- [ ] T067 [P] [US3] Create migration guide in specs/002-continuing-our-refactor/migration.md for converting existing header inventory entries from nameMatcher/contentMatcher RegExp to identifyWith/authoriseWith Matcher instances
- [ ] T068 [US3] Create optional migration script in scripts/migrate-header-inventory.ts to automate conversion of existing inventory (if applicable) - convert nameMatcher RegExp → HeaderNameMatcher, contentMatcher RegExp → ContentMatcher

**Checkpoint**: All user stories should now be independently functional. Headers use consistent Matcher pattern with scripts while accommodating domain-specific matching semantics (per SC-005, FR-010a).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [ ] T069 [P] Run npm run check:formatting to verify code formatting across all modified files
- [ ] T070 [P] Run npm run check:linting to verify ESLint rules pass for all modified files
- [ ] T071 [P] Run npm run check:typing to verify TypeScript compilation with no errors (per SC-007)
- [ ] T072 Run npm run test:unit to verify all unit tests pass (scripts + headers)
- [ ] T073 Run npm run test:integration to verify integration tests pass in Docker environment
- [ ] T074 [P] Update CLAUDE.md if any new patterns or conventions were established during implementation
- [ ] T075 [P] Verify constitution compliance checklist in specs/002-continuing-our-refactor/plan.md - confirm all gates still pass
- [ ] T076 Verify success criteria in specs/002-continuing-our-refactor/spec.md - SC-001 through SC-007 all met
- [ ] T077 [P] Add inline documentation comments to new classes and methods explaining purpose and usage
- [ ] T078 Run quickstart.md validation - verify all examples and code snippets are accurate

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

- **Tests FIRST**: All test tasks (T003-T011, T023-T027, T045-T051) MUST be written and FAIL before implementation
- **Result types before services**: T012-T016 (types) before T017-T022 (HeaderComparisonService)
- **Service before integration**: HeaderComparisonService complete before InventoryService/DetectionService updates
- **Implementation before cleanup**: T028-T037 (implementation) before T038-T044 (verification/cleanup)
- **Matchers before schemas**: T052-T058 (HeaderNameMatcher) before T059-T062 (InventoryHeaderInfo schema)
- **Schema before service integration**: T059-T062 (schema) before T063-T065 (service updates)

### Parallel Opportunities

- **Foundational phase**: T001 and T002 can run in parallel (different files)
- **US1 tests**: T003, T004, T005 can run in parallel (different test files)
- **US1 types**: T012, T013, T014 can run in parallel (different type files)
- **US2 tests**: T023, T024, T025, T026 can run in parallel (different test cases)
- **US2 alert methods**: T031, T032 can run in parallel (different private methods)
- **US3 tests**: T045, T046, T047 can run in parallel (different matcher test files)
- **US3 matcher methods**: T052, T053, T054, T055, T056 can run in parallel (different methods in same class - careful coordination)
- **US3 schema tasks**: T059, T060 can run in parallel with T052-T056 if careful coordination
- **US3 documentation**: T066, T067 can run in parallel (different doc files)
- **US2 and US3**: Can be worked on in parallel after US1 completes (different files: alert/slack.ts vs comparison/header.ts and inventory types)
- **Polish phase**: T069, T070, T071, T074, T075, T077 can run in parallel (different verification tasks)

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
Task (Developer B): "US3 implementation tasks T052-T065 (matcher architecture for headers)"

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
4. Add User Story 3 → Test independently → Demo matcher consistency (T045-T068)
5. Complete Polish → Final validation (T069-T078)
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Foundational together (T001-T002)
2. Once Foundational is done:
   - Team A: User Story 1 (T003-T022) - **BLOCKS** US2 and US3
3. After US1 completes:
   - Developer A: User Story 2 (T023-T044)
   - Developer B: User Story 3 (T045-T068)
4. Team reconvenes for Polish phase (T069-T078)

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

## Key Spec Alignments

### FR-010a: Distinct Matcher Implementations
- **T052-T056**: Create HeaderNameMatcher as distinct class from ScriptNameMatcher
- **T047**: Test both matchers implement Matcher interface with domain-appropriate behaviors
- **T066**: Document the distinction in CLAUDE.md

### FR-010b: Case-Insensitive Header Names
- **T053**: HeaderNameMatcher.identify() normalizes to lowercase
- **T045**: Test case-insensitive matching
- **T007**: Test HeaderComparisonService case-insensitive behavior

### FR-010c: First-Match-Wins Logic
- **T009**: Test first-match-wins for overlapping patterns
- **T020**: Implement findMatchingInventoryEntry with first-match-wins

### FR-013: Multiple Values → Multiple Results
- **T011**: Test header with 3 values produces 3 results
- **T018**: Implement value expansion in HeaderComparisonService.compare()

### FR-013a: Empty Values Valid
- **T010**: Test empty string is valid input
- **T022**: Handle empty values without skipping

### Spec Acceptance Scenario 4 (US3)
- **T047**: Test HeaderNameMatcher and ScriptNameMatcher both implement Matcher with different behaviors
- **T052-T056**: Implement HeaderNameMatcher with case-insensitive semantics
- **T066**: Document distinction between matcher types

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
- **HeaderNameMatcher ≠ ScriptNameMatcher**: Distinct classes per FR-010a, different matching semantics

---

## Total Task Count: 78 tasks

**Breakdown by User Story:**
- Foundational (Phase 2): 2 tasks
- User Story 1 (P1): 20 tasks (9 tests + 11 implementation)
- User Story 2 (P2): 22 tasks (5 tests + 12 implementation + 5 verification)
- User Story 3 (P3): 24 tasks (7 tests + 14 implementation + 3 documentation)
- Polish (Phase 6): 10 tasks

**Parallel Opportunities Identified:**
- Foundational: 2 parallel tasks
- US1: 5 parallel opportunities (3 tests, 3 types)
- US2: 5 parallel opportunities (4 tests, 2 methods) + US2 and US3 can proceed in parallel after US1
- US3: 8 parallel opportunities (3 tests, 5 matcher methods, 2 doc files)
- Polish: 6 parallel tasks

**MVP Scope (Recommended)**: User Story 1 only (T001-T022 = 22 tasks)
- Delivers: Typed header comparison results with complete context
- Independent test: Verify HeaderComparisonService returns appropriate result types
- Value: Foundation for consistent alert handling, eliminates ambiguous header summaries
