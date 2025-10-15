# Implementation Plan: Script Identification and Authorisation Refactor

**Branch**: `001-refactor-script-identification` | **Date**: 2025-10-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-refactor-script-identification/spec.md`

## Summary

Refactor the PCI DSS page tampering detection system to separate script identification from authorization through a modular matcher system. Replace hardcoded comparison logic with flexible, independently testable matchers (nameMatcher, contentMatcher, hashes) that can be configured per inventory entry. Transform comparison services to return typed, context-rich results (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound) enabling actionable alerts without additional queries. This refactoring improves maintainability, enables safer evolution, and maintains zero-regression compliance with PCI DSS requirements 6.4.3 and 11.6.1.

**Technical Approach**: Introduce matcher abstraction with three concrete implementations, update Zod schemas to support identifyWith/authoriseWith properties, refactor ScriptComparisonService to use matcher pipeline, define typed comparison result classes with full context, and update alert handlers to consume structured results.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 22+)
**Primary Dependencies**: Zod 4.x (schema validation), Puppeteer 24.x (browser automation), simple-git 3.x (Git operations), axios (HTTP)
**Storage**: Git repository for inventory files (JSON), in-memory caching during execution
**Testing**: Jest (unit + integration tests via @mr-yum/node-builder), Docker Compose for integration environment
**Target Platform**: Linux/macOS server (GitHub Actions runners, local development)
**Project Type**: Single project (Node.js CLI/service)
**Performance Goals**: Process all targets within 5-minute timeout (current), maintain <1s per script comparison
**Constraints**: Zero security regressions, maintain dual-workflow separation, preserve Git audit trail, backward-incompatible schema change (manual migration)
**Scale/Scope**: ~10-20 payment page targets, ~50-100 scripts per inventory, daily scheduled execution

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### I. Security-First Development (NON-NEGOTIABLE)

- ✅ **Maintains hash verification**: Refactoring enhances matcher modularity without weakening SHA-256 verification (HashMatcher implementation)
- ✅ **No alert coverage reduction**: Typed comparison results increase alert context and specificity
- ✅ **Git audit trail preserved**: Inventory schema change does not affect Git commit workflow
- ✅ **Detection workflow remains read-only**: Refactoring affects comparison logic only, not workflow separation
- ✅ **Cryptographic hashing unchanged**: SHA-256 remains standard, hash computation logic untouched

### II. Dual-Workflow Integrity

- ✅ **Inventory/detection separation maintained**: Refactoring targets comparison logic; InventoryService and DetectionService responsibilities unchanged
- ✅ **Alert categories preserved**: Typed results map directly to existing alert types (newScriptIdentified, scriptMismatchDetected, etc.)

### III. Git-Based Audit Trail

- ✅ **Inventory changes still committed**: Schema migration requires manual update, preserving audit trail
- ✅ **Commit message requirements unchanged**: Handler behavior for inventory updates unaffected by refactoring

### IV. Alert Completeness and Routing

- ✅ **Alert coverage enhanced**: Typed comparison results include more context (matcher details, failure reason) than current implementation
- ✅ **Alert routing preserved**: Handlers updated to consume typed results, destination configuration unchanged

### V. Test Coverage for Security Logic

- ✅ **Test coverage required**: FR-012 mandates independent testability for each matcher; refactoring protocol in constitution enforced
- ⚠️ **Refactoring protocol compliance**: MUST write tests capturing current behavior BEFORE refactoring (see Refactoring Strategy below)

### VI. Minimal Complexity

- ✅ **Zod schemas retained**: Inventory validation continues using established Zod pattern
- ✅ **Justified abstractions**: Matcher abstraction necessary to eliminate hardcoded logic and enable extensibility (see Complexity Tracking)
- ✅ **No unnecessary dependencies**: Refactoring uses existing tools (Zod, TypeScript)

**GATE RESULT**: ✅ PASS - All constitution principles satisfied. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```
specs/001-refactor-script-identification/
├── plan.md              # This file
├── research.md          # Phase 0: Matcher pattern research, Zod schema migration strategy
├── data-model.md        # Phase 1: Matcher types, Comparison result types, Updated inventory schema
├── quickstart.md        # Phase 1: Migration guide for existing inventories
├── contracts/           # Phase 1: TypeScript interfaces (matchers, comparison results)
└── tasks.md             # Phase 2: NOT created by /speckit.plan
```

### Source Code (repository root)

```
src/
├── handlers/            # Alert handlers (script.ts, header.ts) - UPDATE to consume typed results
├── interfaces/          # Service interfaces - UPDATE for new comparison signatures
├── repositories/        # Inventory data access (inventory.ts) - UPDATE for new schema
├── services/
│   ├── alert/          # Slack alert service (slack.ts) - UPDATE for typed result context
│   ├── comparison/     # REFACTOR: script.ts (matcher pipeline), header.ts
│   ├── detection.ts    # Detection orchestration - MINOR UPDATE for typed results
│   └── inventory.ts    # Inventory management - UPDATE for schema validation
├── stores/
│   └── inventory/      # Git + in-memory stores (git.ts, in-memory.ts) - UPDATE for new schema
├── types/
│   ├── comparison.ts   # ADD: Typed comparison result classes
│   ├── inventory/      # UPDATE: Zod schemas (zod.ts), model types (model.ts, props.ts)
│   ├── matcher.ts      # ADD: Matcher interface and implementations
│   └── script.ts       # UPDATE: Script types for matcher context
├── utils/
│   ├── inventory.ts    # UPDATE: Schema migration utilities
│   ├── script/
│   │   └── matcher.ts  # REFACTOR: Extract matcher logic from comparison service
│   └── hash.ts         # UNCHANGED: Hash computation
└── workflows/          # UNCHANGED: Puppeteer workflows

tests/
├── unit/
│   ├── matchers/       # ADD: NameMatcher, ContentMatcher, HashMatcher unit tests
│   ├── comparison/     # UPDATE: ScriptComparisonService tests (matcher pipeline)
│   └── inventory/      # ADD: Schema validation tests (invalid regex, missing properties)
└── integration/
    └── comparison/     # UPDATE: End-to-end comparison tests with all matcher combinations
```

**Structure Decision**: Single project structure matches existing codebase. Tests colocated with source (e.g., `src/services/comparison/script.test.ts`) per current pattern. Refactoring primarily affects `src/types/matcher.ts` (new), `src/services/comparison/script.ts` (refactor), `src/types/comparison.ts` (new), and Zod schemas in `src/types/inventory/`.

## Complexity Tracking

| Violation                                                  | Why Needed                                                                                          | Simpler Alternative Rejected Because                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matcher abstraction (new interface + 3 implementations)    | Eliminate hardcoded script matching logic; enable independent testing and extensibility             | Direct if/else logic in comparison service: requires changes for every new matcher type, cannot be unit tested in isolation, violates Open/Closed Principle   |
| Typed comparison result classes (UnknownScriptFound, etc.) | Provide complete context to handlers without additional queries; enable type-safe result processing | Returning generic objects or tuples: loses type safety, requires handlers to know internal structure, increases coupling between comparison and handler logic |

**Justification**: Both abstractions directly address core requirements (FR-002 matcher separation, FR-008 typed results, FR-009 complete context). Constitution Principle VI permits abstractions when "existing patterns are demonstrably insufficient" - current hardcoded logic cannot satisfy modularity (P2) and typed results (P3) user stories without these changes.

## Refactoring Strategy

Per Constitution Refactoring Protocol:

1. **Capture Current Behavior** (Pre-Refactoring):
   - Write comprehensive tests for `src/services/comparison/script.ts` covering all current matching scenarios
   - Document current matcher logic (name-based, content-based, hash-based) as test cases
   - Verify tests pass with current implementation (green baseline)

2. **Introduce Matchers** (Incremental):
   - Create `src/types/matcher.ts` with interface and three implementations
   - Write unit tests for each matcher (isolated from comparison service)
   - Verify matchers produce identical results to current logic

3. **Refactor Comparison Service** (Behavior-Preserving):
   - Update `src/services/comparison/script.ts` to use matcher pipeline
   - Verify all original tests still pass (no behavior change)
   - Add new tests for matcher orchestration

4. **Introduce Typed Results** (Incremental):
   - Create `src/types/comparison.ts` with result classes
   - Update comparison service to return typed results
   - Update handlers to consume typed results
   - Verify alert output unchanged (zero regression)

5. **Schema Migration** (Breaking Change):
   - Update Zod schemas to require identifyWith/authoriseWith
   - Create migration documentation in quickstart.md
   - Manually migrate test inventories
   - Deploy with coordinated inventory repository update

**Test Coverage Enforcement**: Require >90% code coverage for matcher implementations and comparison service refactoring (enforce via Jest coverage thresholds).
