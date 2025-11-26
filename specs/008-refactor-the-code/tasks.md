# Tasks: Command-Line Driven Execution Model

**Input**: Design documents from `/specs/008-refactor-the-code/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Unit tests and integration tests are included based on plan.md requirements (Principle V: Test Coverage)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` and `test/` at repository root
- Unit tests: Co-located with source files in `src/` (e.g., `src/cli/parser.test.ts`)
- Integration tests: Located in `test/integration/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create CLI type definitions and schema that all user stories depend on

- [x] T001 Create CLI types file in src/types/cli.ts with RawCliArgs, CliArguments, ExitCode types
- [x] T002 Create Zod schema for CLI arguments (CliArgsSchema) in src/types/cli.ts per data-model.md
- [x] T003 [P] Create RuntimeConfiguration types in src/types/config.ts (ExecutionMode, TargetFilter, BranchConfiguration, etc.)
- [x] T004 [P] Create src/cli/ directory structure for CLI layer modules

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core CLI parsing and configuration infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement native process.argv parser in src/cli/parser.ts (handles --key value and --key=value formats)
- [x] T006 Implement buildConfiguration function in src/cli/config.ts (validates with Zod, applies defaults, formats repository URL)
- [x] T007 [P] Implement help text generation in src/cli/help.ts with formatted parameter documentation
- [x] T008 [P] Write unit tests for CLI parser in src/cli/parser.test.ts (test all formats, edge cases)
- [x] T009 [P] Write unit tests for config builder in src/cli/config.test.ts (test validation, defaults, derived fields)
- [x] T010 Update GitInventoryStore.pull() in src/stores/inventory/git.ts to accept optional branchName parameter
- [x] T011 Update GitInventoryStore.push() in src/stores/inventory/git.ts to accept optional branchName parameter
- [x] T012 [P] Write unit tests for GitInventoryStore with dynamic branches in src/stores/inventory/git.test.ts
- [x] T013 Remove environment variable reads from src/utils/constants.ts (GIT_UPDATED_SCRIPTS_BRANCH_NAME, GIT_DETECTION_SCRIPTS_BRANCH_NAME)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Build Pipeline Integration (Priority: P1) 🎯 MVP

**Goal**: Enable CI/CD pipelines to run inventory stage for specific targets with proper exit codes, support scheduled monitoring with --mode all, and provide --help documentation

**Independent Test**: Run `npm start -- --mode inventory --target 1.0 --repo <url> --git-token <token>` and verify only target 1.0 is processed, inventory is updated, and exit code is 0 on success

**Dependencies**: Requires Phase 2 complete (CLI parsing, config building, GitInventoryStore updates)

### Implementation for User Story 1

- [x] T014 [US1] Refactor main.ts to accept RuntimeConfiguration instead of environment variables
- [x] T015 [US1] Implement CLI argument parsing and validation in main.ts (call parser.ts and config.ts)
- [x] T016 [US1] Implement --help flag handling in main.ts (display help and exit with code 0)
- [x] T017 [US1] Implement --mode inventory logic in main.ts (execute inventory workflow only, pass branch to GitInventoryStore)
- [x] T018 [US1] Implement --target filtering in main.ts (filter inventory array to single target if specified)
- [x] T019 [US1] Implement exit code handling in main.ts (ExitCode.Success, ValidationError, ExecutionError)
- [x] T020 [US1] Remove hardcoded repository URL from main.ts (use config.repository.url and config.authentication.repositoryTarget)
- [x] T021 [US1] Implement --mode all logic in main.ts (inventory first, then detection sequentially)
- [x] T022 [US1] Implement fail-fast for --mode all in main.ts (exit on inventory failure without running detection)
- [x] T023 [US1] Add error handling for missing required parameters in main.ts (display help, exit with code 1)
- [x] T024 [US1] Add error handling for target validation in main.ts (check target exists in inventory, exit with code 2 if not)

### Integration Tests for User Story 1

- [x] T025 [P] [US1] Integration test for --mode inventory in test/integration/cli-modes.test.ts
- [x] T026 [P] [US1] Integration test for --mode all in test/integration/cli-modes.test.ts
- [x] T027 [P] [US1] Integration test for --target filtering in test/integration/cli-modes.test.ts
- [x] T028 [P] [US1] Integration test for --help flag in test/integration/cli-help.test.ts
- [x] T029 [P] [US1] Integration test for missing required parameters in test/integration/cli-validation.test.ts
- [x] T030 [P] [US1] Integration test for invalid target name in test/integration/cli-validation.test.ts
- [x] T031 [P] [US1] Integration test for --inventory-branch override in test/integration/cli-branches.test.ts
- [x] T032 [P] [US1] Integration test for exit codes in test/integration/cli-validation.test.ts

**Checkpoint**: At this point, User Story 1 should be fully functional - CI/CD pipelines can use --mode inventory with --target, --help works, --mode all works for scheduled monitoring, proper exit codes

---

## Phase 4: User Story 2 - Selective Detection Monitoring (Priority: P2)

**Goal**: Enable operations teams to run detection checks on specific production targets on-demand with custom branch support

**Independent Test**: Run `npm start -- --mode detection --target 2.0 --repo <url> --git-token <token>` and verify only target 2.0's detection workflow executes (read-only, no inventory changes)

**Dependencies**: Requires Phase 3 complete (US1 provides --mode and --target infrastructure)

### Implementation for User Story 2

- [ ] T033 [US2] Implement --mode detection logic in main.ts (execute detection workflow only, pass detection branch to GitInventoryStore.pull)
- [ ] T034 [US2] Ensure detection mode is read-only in main.ts (never calls GitInventoryStore.push)
- [ ] T035 [US2] Implement --detection-branch override in main.ts (pass to GitInventoryStore.pull for detection workflow)
- [ ] T036 [US2] Verify alert routing works in detection mode (SlackAlertService or console based on --slack-token)

### Integration Tests for User Story 2

- [ ] T037 [P] [US2] Integration test for --mode detection in test/integration/cli-modes.test.ts
- [ ] T038 [P] [US2] Integration test for --detection-branch override in test/integration/cli-branches.test.ts
- [ ] T039 [P] [US2] Integration test verifying detection mode doesn't modify inventory in test/integration/cli-modes.test.ts
- [ ] T040 [P] [US2] Integration test for alert routing (console vs Slack) in test/integration/cli-modes.test.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - detection can run separately from inventory

---

## Phase 5: User Story 3 - Local Development Testing (Priority: P3)

**Goal**: Enable developers to test workflows locally using file:// protocol repositories without Slack alerts

**Independent Test**: Run `npm start -- --repo file:///local/path/test-inventory --git-token dummy` and verify local repository is used, console logging works

**Dependencies**: Requires Phase 3 complete (US1 provides core functionality that US3 extends for local use)

### Implementation for User Story 3

- [ ] T041 [US3] Add file:// protocol support validation in src/cli/config.ts (Zod schema already supports URLs, verify file:// works)
- [ ] T042 [US3] Implement console logging fallback in main.ts when --slack-token is omitted
- [ ] T043 [US3] Update help text in src/cli/help.ts to include local testing examples with file:// protocol
- [ ] T044 [US3] Document console vs Slack alerting behavior in help text

### Integration Tests for User Story 3

- [ ] T045 [P] [US3] Integration test for file:// protocol repository in test/integration/cli-validation.test.ts
- [ ] T046 [P] [US3] Integration test for console logging (no --slack-token) in test/integration/cli-modes.test.ts
- [ ] T047 [P] [US3] End-to-end test with local file-based repository in test/integration/cli-validation.test.ts

**Checkpoint**: All user stories should now be independently functional - developers can test locally, pipelines can use inventory/detection modes, operations can monitor on-demand

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, error handling enhancements, documentation

- [ ] T048 Add comprehensive error messages for Git authentication failures in main.ts
- [ ] T049 Add comprehensive error messages for malformed repository URLs in main.ts
- [ ] T050 Add comprehensive error messages for invalid branch names in main.ts
- [ ] T051 [P] Validate URL format for --repo parameter returns helpful error (not just "invalid URL")
- [ ] T052 [P] Add logging for CLI configuration at startup (log parsed config, redact sensitive tokens)
- [ ] T053 [P] Update README.md or CLAUDE.md with CLI usage instructions (reference quickstart.md)
- [ ] T054 Verify all environment variable reads removed from codebase (grep for INVENTORY_REPO_PAT, SLACK_OAUTH_TOKEN, etc.)
- [ ] T055 Run full precommit check (formatting, linting, typing, unit tests, integration tests)
- [ ] T056 Manual testing with GitHub Actions workflow (update .github/workflows/ to use CLI parameters)

---

## Implementation Strategy

### MVP Scope (Minimum Viable Product)

**Start with User Story 1 only** - this delivers the primary value:

- ✅ CI/CD pipeline integration with --mode inventory
- ✅ Target filtering with --target
- ✅ Custom repository with --repo
- ✅ Branch override with --inventory-branch
- ✅ Scheduled monitoring with --mode all
- ✅ Help documentation with --help
- ✅ Exit codes for CI/CD

User Stories 2 and 3 are **enhancements** that can be added incrementally.

### Incremental Delivery

1. **Phase 1 + Phase 2**: Complete foundational infrastructure (days 1-2)
2. **Phase 3 (US1)**: Deliver MVP - build pipeline integration (days 3-4)
3. **Phase 4 (US2)**: Add detection mode - operations monitoring (day 5)
4. **Phase 5 (US3)**: Add local testing - developer experience (day 6)
5. **Phase 6**: Polish and production readiness (day 7)

### Parallel Execution Opportunities

**Phase 1 (Setup)**: All tasks can run in parallel

- T001-T004: Different files, no dependencies

**Phase 2 (Foundation)**: Mixed parallelization

- T005-T007: Can run in parallel (different modules)
- T008-T009: Can run in parallel with each other (after T005, T006 complete)
- T010-T012: Can run in parallel with T005-T009 (independent Git store changes)
- T013: Can run in parallel with everything

**Phase 3 (US1)**: Sequential orchestration, parallel tests

- T014-T024: Must run sequentially (main.ts orchestration logic)
- T025-T032: Can all run in parallel once T014-T024 complete

**Phase 4 (US2)**: Small changes, parallel tests

- T033-T036: Sequential (main.ts modifications)
- T037-T040: Can all run in parallel once T033-T036 complete

**Phase 5 (US3)**: Mostly parallel

- T041-T044: Can run in parallel (different files)
- T045-T047: Can all run in parallel once T041-T044 complete

**Phase 6 (Polish)**: Mostly parallel

- T048-T052: Can run in parallel (different error scenarios)
- T053-T054: Can run in parallel
- T055-T056: Must run sequentially at end

### Estimated Timeline

- **Phase 1**: 2 hours (simple type definitions)
- **Phase 2**: 8 hours (parser, config builder, Git store updates, tests)
- **Phase 3**: 12 hours (main.ts refactor, all US1 features, integration tests)
- **Phase 4**: 4 hours (detection mode, tests)
- **Phase 5**: 4 hours (local testing support, tests)
- **Phase 6**: 4 hours (polish, documentation, final validation)

**Total**: ~34 hours (~5 working days)

## Dependencies Between User Stories

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundation) ← MUST COMPLETE FIRST
    ↓
    ├─→ Phase 3 (US1: Build Pipeline) ← MVP, HIGHEST PRIORITY
    │       ↓
    │       ├─→ Phase 4 (US2: Detection Monitoring)
    │       └─→ Phase 5 (US3: Local Testing)
    └─→ Phase 6 (Polish)
```

**Critical Path**: Phase 1 → Phase 2 → Phase 3 (US1)

**User Stories are independent after Phase 3**:

- US2 (Detection) can be implemented without US3 (Local Testing)
- US3 (Local Testing) can be implemented without US2 (Detection)
- Both US2 and US3 depend on US1 infrastructure

## Task Summary

**Total Tasks**: 56

**By Phase**:

- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundation): 9 tasks
- Phase 3 (US1): 19 tasks (11 implementation + 8 integration tests)
- Phase 4 (US2): 8 tasks (4 implementation + 4 integration tests)
- Phase 5 (US3): 7 tasks (4 implementation + 3 integration tests)
- Phase 6 (Polish): 9 tasks

**By User Story**:

- US1 (Build Pipeline Integration): 19 tasks
- US2 (Selective Detection Monitoring): 8 tasks
- US3 (Local Development Testing): 7 tasks
- Infrastructure (Setup + Foundation): 13 tasks
- Polish: 9 tasks

**Parallel Opportunities**:

- Phase 1: 4 tasks (all parallel)
- Phase 2: 6 tasks (T005-T007, T010-T013 can overlap)
- Phase 3: 8 integration tests (T025-T032 all parallel)
- Phase 4: 4 integration tests (T037-T040 all parallel)
- Phase 5: 7 tasks (T041-T047 mostly parallel)
- Phase 6: 5 tasks (T048-T052, T053-T054 parallel)

**Total parallel-capable tasks**: 34/56 (61%)

## Testing Strategy

### Unit Tests (Co-located in src/)

Per Constitution Principle V, unit tests MUST be co-located with source files:

- `src/cli/parser.test.ts`: Test argument parsing (--key value, --key=value, edge cases)
- `src/cli/config.test.ts`: Test validation, defaults, derived fields (repositoryTarget formatting)
- `src/stores/inventory/git.test.ts`: Test dynamic branch behavior (pull with branchName, push with branchName)

### Integration Tests (test/integration/)

- `test/integration/cli-modes.test.ts`: Test --mode inventory/detection/all execution
- `test/integration/cli-branches.test.ts`: Test --inventory-branch and --detection-branch overrides
- `test/integration/cli-validation.test.ts`: Test parameter validation, error messages, exit codes
- `test/integration/cli-help.test.ts`: Test --help output and exit code

### Test Coverage Requirements

Per plan.md and constitution:

- All new CLI parsing logic: Unit tested
- All configuration building logic: Unit tested
- All Git store branch handling: Unit tested
- All workflow orchestration modes: Integration tested
- All parameter validation: Integration tested
- All error scenarios: Integration tested

**Coverage Goal**: 100% of new code (parser, config, main.ts refactor)

## Success Criteria Verification

From spec.md Success Criteria, mapped to tasks:

- **SC-001**: Single target <30s → T018 (--target filtering)
- **SC-002**: Exit codes for CI/CD → T019 (exit code handling)
- **SC-003**: Any Git repo URL → T003, T020 (RuntimeConfiguration.repository.url)
- **SC-004**: 80% resource reduction → T018 (--target reduces processing)
- **SC-005**: Help understandable in 2min → T007, T016 (help text generation)
- **SC-006**: Local file:// repos → T041 (file:// protocol support)
- **SC-007**: Zero hardcoded config → T020, T054 (remove hardcoded repo, verify no env vars)
- **SC-008**: Scheduled jobs --mode all → T021 (--mode all implementation)
- **SC-009**: Backward compatibility → T021 (--mode all default maintains behavior)

All success criteria covered by implementation tasks.

## Format Validation

✅ All tasks follow checklist format: `- [ ] [ID] [P?] [Story?] Description with file path`
✅ Task IDs sequential: T001 through T056
✅ Story labels present for US1, US2, US3 phases
✅ [P] markers for parallel-capable tasks
✅ File paths included in all implementation task descriptions
