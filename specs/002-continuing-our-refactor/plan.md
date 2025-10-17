# Implementation Plan: Header Comparison and Alert Refactor

**Branch**: `002-continuing-our-refactor` | **Date**: 2025-10-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-continuing-our-refactor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature extends the typed comparison result pattern established for scripts to the header comparison system, ensuring consistent, strongly-typed alert handling across the entire PCI DSS compliance monitoring system. The refactor introduces typed header comparison results (UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound), migrates the alert service to a unified typed handler, and applies the matcher architecture to headers for consistency with the script system.

## Technical Context

**Language/Version**: TypeScript (Node.js >= 22, NPM >= 10)
**Primary Dependencies**: Puppeteer 24.16.0, Zod 4.0.17, simple-git 3.28.0, axios 1.11.0
**Storage**: Git repository for inventory storage (separate repo accessed via PAT), file-based detection summaries
**Testing**: Jest via @mr-yum/node-builder (unit, integration in Docker, smoke tests)
**Target Platform**: Node.js server environment (Linux/macOS), scheduled execution via GitHub Actions
**Project Type**: Single project (backend monitoring service with CLI interface)
**Performance Goals**: Detection runs complete within scheduled CRON window (daily 12:00 PM UTC), Puppeteer workflows complete within browser timeout limits
**Constraints**: Must maintain audit trail in Git for PCI DSS compliance, detection workflow is read-only (no inventory mutations), alert failures must not block detection
**Scale/Scope**: Monitoring multiple payment page targets (staging and production URLs), processing scripts and headers per target, managing inventory across distributed Git repository

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Security-First Development (NON-NEGOTIABLE)
**Status**: ✅ PASS

This refactor maintains security posture by:
- Preserving all existing hash verification logic for scripts
- Extending typed comparison results to headers without reducing alert coverage
- Maintaining fail-secure behavior (null/empty content triggers UnknownHeaderFound)
- No bypass mechanisms introduced for security controls

### II. Dual-Workflow Integrity
**Status**: ✅ PASS

This refactor:
- Does not modify the inventory vs detection workflow separation
- Maintains read-only detection service behavior
- Preserves existing alert routing (inventory → newHeaderIdentified, detection → newHeaderDetected)
- Does not change Git commit behavior or inventory mutation logic

### III. Git-Based Audit Trail
**Status**: ✅ PASS

This refactor:
- Does not modify Git commit logic or audit trail behavior
- Preserves InventoryService commit patterns
- Does not affect repository access controls
- Maintains existing Git history integrity

### IV. Alert Completeness and Routing
**Status**: ✅ PASS with Enhancement

This refactor:
- Enhances alert context by providing typed results with complete information
- Maintains all existing alert categories (new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected)
- Adds equivalent header alert handling through unified typed approach
- Alert failures continue to log and not block detection
- Removes legacy alert methods after confirming typed handler covers all cases

**Enhancement**: Unified typed alert handler reduces code duplication and ensures consistent alert formatting across scripts and headers.

### V. Test Coverage for Security Logic
**Status**: ✅ PASS

This refactor:
- Requires unit tests for HeaderComparisonService typed result generation
- Requires unit tests for typed alert handler processing both script and header results
- Maintains existing ScriptComparisonService test coverage
- Follows refactoring protocol: write tests capturing current behavior before changes
- Uses Jest framework consistent with existing test infrastructure

### VI. Minimal Complexity
**Status**: ✅ PASS

This refactor:
- Reuses existing Matcher interface pattern (NameMatcher, ContentMatcher, HashMatcher) for headers
- Extends existing ComparisonResult base class for header result types
- Removes legacy alert methods (reducing complexity)
- Follows established Zod validation patterns for inventory schema
- Does not introduce new dependencies or frameworks
- Applies existing architecture patterns to headers (no new abstractions)

**Justification**: The matcher pattern and typed result pattern are already established for scripts; extending them to headers reduces inconsistency rather than adding complexity.

### Summary
**Overall Status**: ✅ ALL GATES PASS

No constitution violations detected. This refactor applies existing patterns to a new domain (headers) and consolidates alert handling, reducing technical debt while maintaining all security and compliance requirements.

## Project Structure

### Documentation (this feature)

```
specs/002-continuing-our-refactor/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature specification (already exists)
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
│   ├── comparison/                 # NEW: Typed comparison results
│   │   ├── authorized-script-found.ts
│   │   ├── known-script-unauthorised-content-found.ts
│   │   ├── unknown-script-found.ts
│   │   ├── authorized-header-found.ts          # NEW for this feature
│   │   ├── known-header-unauthorised-content-found.ts  # NEW
│   │   └── unknown-header-found.ts             # NEW
│   ├── matcher/                    # Existing matcher system
│   │   ├── matcher.interface.ts
│   │   ├── name-matcher.ts
│   │   ├── content-matcher.ts
│   │   └── hash-matcher.ts
│   ├── inventory/                  # Zod schemas
│   │   ├── script-entry.ts         # Existing
│   │   └── header-entry.ts         # NEW: Header inventory schema
│   ├── alert.ts
│   ├── script.ts
│   ├── header.ts                   # NEW: Header types
│   └── target.ts
├── services/
│   ├── comparison/
│   │   ├── script.ts               # Existing: returns typed results
│   │   └── header.ts               # MODIFY: return typed results
│   ├── alert/
│   │   └── slack.ts                # MODIFY: unified typed handler
│   ├── detection.ts
│   └── inventory.ts
├── handlers/                       # Response handlers
│   ├── script.ts
│   └── header.ts
└── utils/
    ├── hash.ts
    └── inventory/

test/
├── unit/
│   ├── types/comparison/           # NEW: Test typed results
│   ├── services/comparison/        # MODIFY: Test header typed results
│   └── services/alert/             # MODIFY: Test unified handler
└── integration/
    └── workflows/                  # Existing integration tests
```

**Structure Decision**: Single project structure (Option 1). This is a backend monitoring service with CLI interface. All source code lives in `src/` with type definitions in `src/types/`, business logic in `src/services/`, and utilities in `src/utils/`. Tests mirror the source structure using Jest's conventional `test/` directory.

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

No violations detected. This section is not applicable for this feature.
