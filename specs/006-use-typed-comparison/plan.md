# Implementation Plan: Use Typed Comparison Results for Inventory Updates

**Branch**: `006-use-typed-comparison` | **Date**: 2025-10-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-use-typed-comparison/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor inventory updates to process typed comparison results (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, etc.) directly, eliminating conversions to legacy ScriptComparisonResult/HeaderComparisonSummary types. Implement a generic resource update handler that works for both scripts and headers, maintaining all existing behaviors while simplifying the codebase.

## Technical Context

**Language/Version**: TypeScript (Node.js >=22)
**Primary Dependencies**: Puppeteer 24.x, Zod 4.x, simple-git 3.x, Axios 1.x
**Storage**: Git repository for inventory storage (separate repo accessed via INVENTORY_REPO_PAT)
**Testing**: Jest (via @mr-yum/node-builder), unit tests alongside implementations
**Target Platform**: Linux server (GitHub Actions), macOS/Linux development
**Project Type**: Single project (scheduled detection service)
**Performance Goals**: Process multiple targets within CRON execution window (daily 12:00 PM UTC)
**Constraints**: Security-first (PCI DSS 6.4.3, 11.6.1), fail-secure behavior, read-only detection workflow
**Scale/Scope**: ~70 TypeScript files, matcher-based comparison system, dual workflow architecture

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Security-First Development
- ✅ **No security regressions**: Refactoring does not change comparison logic, hash verification, or alert behavior
- ✅ **Hash verification intact**: SHA-256 verification remains in typed comparison results
- ✅ **Alert coverage maintained**: Same alert categories generated from typed results
- ✅ **Audit trail preserved**: Git commits still track all inventory changes
- ✅ **Read-only detection**: Detection workflow separation unchanged
- ✅ **Fail-secure behavior**: Typed results already enforce UnknownScriptFound for null/empty content

**Status**: PASS - This is a pure refactoring with no security logic changes

### II. Dual-Workflow Integrity
- ✅ **Workflow separation maintained**: Inventory vs detection distinction unchanged
- ✅ **Git commits restricted**: InventoryService push behavior unchanged
- ✅ **Alert categories preserved**: new_inventory_script_identified vs uninventoried_script_detected still distinguished
- ✅ **Target structure unchanged**: inventoryUrl/detectionUrl still used

**Status**: PASS - No changes to workflow separation logic

### III. Git-Based Audit Trail
- ✅ **Commit tracking intact**: inventory.push() still creates commits for all changes
- ✅ **Commit messages preserved**: Same descriptive messages for new scripts/hashes/headers
- ✅ **No force-pushes**: No changes to Git repository operations
- ✅ **INVENTORY_REPO_PAT usage**: Repository access pattern unchanged

**Status**: PASS - Git audit trail logic untouched

### IV. Alert Completeness and Routing
- ✅ **Alert categories preserved**: All three categories (new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected) still generated
- ✅ **Context maintained**: Typed results contain all necessary context (URL, hash, matcher details)
- ✅ **Failure handling unchanged**: Alert failures still logged without blocking detection
- ✅ **Routing logic preserved**: inventory.alerts configuration still determines destinations

**Status**: PASS - Alert generation uses same typed results as input

### V. Test Coverage for Security Logic
- ✅ **Existing tests preserved**: ScriptComparisonService and HeaderComparisonService tests unchanged
- ⚠️ **New tests required**: Generic update handler needs new test coverage
- ✅ **Integration tests**: Existing workflow tests verify end-to-end behavior
- ✅ **Test-first approach**: Will write tests for new generic handler before implementation

**Status**: PASS (with commitment to add tests for new code)

### VI. Minimal Complexity
- ✅ **Complexity reduction**: Removes legacy ScriptComparisonResult/HeaderComparisonSummary types
- ✅ **Established patterns**: Uses existing Zod schemas and matcher strategy pattern
- ✅ **Generic handler justified**: Eliminates code duplication between script/header update logic
- ✅ **No new dependencies**: Uses existing TypeScript discriminated unions
- ✅ **YAGNI compliant**: Solves concrete problem (legacy type removal) not speculative future need

**Status**: PASS - Refactoring reduces complexity

## Project Structure

### Documentation (this feature)

```
specs/006-use-typed-comparison/
├── spec.md              # Feature specification (already exists)
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
src/
├── types/
│   ├── comparison/           # Typed comparison result types (UnknownScriptFound, etc.)
│   ├── inventory/            # Inventory Zod schemas
│   └── matcher/              # Matcher strategy pattern implementations
├── services/
│   ├── comparison/           # ScriptComparisonService, HeaderComparisonService
│   ├── inventory.ts          # InventoryService (MODIFIED: generic update handler)
│   └── detection.ts          # DetectionService
├── handlers/
│   ├── script.ts             # Script response handlers
│   └── header.ts             # Header response handlers
├── repositories/
│   └── inventory.ts          # InventoryRepository
├── stores/
│   └── inventory/
│       ├── git.ts            # GitInventoryStore
│       └── in-memory.ts      # InMemoryInventoryStore (testing)
└── utils/
    ├── inventory.ts          # Inventory utilities (MODIFIED: remove legacy conversion)
    └── script/
        └── matcher.ts        # Script matching utilities

tests/
├── integration/              # Full workflow tests (existing)
└── unit/                     # Tests alongside implementations (Jest)
    └── services/
        └── inventory.test.ts # NEW: Generic update handler tests
```

**Structure Decision**: Single project structure with tests alongside implementations following the existing @mr-yum/node-builder pattern. Key changes focus on `src/services/inventory.ts` and removing legacy conversion utilities from `src/utils/inventory.ts`.

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

No complexity violations - this refactoring reduces complexity by removing legacy types.

---

## Post-Design Constitution Re-Check

_Re-evaluation after Phase 1 design artifacts are complete_

### I. Security-First Development
- ✅ **No security regressions**: Design maintains all security behaviors
- ✅ **Hash verification intact**: SHA-256 verification logic unchanged
- ✅ **Alert coverage maintained**: All alert categories generated from typed results
- ✅ **Audit trail preserved**: Git commits still track all inventory changes via push()
- ✅ **Read-only detection**: Detection workflow validation added in diff() method
- ✅ **Fail-secure behavior**: Typed results enforce fail-secure (handled upstream in comparison services)

**Status**: PASS - Design maintains all security controls

### II. Dual-Workflow Integrity
- ✅ **Workflow separation maintained**: diff() validates all results are from inventory workflow (target.type check)
- ✅ **Git commits restricted**: push() behavior unchanged
- ✅ **Alert categories preserved**: Result types map directly to alert categories
- ✅ **Target structure unchanged**: Target validation in diff() ensures inventory-only processing

**Status**: PASS - Design enforces workflow separation

### III. Git-Based Audit Trail
- ✅ **Commit tracking intact**: push() still creates commits for all changes via InventoryDifferenceResult
- ✅ **Commit messages preserved**: Same descriptive messages for new scripts/hashes/headers
- ✅ **No force-pushes**: No changes to Git repository operations
- ✅ **INVENTORY_REPO_PAT usage**: Repository access pattern unchanged

**Status**: PASS - Git audit trail intact

### IV. Alert Completeness and Routing
- ✅ **Alert categories preserved**: ComparisonResultType discriminator maps to alert categories
- ✅ **Context maintained**: Typed results contain complete context (script, inventoryEntry, failureReason, metadataPath)
- ✅ **Failure handling unchanged**: Alert failures still logged without blocking detection (handled in alert service)
- ✅ **Routing logic preserved**: inventory.alerts configuration still determines destinations

**Status**: PASS - Alert generation improved with better type safety

### V. Test Coverage for Security Logic
- ✅ **Existing tests preserved**: ScriptComparisonService and HeaderComparisonService tests unchanged
- ✅ **New tests planned**: inventory.test.ts will cover processComparisonResult, addNewScript, updateScriptWithNewHash, etc.
- ✅ **Integration tests**: Existing workflow tests verify end-to-end behavior (should pass without modification)
- ✅ **Test-first approach**: Committed to writing tests alongside implementation (per research.md R9)

**Status**: PASS - Test strategy defined and adequate

### VI. Minimal Complexity
- ✅ **Complexity reduction**: Removes 3 legacy types, eliminates 2 conversions, reduces from 3 passes to 1
- ✅ **Established patterns**: Uses Zod schemas, matcher strategy pattern, discriminated unions
- ✅ **Generic handler justified**: Eliminates duplicate update logic for scripts vs headers
- ✅ **No new dependencies**: Uses existing TypeScript features (discriminated unions, exhaustive checking)
- ✅ **YAGNI compliant**: Solves concrete problem (legacy type removal), no speculative features added

**Status**: PASS - Design reduces complexity as intended

---

## Final Design Assessment

All constitution principles satisfied after Phase 1 design. The refactoring maintains all security controls, enforces dual-workflow integrity, preserves audit trail, improves type safety for alerts, defines adequate test coverage, and reduces system complexity. No violations to justify.

**Ready to proceed to Phase 2** (task generation via /speckit.tasks)
