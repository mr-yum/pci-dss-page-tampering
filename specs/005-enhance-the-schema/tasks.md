---
description: 'Task list for Composite Matchers with Nested Authorization implementation'
---

# Tasks: Composite Matchers with Nested Authorization

**Input**: Design documents from `/specs/005-enhance-the-schema/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/composite-matcher-schema.json

**Tests**: Tests are included per quickstart.md guidance for security logic validation (Principle V)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `test/` at repository root
- Using TypeScript with Node.js >= 22
- Jest test framework via @mr-yum/node-builder

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and type system refinements

- [x] T001 Introduce Matchable interface in src/types/matcher/matcher.interface.ts for generic matchable resources
- [x] T002 Update DetectedScript type to extend Matchable in src/types/matcher/matcher.interface.ts
- [x] T003 Update Matcher interface to use generic type parameter in src/types/matcher/matcher.interface.ts
- [x] T004 Create AuthorizationResult type in src/types/matcher/authorization-result.ts with metadataPath support

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core composite matcher infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Create OrMatcher class implementation in src/types/matcher/or-matcher.ts
- [x] T006 [P] Create AndMatcher class implementation in src/types/matcher/and-matcher.ts
- [x] T007 Update getType return type in Matcher interface to include 'or' and 'and' in src/types/matcher/matcher.interface.ts
- [x] T008 Update getPattern return type in Matcher interface to support Matcher[] in src/types/matcher/matcher.interface.ts
- [x] T009 Extend matcher factory to support OrMatcher creation in src/types/matcher/matcher-factory.ts
- [x] T010 Extend matcher factory to support AndMatcher creation in src/types/matcher/matcher-factory.ts
- [x] T011 Update Zod schema with OrMatcherConfigSchema using z.lazy() in src/types/inventory/matcher-config-schema.ts
- [x] T012 Update Zod schema with AndMatcherConfigSchema using z.lazy() in src/types/inventory/matcher-config-schema.ts
- [x] T013 Update MatcherConfigSchema union to include composite matchers in src/types/inventory/matcher-config-schema.ts

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Complex Content-Security-Policy Authorization (Priority: P1) 🎯 MVP

**Goal**: Enable security administrators to authorize CSP headers requiring multiple directives using AND logic

**Independent Test**: Create inventory entry with andMatcher containing 3+ contentMatcher children, verify headers are only authorized when all patterns match

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T014 [P] [US1] Unit test for AndMatcher constructor validation (empty array rejection) in src/types/matcher/and-matcher.test.ts
- [x] T015 [P] [US1] Unit test for AndMatcher identify() with all children matching in src/types/matcher/and-matcher.test.ts
- [x] T016 [P] [US1] Unit test for AndMatcher identify() with partial match in src/types/matcher/and-matcher.test.ts
- [x] T017 [P] [US1] Unit test for AndMatcher authorize() with all children authorized in src/types/matcher/and-matcher.test.ts
- [x] T018 [P] [US1] Unit test for AndMatcher authorize() with short-circuit failure in src/types/matcher/and-matcher.test.ts
- [x] T019 [P] [US1] Unit test for AndMatcher authorize() with null/empty content in src/types/matcher/and-matcher.test.ts
- [x] T020 [P] [US1] Unit test for AndMatcher authorize() with top-level authorisationInfo override (true) in src/types/matcher/and-matcher.test.ts
- [x] T021 [P] [US1] Unit test for AndMatcher authorize() with top-level authorisationInfo override (false) in src/types/matcher/and-matcher.test.ts
- [x] T022 [P] [US1] Unit test for AndMatcher metadata path collection in src/types/matcher/and-matcher.test.ts
- [ ] T023 [US1] Integration test for CSP header with AND logic (all directives present) in test/integration/composite-matcher-workflow.test.ts
- [ ] T024 [US1] Integration test for CSP header with AND logic (missing directive) in test/integration/composite-matcher-workflow.test.ts

### Implementation for User Story 1

- [X] T025 [US1] Update AuthorizedScriptFound to include metadataPath field in src/types/comparison/authorized-script-found.ts
- [X] T026 [US1] Update KnownScriptWithUnauthorisedContentFound to include metadataPath field in src/types/comparison/known-script-unauthorised-content-found.ts
- [X] T027 [US1] Update AuthorizedHeaderFound to include metadataPath field in src/types/comparison/authorized-header-found.ts
- [X] T028 [US1] Update KnownHeaderUnauthorisedContentFound to include metadataPath field in src/types/comparison/known-header-unauthorised-content-found.ts
- [X] T029 [US1] Update ScriptComparisonService to pass metadataPath from AuthorizationResult in src/services/comparison/script.ts
- [X] T030 [US1] Update HeaderComparisonService to pass metadataPath from AuthorizationResult in src/services/comparison/header.ts
- [X] T031 [US1] Update HeaderComparisonService to use Matchable interface (remove hash type cast workaround) in src/services/comparison/header.ts

**Checkpoint**: At this point, User Story 1 should be fully functional - AND matcher works with CSP headers requiring multiple directives

---

## Phase 4: User Story 2 - Alternative Authorization Policies (Priority: P1)

**Goal**: Enable security administrators to authorize headers matching ANY of several acceptable patterns using OR logic

**Independent Test**: Create inventory entry with orMatcher containing 3+ matcher alternatives, verify headers matching any single alternative are authorized

### Tests for User Story 2

- [ ] T032 [P] [US2] Unit test for OrMatcher constructor validation (empty array rejection) in test/unit/types/matcher/or-matcher.test.ts
- [ ] T033 [P] [US2] Unit test for OrMatcher identify() with first child matching in test/unit/types/matcher/or-matcher.test.ts
- [ ] T034 [P] [US2] Unit test for OrMatcher identify() with second child matching in test/unit/types/matcher/or-matcher.test.ts
- [ ] T035 [P] [US2] Unit test for OrMatcher identify() with no children matching in test/unit/types/matcher/or-matcher.test.ts
- [ ] T036 [P] [US2] Unit test for OrMatcher authorize() with first-match-wins semantics in test/unit/types/matcher/or-matcher.test.ts
- [ ] T037 [P] [US2] Unit test for OrMatcher authorize() with null/empty content in test/unit/types/matcher/or-matcher.test.ts
- [ ] T038 [P] [US2] Unit test for OrMatcher authorize() with top-level authorisationInfo override (true) in test/unit/types/matcher/or-matcher.test.ts
- [ ] T039 [P] [US2] Unit test for OrMatcher authorize() with top-level authorisationInfo override (false) in test/unit/types/matcher/or-matcher.test.ts
- [ ] T040 [P] [US2] Unit test for OrMatcher metadata path collection in test/unit/types/matcher/or-matcher.test.ts
- [ ] T041 [US2] Integration test for CSP header with OR logic (first alternative matches) in test/integration/composite-matcher-workflow.test.ts
- [ ] T042 [US2] Integration test for CSP header with OR logic (second alternative matches) in test/integration/composite-matcher-workflow.test.ts
- [ ] T043 [US2] Integration test for CSP header with OR logic (no alternatives match) in test/integration/composite-matcher-workflow.test.ts

### Implementation for User Story 2

- [ ] T044 [US2] Update RawAuthorizeWithConfigSchema to support array syntax in src/types/inventory/zod.ts
- [ ] T045 [US2] Create processAuthorizeWith function to convert array to OrMatcher in src/types/inventory/zod.ts
- [ ] T046 [US2] Update inventory loading to process array syntax via processAuthorizeWith in src/repositories/inventory-repository.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - both AND and OR matchers functional

---

## Phase 5: User Story 3 - Backward-Compatible Array Syntax (Priority: P2)

**Goal**: Provide syntactic sugar for common OR case by supporting array syntax for authoriseWith

**Independent Test**: Create inventory entry where authoriseWith is an array of matchers (each with authorisationInfo), verify behavior identical to explicit orMatcher

### Tests for User Story 3

- [ ] T047 [P] [US3] Unit test for array syntax with two content matchers (first matches) in test/unit/services/comparison/array-syntax.test.ts
- [ ] T048 [P] [US3] Unit test for array syntax with two content matchers (second matches) in test/unit/services/comparison/array-syntax.test.ts
- [ ] T049 [P] [US3] Unit test for array syntax with two content matchers (both match, first-match-wins) in test/unit/services/comparison/array-syntax.test.ts
- [ ] T050 [P] [US3] Unit test for array syntax with composite matchers (mixing syntaxes) in test/unit/services/comparison/array-syntax.test.ts
- [ ] T051 [US3] Integration test for array syntax equivalence to explicit orMatcher in test/integration/composite-matcher-workflow.test.ts

### Implementation for User Story 3

- [ ] T052 [US3] Update Zod schema validation to accept array syntax in src/types/inventory/zod.ts
- [ ] T053 [US3] Add integration tests verifying array syntax matches explicit orMatcher behavior in test/integration/array-syntax-equivalence.test.ts

**Checkpoint**: All basic composite matcher scenarios (AND, OR, array syntax) should now be independently functional

---

## Phase 6: User Story 4 - Nested Composite Matchers (Priority: P3)

**Goal**: Enable complex authorization logic by nesting composite matchers (e.g., OR containing AND, or AND containing OR)

**Independent Test**: Create inventory entry with nested composite matchers (e.g., orMatcher containing andMatcher children), verify logic tree evaluates correctly

### Tests for User Story 4

- [ ] T054 [P] [US4] Unit test for nested OR containing AND (first AND group succeeds) in test/unit/types/matcher/nested-composite.test.ts
- [ ] T055 [P] [US4] Unit test for nested OR containing AND (second AND group succeeds) in test/unit/types/matcher/nested-composite.test.ts
- [ ] T056 [P] [US4] Unit test for nested OR containing AND (partial match of both groups, neither complete) in test/unit/types/matcher/nested-composite.test.ts
- [ ] T057 [P] [US4] Unit test for nested AND containing OR in test/unit/types/matcher/nested-composite.test.ts
- [ ] T058 [P] [US4] Unit test for deeply nested composites (5+ levels) in test/unit/types/matcher/nested-composite.test.ts
- [ ] T059 [P] [US4] Unit test for metadata path collection through nested composites in test/unit/types/matcher/nested-composite.test.ts
- [ ] T060 [US4] Integration test for nested composite with real CSP policy in test/integration/composite-matcher-workflow.test.ts

### Implementation for User Story 4

- [ ] T061 [US4] Add recursive validation tests to Zod schema tests in test/unit/types/inventory/matcher-config-schema.test.ts
- [ ] T062 [US4] Add performance test for deeply nested matchers (10 levels) in test/unit/types/matcher/performance.test.ts
- [ ] T063 [US4] Document nesting depth recommendations in CLAUDE.md

**Checkpoint**: All user stories should now be independently functional - complex nested authorization policies supported

---

## Phase 7: Edge Cases & Fail-Secure Validation

**Purpose**: Ensure fail-secure behavior across all edge cases (Principle V: Test Coverage for Security Logic)

- [ ] T064 [P] Property-based test for fail-secure properties using fast-check in test/unit/types/matcher/fail-secure.test.ts
- [ ] T065 [P] Unit test for single-child composite matchers (valid edge case) in test/unit/types/matcher/single-child.test.ts
- [ ] T066 [P] Unit test for authorisationInfo.authorised: false always denying in test/unit/types/matcher/explicit-denial.test.ts
- [ ] T067 [P] Unit test for whitespace-only content triggering unauthorized in test/unit/types/matcher/whitespace-content.test.ts
- [ ] T068 [P] Unit test for undefined content triggering unauthorized in test/unit/types/matcher/undefined-content.test.ts
- [ ] T069 [P] Unit test for top-level override when matchers don't match (inventory entry doesn't apply) in test/unit/services/comparison/override-no-match.test.ts
- [ ] T070 [US1] Validate that Array.every() is never used without empty array check in test/unit/types/matcher/and-matcher-safety.test.ts

---

## Phase 8: Migration & Backward Compatibility

**Purpose**: Validate 100% backward compatibility with existing inventory entries

- [ ] T071 Update validate-migration.js to support composite matcher validation in scripts/validate-migration.js
- [ ] T072 [P] Add composite matcher validation tests in test/unit/utils/inventory/validate-migration.test.ts
- [ ] T073 [P] Create example inventory entries for each composite pattern in specs/005-enhance-the-schema/examples/
- [ ] T074 Run validate-migration.js against existing inventory entries to verify no regressions
- [ ] T075 Document migration path from simple to composite matchers in specs/005-enhance-the-schema/MIGRATION.md

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and final validation

- [ ] T076 [P] Update CLAUDE.md with composite matcher authorization structure section
- [ ] T077 [P] Update CLAUDE.md with matcher system section (add OrMatcher, AndMatcher)
- [ ] T078 [P] Update CLAUDE.md with comparison result types (add metadataPath)
- [ ] T079 Update README.md with composite matcher examples (if README exists)
- [ ] T080 Add inline code comments for recursive evaluation logic in OrMatcher and AndMatcher
- [ ] T081 Add inline code comments for metadata path construction in OrMatcher and AndMatcher
- [ ] T082 Add inline code comments for fail-secure empty array validation in OrMatcher and AndMatcher
- [ ] T083 Run full test suite (npm run test:unit && npm run test:integration)
- [ ] T084 Run type checking (npm run check:typing)
- [ ] T085 Run linting (npm run check:linting)
- [ ] T086 Run formatting checks (npm run check:formatting)
- [ ] T087 Validate all test scenarios from quickstart.md against implementation
- [ ] T088 Generate JSON Schema documentation from contracts/composite-matcher-schema.json

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion - BLOCKS all user stories
- **User Stories (Phases 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (US1 → US2 → US3 → US4)
- **Edge Cases (Phase 7)**: Depends on all user story implementations (US1-US4)
- **Migration (Phase 8)**: Depends on core implementation (Phases 1-4)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1 - AND logic)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1 - OR logic)**: Can start after Foundational (Phase 2) - No dependencies on other stories (can run parallel with US1)
- **User Story 3 (P2 - Array syntax)**: Can start after Foundational (Phase 2) - Builds on OR logic but independently testable
- **User Story 4 (P3 - Nesting)**: Can start after Foundational (Phase 2) - Depends on US1 and US2 implementations for nesting, but independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Comparison result updates before comparison service updates
- Core matcher implementation before comparison service integration
- Story complete and tested before moving to next priority

### Parallel Opportunities

- **Phase 1 (Setup)**: All tasks (T001-T004) can run in parallel
- **Phase 2 (Foundational)**: T005/T006 (matcher classes) can run in parallel; T009/T010 (factory updates) can run in parallel; T011/T012 (schema updates) can run in parallel
- **User Story Tests**: All unit tests within a story marked [P] can run in parallel
- **User Stories**: US1 and US2 can be worked on in parallel (both P1, independent)
- **Phase 7 (Edge Cases)**: All tasks (T064-T070) can run in parallel
- **Phase 8 (Migration)**: T072-T073 can run in parallel
- **Phase 9 (Polish)**: T076-T078 (documentation) can run in parallel; T083-T086 (checks) can run sequentially

---

## Parallel Example: User Story 1 (AND Logic)

```bash
# Launch all unit tests for User Story 1 together:
Task: "Unit test for AndMatcher constructor validation in test/unit/types/matcher/and-matcher.test.ts"
Task: "Unit test for AndMatcher identify() with all children matching in test/unit/types/matcher/and-matcher.test.ts"
Task: "Unit test for AndMatcher identify() with partial match in test/unit/types/matcher/and-matcher.test.ts"
Task: "Unit test for AndMatcher authorize() with all children authorized in test/unit/types/matcher/and-matcher.test.ts"
# ... (all unit tests T014-T022 can run in parallel)

# Then launch comparison result updates in parallel:
Task: "Update AuthorizedScriptFound to include metadataPath in src/types/comparison/authorized-script-found.ts"
Task: "Update KnownScriptWithUnauthorisedContentFound to include metadataPath in src/types/comparison/known-script-unauthorised-content-found.ts"
Task: "Update AuthorizedHeaderFound to include metadataPath in src/types/comparison/authorized-header-found.ts"
Task: "Update KnownHeaderUnauthorisedContentFound to include metadataPath in src/types/comparison/known-header-unauthorised-content-found.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

Both User Stories 1 and 2 are marked P1 (highest priority) because they represent the core use cases:

1. Complete Phase 1: Setup (type system refinements)
2. Complete Phase 2: Foundational (CRITICAL - composite matcher infrastructure)
3. Complete Phase 3: User Story 1 (AND logic for CSP directives)
4. Complete Phase 4: User Story 2 (OR logic for alternative policies)
5. **STOP and VALIDATE**: Test both user stories independently
6. Deploy/demo if ready

**Rationale**: US1 and US2 together provide complete boolean composition (AND/OR). This is the minimum viable feature set that addresses the core problem ("cannot express multi-condition authorization").

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 (AND logic) → Test independently → Partial value (can express "all required")
3. Add User Story 2 (OR logic) → Test independently → Complete MVP (can express "any acceptable")
4. Add User Story 3 (Array syntax) → Test independently → Enhanced ergonomics
5. Add User Story 4 (Nesting) → Test independently → Advanced use cases
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (Phases 1-2)
2. Once Foundational is done:
   - Developer A: User Story 1 (AND logic)
   - Developer B: User Story 2 (OR logic)
   - Both can work in parallel - different matcher types
3. After US1 & US2 complete:
   - Developer A: User Story 3 (Array syntax)
   - Developer B: User Story 4 (Nesting)
4. Team converges on Edge Cases, Migration, and Polish

---

## Task Summary

### Total Tasks: 88

**By Phase**:

- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 9 tasks
- Phase 3 (US1 - AND logic): 17 tasks (11 tests + 6 implementation)
- Phase 4 (US2 - OR logic): 15 tasks (12 tests + 3 implementation)
- Phase 5 (US3 - Array syntax): 6 tasks (5 tests + 1 implementation)
- Phase 6 (US4 - Nesting): 10 tasks (7 tests + 3 implementation)
- Phase 7 (Edge Cases): 7 tasks
- Phase 8 (Migration): 5 tasks
- Phase 9 (Polish): 15 tasks

**By User Story**:

- User Story 1 (P1 - AND logic): 17 tasks
- User Story 2 (P1 - OR logic): 15 tasks
- User Story 3 (P2 - Array syntax): 6 tasks
- User Story 4 (P3 - Nesting): 10 tasks
- Infrastructure (Setup + Foundational): 13 tasks
- Quality (Edge Cases + Migration + Polish): 27 tasks

**Parallel Opportunities**:

- Phase 1: 4 tasks can run in parallel
- Phase 2: ~6 tasks can run in parallel (in groups)
- US1 tests: 9 unit tests can run in parallel
- US1 comparison updates: 4 tasks can run in parallel
- US2 tests: 9 unit tests can run in parallel
- US3 tests: 4 unit tests can run in parallel
- US4 tests: 6 unit tests can run in parallel
- Phase 7: 7 tasks can run in parallel
- Phase 8: 2 tasks can run in parallel
- Phase 9 docs: 3 tasks can run in parallel

**MVP Scope (User Stories 1 & 2 only)**: 44 tasks

- Setup + Foundational: 13 tasks
- User Story 1: 17 tasks
- User Story 2: 15 tasks
- Essential validation: ~5 tasks from Phase 7
- **Estimated**: ~45-50 tasks for complete AND/OR composite matcher support

---

## Notes

- [P] tasks = different files, no dependencies, can run in parallel
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD approach per quickstart.md)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Tests are included** per Principle V (Test Coverage for Security Logic) - this is a security-critical system
- Fail-secure validation is critical: empty arrays, null content, explicit denials
- Backward compatibility must be maintained: 100% of existing inventory entries must continue to work
- No hard depth limit for nesting (per spec requirement FR-013)
