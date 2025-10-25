# Implementation Plan: Improve Serialization/Deserialization for Composite Matchers

**Branch**: `007-improve-serialization-deserialization` | **Date**: 2025-10-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-improve-serialization-deserialization/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add serialization/deserialization support for composite matchers (OrMatcher, AndMatcher) to enable persisting inventory configurations with complex authorization logic to Git repositories. The system currently supports deserializing composite matchers from JSON (via `createMatcher` factory) but lacks serialization back to JSON, preventing inventory updates from being persisted. This feature extends existing serialization utilities in `src/utils/script.ts` and `src/utils/inventory.ts` to handle recursive composite matcher structures while preserving authorization metadata and nesting relationships.

## Technical Context

**Language/Version**: TypeScript (Node.js >= 22, NPM >= 10)
**Primary Dependencies**: Zod 4.0.17 (schema validation), Puppeteer 24.16.0 (browser automation), simple-git 3.28.0 (Git operations)
**Storage**: Git repository for inventories, JSON serialization for configuration files
**Testing**: Jest (via @mr-yum/node-builder), unit tests (`npm run test:unit`), integration tests in Docker (`npm run test:integration`)
**Target Platform**: Linux server (GitHub Actions runners, Docker containers)
**Project Type**: Single project (Node.js CLI/service with scheduled execution)
**Performance Goals**: Serialize composite matchers with 100 children in <100ms, support up to 10 nesting levels without degradation
**Constraints**: Must maintain backward compatibility with existing leaf matcher serialization, no breaking changes to JSON schema
**Scale/Scope**: 10-50 scripts per target, 2-4 typical nesting levels, support up to 10 nesting levels for advanced policies

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle I: Security-First Development ✅ PASS

- **No security regression**: Feature only adds serialization capability for existing matcher logic. No changes to hash verification, alert coverage, or detection workflow integrity.
- **Fail-secure behavior maintained**: Existing fail-secure checks in OrMatcher/AndMatcher constructors (empty array rejection) remain in place. Serialization functions will preserve these behaviors.
- **Audit trail preserved**: Serialization enables proper Git commits for inventory updates with composite matchers (currently broken).

**Verdict**: PASS - Feature enhances security by enabling proper audit trail for composite matcher configurations.

### Principle II: Dual-Workflow Integrity ✅ PASS

- **No workflow mixing**: Feature only modifies serialization utilities (`src/utils/script.ts`, `src/utils/inventory.ts`), not workflow orchestration.
- **Read-only detection preserved**: DetectionService remains unchanged, continues to compare without modifying inventories.
- **Alert categories unchanged**: No modifications to alert routing or categorization logic.

**Verdict**: PASS - Feature is orthogonal to workflow separation concerns.

### Principle III: Git-Based Audit Trail ✅ PASS

- **Enables proper commits**: Feature FIXES the current inability to commit inventory updates with composite matchers.
- **Descriptive commit messages**: No changes to commit message patterns (handled by InventoryService).
- **No history alteration**: Serialization functions are pure, no side effects on Git operations.

**Verdict**: PASS - Feature directly supports this principle by fixing broken serialization.

### Principle IV: Alert Completeness and Routing ✅ PASS

- **No alert logic changes**: Feature only affects serialization, not comparison or alerting.
- **Alert context preserved**: Authorization metadata (including descriptions) preserved through round-trips.
- **No blind spots created**: Feature enables better alert context by preserving nested metadata paths.

**Verdict**: PASS - Feature has no impact on alerting, maintains existing alert completeness.

### Principle V: Test Coverage for Security Logic ✅ PASS

- **Unit tests required**: Spec mandates comprehensive unit tests for serialization functions.
- **Round-trip testing**: Spec includes acceptance criteria for round-trip preservation.
- **No reduction in coverage**: Feature extends existing patterns, tests will follow existing test structure in `test/unit/utils/script.test.ts`.

**Verdict**: PASS - Feature specification explicitly requires test coverage matching existing patterns.

### Principle VI: Minimal Complexity ⚠️ JUSTIFIED

- **New complexity introduced**: Recursive serialization logic for composite matchers adds cyclomatic complexity.
- **Justification**:
  - Composite matchers already exist in the codebase (OrMatcher, AndMatcher)
  - Deserialization already works via `createMatcher` factory (recursive)
  - Serialization is the missing piece preventing production use of composite matchers
  - No new abstractions or dependencies, extends existing serialization utilities
  - Alternative (remove composite matchers) would force manual JSON editing or complex external tooling

**Verdict**: PASS WITH JUSTIFICATION - Complexity is necessary to support existing feature (composite matchers) and follows established patterns.

### Overall Gate Result: ✅ PASS

All principles satisfied. Feature enhances security posture by fixing broken inventory persistence for composite matchers.

## Project Structure

### Documentation (this feature)

```
specs/007-improve-serialization-deserialization/
├── spec.md                      # Feature specification (user scenarios, requirements)
├── plan.md                      # This file (planning output)
├── research.md                  # Phase 0 output (design decisions)
├── data-model.md                # Phase 1 output (entity definitions)
├── quickstart.md                # Phase 1 output (developer guide)
├── contracts/
│   └── serialization-api.md     # Phase 1 output (function contracts)
└── tasks.md                     # Phase 2 output (NOT created yet - run /speckit.tasks)
```

### Source Code (repository root)

```
src/
├── types/
│   ├── matcher/
│   │   ├── matcher.interface.ts         # Matcher interface definition
│   │   ├── matcher-factory.ts           # createMatcher() factory (deserialization)
│   │   ├── or-matcher.ts                # 🔧 MODIFY: Add getAuthorisationInfo() accessor
│   │   ├── and-matcher.ts               # 🔧 MODIFY: Add getAuthorisationInfo() accessor
│   │   ├── name-matcher.ts              # Leaf matcher (no changes)
│   │   ├── content-matcher.ts           # Leaf matcher (no changes)
│   │   ├── hash-matcher.ts              # Leaf matcher (no changes)
│   │   └── header-name-matcher.ts       # Leaf matcher (no changes)
│   └── inventory/
│       ├── model.ts                     # InventoryScriptInfo, InventoryHeaderInfo types
│       ├── raw.ts                       # RawInventoryScriptInfo, RawInventoryHeaderInfo types
│       ├── zod.ts                       # Zod schemas for validation
│       └── matcher-config-schema.ts     # MatcherConfig Zod schema with z.lazy() recursion
├── utils/
│   ├── script.ts                        # 🔧 MODIFY: Extend matcherToConfig() for composites
│   │                                    #          Add serializeAuthorisationInfo() helper
│   └── inventory.ts                     # 🔧 MODIFY: Extend matcherToConfig() for composites
│                                        #          Add serializeAuthorisationInfo() helper
└── services/
    └── inventory.ts                     # Uses serialization (no changes)

test/
├── unit/
│   ├── utils/
│   │   ├── script.test.ts               # 🆕 ADD: Round-trip tests for composite matchers
│   │   └── inventory.test.ts            # 🆕 ADD: Round-trip tests for headers with composites
│   └── types/
│       └── matcher/
│           ├── or-matcher.test.ts       # 🆕 ADD: Test getAuthorisationInfo() accessor
│           └── and-matcher.test.ts      # 🆕 ADD: Test getAuthorisationInfo() accessor
└── integration/
    └── inventory-service.test.ts        # 🆕 ADD: Full workflow test with Git
```

**Structure Decision**: Single project (Node.js TypeScript CLI/service). Feature modifies existing utility functions in `src/utils/` and adds accessor methods to composite matcher classes in `src/types/matcher/`. No new modules or services created. Tests follow existing structure in `test/unit/` and `test/integration/`.

**Files Modified**:

1. `src/types/matcher/or-matcher.ts` - Add `getAuthorisationInfo()` accessor (~5 lines)
2. `src/types/matcher/and-matcher.ts` - Add `getAuthorisationInfo()` accessor (~5 lines)
3. `src/utils/script.ts` - Add `serializeAuthorisationInfo()` helper, extend `matcherToConfig()` (~40 lines)
4. `src/utils/inventory.ts` - Add `serializeAuthorisationInfo()` helper, extend `matcherToConfig()` (~40 lines)

**Files Created**:

1. Unit tests for serialization (~200 lines total)
2. Integration tests for full workflow (~100 lines)

**Total LOC Estimate**: ~390 lines (90 production code, 300 test code)

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

**No violations requiring tracking.** Constitution Principle VI (Minimal Complexity) justified in Constitution Check section above:

- Complexity necessary to support existing feature (composite matchers)
- No new abstractions or dependencies
- Extends existing serialization patterns
- Alternative (remove composite matchers) would force manual JSON editing or complex external tooling
