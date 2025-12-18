# Tasks: Dedicated Alert Destination for Success Messages

**Input**: Design documents from `/specs/010-dedicated-alert-destination/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Test tasks ARE included based on constitution requirement V (Test Coverage for Security Logic) and quickstart.md test specifications.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `test/` at repository root
- Unit tests co-located with source files in `src/` hierarchy (per constitution)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No infrastructure setup required - this feature modifies existing code.

This phase is empty because:
- Project structure already exists
- Dependencies (Zod, axios) already installed
- Test framework already configured

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes that MUST be complete before alert service changes can be made.

**⚠️ CRITICAL**: User story implementation depends on schema being updated first.

- [ ] T001 Add `successNotification` field to `InventoryAlert` type in `src/types/inventory/model.ts`
- [ ] T002 Strengthen `AlertDestinationSchema` validation with `z.string().min(1, 'Alert destination cannot be empty')` in `src/types/inventory/zod.ts`
- [ ] T003 Add `successNotification: AlertDestinationSchema` to `InventoryAlertSchema` in `src/types/inventory/zod.ts` (depends on T001, T002)
- [ ] T004 Run `npm run check:typing` to verify type definitions compile

**Checkpoint**: Schema ready - alert service implementation can now begin.

---

## Phase 3: User Story 1 - Separate success notifications from violation alerts (Priority: P1) 🎯 MVP

**Goal**: Route success notifications to dedicated destination instead of reusing violation alert channels.

**Independent Test**: Configure an inventory with `successNotification` pointing to a different channel than violation destinations, run workflow, verify success message goes to configured destination.

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T005 [P] [US1] Add unit test for `alertOnSuccess` using `successNotification` destination in `src/services/alert/slack.test.ts`
- [ ] T006 [P] [US1] Add unit test verifying existing `alertForTypedResults` continues using violation destinations unchanged in `src/services/alert/slack.test.ts`

### Implementation for User Story 1

- [ ] T007 [US1] Update `alertOnSuccess()` in `src/services/alert/slack.ts` to use `alertDestinations.successNotification` directly (depends on T005 failing)
- [ ] T008 [US1] Delete `selectSuccessDestination()` private method from `src/services/alert/slack.ts` (no longer needed)
- [ ] T009 [US1] Update `alertOnSuccess()` JSDoc in `src/interfaces/alert.ts` to document new behavior
- [ ] T010 [US1] Run `npm run test:unit` to verify T005 and T006 pass
- [ ] T011 [US1] Run `npm run check:typing` to verify no type errors

**Checkpoint**: User Story 1 complete - success notifications now route to dedicated destination.

---

## Phase 4: User Story 2 - Validate required success destination (Priority: P2)

**Goal**: Fail fast when inventory files are missing or have invalid `successNotification` configuration.

**Independent Test**: Load inventory file without `successNotification` field and verify Zod validation error. Load inventory with empty destination string and verify validation error.

### Tests for User Story 2

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T012 [P] [US2] Add unit test for `InventoryAlertSchema` rejecting missing `successNotification` in `src/types/inventory/zod.test.ts`
- [ ] T013 [P] [US2] Add unit test for `AlertDestinationSchema` rejecting empty destination string in `src/types/inventory/zod.test.ts`
- [ ] T014 [P] [US2] Add unit test for `InventoryAlertSchema` accepting valid `successNotification` in `src/types/inventory/zod.test.ts`

### Implementation for User Story 2

- [ ] T015 [US2] Run `npm run test:unit` to verify T012, T013, T014 pass (schema already updated in Foundational phase)
- [ ] T016 [US2] Verify Zod error messages are actionable (check test output includes "Alert destination cannot be empty")

**Checkpoint**: User Story 2 complete - validation errors provide clear feedback.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup.

- [ ] T017 [P] Update example inventory files in `specs/` to include `successNotification` field
- [ ] T018 Run `npm run check:formatting` and fix any formatting issues
- [ ] T019 Run `npm run check:linting` and fix any linting issues
- [ ] T020 Run `npm run test:integration` to verify end-to-end behavior
- [ ] T021 Run `npm run precommit` for full validation suite
- [ ] T022 Review quickstart.md deployment checklist items

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped - no setup required
- **Foundational (Phase 2)**: No dependencies - can start immediately
- **User Story 1 (Phase 3)**: Depends on Foundational (T001-T004) completion
- **User Story 2 (Phase 4)**: Depends on Foundational (T001-T004) completion - can run in parallel with US1
- **Polish (Phase 5)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on US2
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - No dependencies on US1

Both user stories can be implemented in parallel after the foundational schema changes are complete.

### Within Each Phase

- Tests MUST be written and FAIL before implementation (T005, T006 before T007-T008; T012-T014 before T015)
- Schema changes before service changes
- Type checking after each significant change

### Parallel Opportunities

- **Phase 2**: T001 and T002 can run in parallel (different parts of schema)
- **Phase 3**: T005 and T006 can run in parallel (different test cases)
- **Phase 4**: T012, T013, T014 can run in parallel (different test cases)
- **Phase 5**: T017 can run in parallel with T018-T019

---

## Parallel Example: Foundational Phase

```bash
# Launch schema updates together:
Task: "Add successNotification field to InventoryAlert type in src/types/inventory/model.ts"
Task: "Strengthen AlertDestinationSchema validation in src/types/inventory/zod.ts"
```

## Parallel Example: User Story 1 Tests

```bash
# Launch all tests for User Story 1 together:
Task: "Add unit test for alertOnSuccess using successNotification destination in src/services/alert/slack.test.ts"
Task: "Add unit test verifying alertForTypedResults continues unchanged in src/services/alert/slack.test.ts"
```

## Parallel Example: User Story 2 Tests

```bash
# Launch all validation tests together:
Task: "Add unit test for InventoryAlertSchema rejecting missing successNotification in src/types/inventory/zod.test.ts"
Task: "Add unit test for AlertDestinationSchema rejecting empty destination string in src/types/inventory/zod.test.ts"
Task: "Add unit test for InventoryAlertSchema accepting valid successNotification in src/types/inventory/zod.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T004)
2. Complete Phase 3: User Story 1 (T005-T011)
3. **STOP and VALIDATE**: Test that success notifications route correctly
4. Deploy if ready (inventory files must include `successNotification` first!)

### Incremental Delivery

1. Complete Foundational → Schema ready
2. Add User Story 1 → Success routing works → Test independently
3. Add User Story 2 → Validation errors work → Test independently
4. Complete Polish → Full validation suite passes

### Parallel Team Strategy

With two developers:
1. Both complete Foundational phase together
2. Once Foundational is done:
   - Developer A: User Story 1 (routing logic)
   - Developer B: User Story 2 (validation tests)
3. Merge and complete Polish phase

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing (TDD approach per quickstart.md)
- Commit after each task or logical group
- **CRITICAL**: Inventory files in external repository must be updated with `successNotification` field before deploying this code change (breaking schema change)
