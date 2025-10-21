# Implementation Plan: Embed Authorization Info in Authorization Entity

**Branch**: `004-enhance-the-schema` | **Date**: 2025-10-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-enhance-the-schema/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enhance the inventory schema to nest authorisationInfo within the authoriseWith entity, creating a cohesive authorization structure where matcher logic and metadata are directly linked. This refactoring improves data cohesion by consolidating authorization-related information (matcher configuration AND authorisation metadata) into a single composite structure, eliminating the current fragmented model where authorisationInfo exists as a sibling to authoriseWith.

## Technical Context

**Language/Version**: TypeScript with Node.js >= 22
**Primary Dependencies**: Zod (^4.0.17) for schema validation, Puppeteer (^24.16.0) for browser automation, simple-git (^3.28.0) for Git operations
**Storage**: Git repository for inventory storage (JSON files with Zod validation)
**Testing**: Jest via @mr-yum/node-builder (unit, integration, smoke test suites)
**Target Platform**: Linux server (GitHub Actions) and local development (macOS/Linux)
**Project Type**: Single project - PCI DSS compliance monitoring service
**Performance Goals**: Daily scheduled detection runs, sub-minute execution time for typical workflows
**Constraints**: Security-first (PCI DSS 6.4.3, 11.6.1 compliance), read-only detection workflow, Git audit trail required
**Scale/Scope**: Monitoring multiple payment page targets, ~10-50 scripts per target, scheduled execution

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Security-First Development (NON-NEGOTIABLE)

**Status**: ✅ PASS

- This refactoring does NOT bypass, disable, or weaken script hash verification
- Does NOT reduce alert coverage or sensitivity
- Maintains full Git audit trail (inventory files remain Git-tracked)
- Detection workflow remains read-only (no inventory mutations)
- Cryptographic hashing (SHA-256) unchanged
- Fail-secure behavior preserved: matcher pipeline logic unchanged, only data structure reorganized

**Justification**: This is a pure schema refactoring that reorganizes existing data without changing security logic.

### II. Dual-Workflow Integrity

**Status**: ✅ PASS

- No changes to inventory vs detection workflow separation
- InventoryService and DetectionService behavior unchanged
- Alert categories remain distinct
- Scheduled job execution order unaffected

**Justification**: Schema changes do not impact workflow logic or execution flow.

### III. Git-Based Audit Trail

**Status**: ✅ PASS

- Inventory files remain Git-tracked JSON files
- Commit behavior unchanged
- No force-push or history modification
- INVENTORY_REPO_PAT environment variable usage unchanged

**Justification**: Storage mechanism and Git operations remain identical; only the JSON structure within files changes.

### IV. Alert Completeness and Routing

**Status**: ✅ PASS

- All alert categories remain intact (new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected)
- Alert destinations unchanged
- Alert context preserved (script URL, hash, target, workflow step)

**Justification**: Comparison services will access authorisationInfo from new nested location, but alert generation logic remains unchanged.

### V. Test Coverage for Security Logic

**Status**: ✅ PASS (with work required)

- FR-010 through FR-013 explicitly require comprehensive test coverage
- Schema validation tests MUST cover new nested structure
- Round-trip serialization tests MUST verify data preservation
- Comparison service tests MUST verify authorization data access from new location
- Edge case tests required (missing authorisationInfo, null values, unauthorized entries)

**Justification**: Feature specification includes mandatory test requirements. Implementation must maintain or improve existing test coverage.

### VI. Minimal Complexity

**Status**: ✅ PASS

- Uses existing Zod schema validation (established pattern)
- Uses existing matcher strategy pattern (no new matcher types)
- No new dependencies required
- No new abstractions introduced; only reorganizes existing data structure
- Functional utilities for conversion (scriptInfoToInventoryScriptInfo, etc.) will be updated, not replaced

**Justification**: This is a simplification that improves data cohesion by reducing fragmentation. Complexity is reduced, not increased.

### PCI DSS Compliance Check

**6.4.3 Script Management**: ✅ No impact - Inventory structure enhanced, script tracking unchanged
**11.6.1 Detection and Alerting**: ✅ No impact - Detection and alert logic unchanged

### Gate Evaluation

**Overall Status**: ✅ ALL GATES PASS

This feature is a low-risk schema refactoring that improves data organization without changing security behavior. All constitution principles are satisfied. No violations require justification.

## Project Structure

### Documentation (this feature)

```
specs/004-enhance-the-schema/
├── spec.md              # Feature specification (input)
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
├── handlers/            # Response handlers for scripts and headers
├── interfaces/          # TypeScript interfaces for services
├── repositories/        # Data access layer for inventories
├── services/            # Core services (Detection, Inventory, Comparison, Alert)
│   ├── comparison/      # Script and Header comparison services
│   └── alert/          # Alert service implementations
├── stores/              # Storage implementations (Git, in-memory)
├── types/               # TypeScript types and Zod schemas
│   ├── inventory/       # Inventory-related types (InventoryScriptInfo, InventoryHeaderInfo, etc.)
│   ├── matcher/         # Matcher types (NameMatcher, ContentMatcher, HashMatcher, etc.)
│   ├── comparison/      # Comparison result types (UnknownScriptFound, AuthorizedScriptFound, etc.)
│   ├── script.ts        # ScriptInfo type
│   ├── detection.ts     # DetectionSummary type
│   └── target.ts        # Target type
├── utils/               # Utility functions (hashing, parsing, workflow conversion)
│   └── inventory/       # Inventory conversion utilities
├── workflows/           # Puppeteer workflow definitions
└── main.ts              # Entry point

test/
└── unit/                # Unit tests
    ├── services/        # Service tests
    │   └── comparison/  # Comparison service tests
    └── utils/           # Utility tests
        └── inventory/   # Inventory conversion tests
```

**Structure Decision**: Single project structure (Option 1). This is a backend Node.js service with no frontend or mobile components. Tests are organized by suite (unit, integration, smoke) with unit tests mirroring the src/ structure.

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

No violations to track. All constitution gates passed.

## Post-Design Constitution Re-evaluation

_Performed after Phase 1 design artifacts completed (research.md, data-model.md, contracts, quickstart.md)_

### Re-evaluation Results

All constitution principles remain satisfied after detailed design:

#### I. Security-First Development ✅
- **Confirmed**: No security logic changes in design
- **Confirmed**: Fail-secure behavior preserved (matcher pipeline unchanged)
- **Confirmed**: Git audit trail maintained (JSON file structure change only)
- **Design Impact**: Data model shows clear separation of concerns, security logic untouched

#### II. Dual-Workflow Integrity ✅
- **Confirmed**: No workflow changes in design
- **Confirmed**: Read-only detection workflow preserved
- **Design Impact**: Conversion functions updated but workflow logic unchanged

#### III. Git-Based Audit Trail ✅
- **Confirmed**: Git operations unchanged
- **Confirmed**: Commit workflow preserved
- **Design Impact**: JSON serialization format changed (nested structure), but Git tracking identical
- **Migration Plan**: Manual inventory update documented in quickstart.md

#### IV. Alert Completeness and Routing ✅
- **Confirmed**: Alert generation logic unchanged
- **Confirmed**: All alert categories preserved
- **Design Impact**: Comparison services access authorization metadata from new location, but alert content identical

#### V. Test Coverage for Security Logic ✅
- **Confirmed**: Comprehensive test requirements documented
- **Design Impact**:
  - Schema validation tests (zod.test.ts)
  - Round-trip serialization tests (script.test.ts, inventory.test.ts)
  - Comparison service tests (comparison/*.test.ts)
  - Edge case coverage documented in data-model.md
- **Contract Coverage**: Test contracts defined (contracts/type-contracts.md)

#### VI. Minimal Complexity ✅
- **Confirmed**: No new dependencies
- **Confirmed**: Uses established Zod pattern
- **Design Impact**:
  - New type `AuthorizeWithConfig` simplifies data model (reduces fragmentation)
  - Conversion functions updated but logic complexity unchanged (same operations, different structure)
  - No new abstractions beyond composite type wrapper

### Design Quality Assessment

**Data Model**:
- Clear entity definitions with validation rules
- Explicit state transitions documented
- Comprehensive edge case handling

**Contracts**:
- Well-defined integration points
- Breaking changes clearly documented
- Migration path specified

**Implementation Guide**:
- Phased approach reduces risk
- Verification steps at each phase
- Rollback plan documented

**Risks**: All identified as low or medium with clear mitigation strategies

### Final Gate Status: ✅ ALL GATES PASS POST-DESIGN

No new risks or violations introduced by design artifacts. Implementation may proceed to Phase 2 (tasks generation).
