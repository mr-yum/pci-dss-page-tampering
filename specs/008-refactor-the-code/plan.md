# Implementation Plan: Command-Line Driven Execution Model

**Branch**: `008-refactor-the-code` | **Date**: 2025-11-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-refactor-the-code/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor the codebase to support flexible command-line driven execution, enabling:
- Selective execution of inventory or detection workflows independently
- Configuration via CLI parameters instead of hardcoded values or environment variables
- Support for custom Git repository URLs (removing vendor lock-in)
- Branch override capabilities for feature/release workflow testing
- `--mode all` default behavior maintaining backward compatibility (inventory first, then detection)
- Comprehensive `--help` documentation for CLI discoverability

Technical approach: Introduce CLI argument parsing layer, refactor main.ts to accept runtime configuration, update GitInventoryStore to accept dynamic branch names, and maintain existing service architecture without breaking changes to comparison/detection logic.

## Technical Context

**Language/Version**: TypeScript (via Node.js 22+, npm 10+)
**Primary Dependencies**:
- Core: `puppeteer` (^24.16.0), `simple-git` (^3.28.0), `zod` (^4.0.17)
- Build: `@mr-yum/node-builder` (^4), `tsx` (^4.20.3)
- Testing: `@types/jest` (^30.0.0), Jest (via node-builder preset)

**Storage**: Git repository (external, user-provided URL) for inventory JSON files
**Testing**: Jest unit tests (co-located with source in `src/`), integration tests (`test/integration/`)
**Target Platform**: Node.js CLI application, runs in CI/CD (GitHub Actions) and local environments
**Project Type**: Single project (CLI + services architecture)
**Performance Goals**:
- Single target execution in <30 seconds (excluding network I/O)
- Support for 10+ targets without linear performance degradation
- Browser instance reuse across workflows to reduce overhead

**Constraints**:
- Must maintain PCI DSS compliance (dual-workflow integrity, audit trail)
- Zero breaking changes to comparison services or matcher system
- Must work with file:// protocol for local testing
- Exit codes must support CI/CD decision making (0 = success, non-zero = failure)

**Scale/Scope**:
- 2-10 target configurations per repository
- CLI with 8 parameters (mode, target, repo, git-token, slack-token, inventory-branch, detection-branch, help)
- Refactor affects: main.ts (~140 LOC), GitInventoryStore (~130 LOC), constants.ts (~10 LOC)
- New modules: CLI parser (~100 LOC), configuration builder (~50 LOC)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle I: Security-First Development ✅ PASS

**Assessment**: This refactor does NOT modify any security-critical code paths:
- No changes to ScriptComparisonService, HeaderComparisonService, or matcher implementations
- Hash verification logic remains untouched
- Fail-secure behavior (null/empty content → UnknownScriptFound) preserved
- CLI parameters do not bypass or weaken any security controls

**Justification**: Changes are limited to orchestration (main.ts) and configuration delivery. The underlying security mechanisms remain unchanged.

### Principle II: Dual-Workflow Integrity ✅ PASS

**Assessment**: Refactor enhances dual-workflow separation:
- `--mode inventory` explicitly executes inventory workflow only (pushes to Git)
- `--mode detection` explicitly executes detection workflow only (read-only)
- `--mode all` maintains current sequential behavior (inventory first, detection second)
- FR-022: Inventory failure during `--mode all` prevents detection execution (fail-fast)

**Concerns Addressed**:
- `--inventory-branch` and `--detection-branch` can be different (recommended)
- If same branch used, system pulls latest before each workflow (no stale data)
- Detection workflow never has write access to inventory repository

### Principle III: Git-Based Audit Trail ✅ PASS

**Assessment**: Audit trail preserved and enhanced:
- All inventory commits continue through existing GitInventoryStore.push() path
- Commit messages unchanged ("Update scripts")
- Branch configurability enables separate audit trails per environment (dev/staging/prod branches)
- No force-push capabilities added

**Enhancement**: Custom `--repo` parameter enables organizations to maintain separate audit repositories per team/environment.

### Principle IV: Alert Completeness and Routing ✅ PASS

**Assessment**: Alert system unchanged:
- SlackAlertService continues to receive typed comparison results
- Alert categories remain: new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected
- `--slack-token` optional: if omitted, logs to console (development convenience, not production)

**No regressions**: CLI parameters do not affect alert routing, content, or delivery logic.

### Principle V: Test Coverage for Security Logic ✅ PASS

**Assessment**: Refactor does NOT reduce test coverage:
- Comparison services remain unchanged (existing unit tests preserved)
- Hash utilities remain unchanged (existing unit tests preserved)
- Matcher implementations remain unchanged (existing unit tests preserved)
- New CLI parsing and configuration logic MUST add new unit tests (co-located in `src/`)

**Testing Requirements for This Feature**:
- Unit tests for CLI argument parser (validate required params, defaults, validation)
- Unit tests for configuration builder (CLI args → service config)
- Integration tests for main.ts orchestration (mode selection, workflow sequencing)
- Integration tests for GitInventoryStore with dynamic branches

### Principle VI: Minimal Complexity ⚠️ REQUIRES JUSTIFICATION

**Assessment**: This refactor introduces new abstractions:

| New Abstraction              | Justification                                                                       | Simpler Alternative Rejected Because                                    |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| CLI argument parser          | Required for FR-001 through FR-009 (parameterized execution)                        | Hardcoded execution doesn't support build pipeline integration (P1 requirement) |
| Configuration builder        | Consolidates CLI args + defaults → runtime config object                            | Inline parsing in main.ts creates unmaintainable 200+ LOC function      |
| Dynamic branch configuration | Required for FR-006, FR-007 (feature branch testing)                                | Environment variables only (removed per spec) don't support per-execution branch control |

**Complexity Justification**:
- CLI parser is NECESSARY for primary user story (P1: Build Pipeline Integration)
- Abstractions are minimal (2 new modules, ~150 LOC total)
- Existing patterns preserved: Zod schemas for validation, service architecture unchanged
- Communicable code: CLI parsing is standard Node.js pattern (process.argv)

**Rejected Alternatives**:
- Configuration file approach: Rejected (out of scope per spec, adds file I/O complexity)
- Interactive prompts: Rejected (out of scope per spec, incompatible with CI/CD)
- Keep environment variables: Rejected (spec explicitly requires removal for vendor neutrality)

## Project Structure

### Documentation (this feature)

```
specs/008-refactor-the-code/
├── spec.md              # Feature specification (user requirements)
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0: CLI parsing library research
├── data-model.md        # Phase 1: Configuration data structures
├── quickstart.md        # Phase 1: Developer quick start guide
├── contracts/           # Phase 1: CLI parameter schemas
│   └── cli-args.schema.json
└── checklists/
    └── requirements.md  # Specification quality validation
```

### Source Code (repository root)

```
src/
├── cli/                    # NEW: Command-line interface layer
│   ├── parser.ts           # Argument parsing (--mode, --repo, etc.)
│   ├── parser.test.ts      # Unit tests for argument validation
│   ├── config.ts           # Build runtime configuration from CLI args
│   ├── config.test.ts      # Unit tests for config builder
│   └── help.ts             # Help text generation (--help output)
├── main.ts                 # MODIFIED: Accept CLI config, orchestrate workflows
├── main.test.ts            # NEW: Integration tests for orchestration
├── services/
│   ├── detection.ts        # UNCHANGED
│   ├── inventory.ts        # UNCHANGED
│   └── comparison/         # UNCHANGED
├── stores/
│   └── inventory/
│       ├── git.ts          # MODIFIED: Accept runtime branch names
│       └── git.test.ts     # NEW: Tests for dynamic branch behavior
├── utils/
│   └── constants.ts        # MODIFIED: Remove environment variable reads
└── types/
    ├── cli.ts              # NEW: CLI argument types
    └── config.ts           # NEW: Runtime configuration types

test/
├── integration/
│   ├── cli-modes.test.ts   # NEW: Test --mode inventory/detection/all
│   ├── cli-branches.test.ts # NEW: Test branch override behavior
│   └── cli-validation.test.ts # NEW: Test parameter validation
└── [existing tests unchanged]
```

**Structure Decision**: Single project structure maintained. New `src/cli/` directory added for command-line interface layer. This preserves existing service architecture (DetectionService, InventoryService, ComparisonServices) while adding thin orchestration layer for parameterized execution.

## Complexity Tracking

_Filled per Constitution Principle VI assessment above_

| Violation                     | Why Needed                                              | Simpler Alternative Rejected Because                                          |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CLI argument parser module    | Required for FR-001 to FR-009 (parameterized execution) | Hardcoded execution doesn't support P1 requirement (build pipeline integration) |
| Configuration builder module  | Consolidates CLI args + defaults into runtime config    | Inline parsing in main.ts creates unmaintainable 200+ LOC function            |
| Dynamic branch configuration  | Required for FR-006, FR-007 (feature branch testing)    | Environment variables don't support per-execution branch control              |

**Net Complexity Impact**: +2 new modules (~150 LOC), -1 hardcoded dependency (mr-yum repo URL), -4 environment variable reads. Overall: Increases configurability, decreases vendor lock-in, maintains service layer simplicity.

## Phase 0: Research & Technology Decisions

See [research.md](./research.md) for detailed findings.

### Key Decisions Summary

1. **CLI Parsing Library**: [To be researched]
   - Options: Native `process.argv` parsing, `yargs`, `commander`, `minimist`
   - Decision criteria: Zero additional dependencies preferred (Principle VI), TypeScript support, validation capabilities

2. **Configuration Validation**: [To be researched]
   - Likely: Zod schemas (existing pattern in codebase)
   - Validates CLI arguments before execution, fail-fast on invalid input

3. **Help Text Format**: [To be researched]
   - Plain text output to stdout (no colors/formatting per spec out-of-scope)
   - Include parameter descriptions, required/optional status, defaults, examples

4. **Branch Name Handling**: [To be researched]
   - How to pass runtime branch names to GitInventoryStore
   - Constructor parameter vs. method parameter trade-offs

5. **Exit Code Strategy**: [To be researched]
   - Success: 0
   - Validation failure: 1
   - Execution failure: 2
   - Help display: 0

## Phase 1: Design Artifacts

### Data Model

See [data-model.md](./data-model.md) for detailed entity definitions.

**Key Entities**:
- `CliArguments`: Parsed command-line parameters
- `RuntimeConfiguration`: Validated configuration object passed to services
- `ExecutionMode`: Enum (inventory | detection | all)
- `ExecutionResult`: Success/failure with exit code

### API Contracts

See [contracts/](./contracts/) for schemas.

**CLI Parameter Schema** (`cli-args.schema.json`):
- Defines all parameters with types, validation rules, defaults
- Used for generating help text and validating input

### Quick Start

See [quickstart.md](./quickstart.md) for developer onboarding guide.

## Phase 2: Implementation Tasks

_Generated by `/speckit.tasks` command - NOT created during `/speckit.plan`_

See [tasks.md](./tasks.md) for prioritized, dependency-ordered task breakdown.

## Migration Notes

**Breaking Changes**:
- Environment variables no longer used for repo, git-token, slack-token, branch names
- `--repo` and `--git-token` now required for HTTPS repositories
- `--mode` defaults to `all` (maintains behavior but requires explicit args)

**Migration Path**:
1. Update GitHub Actions workflows to pass `--repo` and `--git-token` explicitly
2. Update CI/CD pipelines to use `--mode inventory` for deployment validation
3. Update scheduled jobs to pass all required parameters (can omit `--mode` for default `all` behavior)
4. Remove environment variable configuration from deployment manifests

**Example Migration**:

Before (environment variables):
```yaml
env:
  INVENTORY_REPO_PAT: ${{ secrets.GH_TOKEN }}
  SLACK_OAUTH_TOKEN: ${{ secrets.SLACK_TOKEN }}
run: npm start
```

After (CLI parameters):
```yaml
run: |
  npm start -- \
    --repo https://github.com/org/inventory \
    --git-token ${{ secrets.GH_TOKEN }} \
    --slack-token ${{ secrets.SLACK_TOKEN }}
```

## Risk Assessment

**High Risk**:
- None (refactor does not touch security-critical comparison logic)

**Medium Risk**:
- CLI parsing bugs could prevent execution (mitigated by: comprehensive unit tests, validation tests)
- Branch name validation could allow invalid Git refs (mitigated by: fail-fast on Git errors, integration tests)

**Low Risk**:
- Help text formatting issues (mitigated by: manual review, out-of-scope for colors anyway)
- Exit code inconsistencies (mitigated by: explicit exit code strategy, integration tests)

## Success Metrics

From spec.md Success Criteria:

- **SC-001**: Single target execution <30s (current: ~45s for all targets) ✅ ACHIEVABLE
- **SC-002**: Exit codes work in CI/CD ✅ TESTABLE via integration tests
- **SC-003**: Any Git repo URL works ✅ TESTABLE via file:// and HTTPS tests
- **SC-004**: 80% resource reduction for single target ✅ MEASURABLE via benchmarks
- **SC-005**: Help text understandable in 2 minutes ✅ VERIFIABLE via user testing
- **SC-006**: Local file:// repos work ✅ TESTABLE via integration tests
- **SC-007**: Zero hardcoded organization config ✅ VERIFIABLE via code review
- **SC-008**: Scheduled jobs work with --mode all ✅ TESTABLE via integration tests
- **SC-009**: Backward compatibility via --mode all default ✅ TESTABLE via integration tests

## Post-Design Constitution Re-Check

_Completed after Phase 1 design artifacts generated_

[✅] **Principle I: Security-First Development** - Re-verified with data model
- Data model includes no security bypasses
- RuntimeConfiguration immutable (prevents accidental security weakening)
- Git token handled securely (not logged in error messages per data-model.md)
- Exit codes distinguish validation vs. execution errors (aids security debugging)
- No changes to comparison, hashing, or matcher logic (security core untouched)

[✅] **Principle II: Dual-Workflow Integrity** - Re-verified with execution flow
- ExecutionMode enum enforces separation (inventory | detection | all)
- State machine in data-model.md shows clear workflow boundaries
- `--mode all` executes inventory FIRST, then detection (maintains staging→production flow)
- FR-022 enforced: inventory failure during `--mode all` prevents detection (fail-fast)
- Branch configuration allows separate branches (inventoryBranch, detectionBranch)
- GitInventoryStore.push() only called during inventory mode (per main.ts orchestration)

[✅] **Principle III: Git-Based Audit Trail** - Re-verified with branch handling
- All inventory commits continue through existing GitInventoryStore.push() path
- Branch override capability (--inventory-branch) enables per-environment audit trails
- No force-push capabilities in design
- RuntimeConfiguration includes branch names for full traceability
- Git history remains immutable (simple-git library doesn't support rewriting history)

[✅] **Principle IV: Alert Completeness** - Re-verified with configuration flow
- AlertingConfiguration in RuntimeConfiguration preserves all alert routing
- SlackAlertService receives same typed comparison results (no changes)
- Console fallback when --slack-token omitted (documented in quickstart.md)
- Alert categories unchanged: new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected
- No alert bypasses in CLI parameter handling

[✅] **Principle V: Test Coverage** - Re-verified with test plan
- Testing strategy in research.md covers all new code paths:
  - Unit tests: parser.test.ts, config.test.ts (co-located in src/)
  - Integration tests: cli-modes.test.ts, cli-branches.test.ts, cli-validation.test.ts
- Existing test coverage preserved (no changes to comparison services)
- quickstart.md documents testing workflow for developers
- Test scenarios cover error paths (validation, execution failures)

[✅] **Principle VI: Minimal Complexity** - Re-verified with final architecture
- Final architecture: 5 new files (~250 LOC total), 3 modified files (~50 LOC changes)
- Technology decisions in research.md justify zero new dependencies (native process.argv parsing)
- Data model uses existing patterns (Zod schemas, TypeScript types)
- No unnecessary abstractions added (configuration builder is 50 LOC helper function)
- Complexity tracking table in plan.md documents all justifications
- Net complexity: +2 modules (CLI layer), -1 hardcoded dependency (vendor URL), -4 env var reads

**Overall Assessment**: ✅ PASS - All constitution principles maintained or enhanced after design phase
