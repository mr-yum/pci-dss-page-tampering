# Implementation Plan: Composite Matchers with Nested Authorization

**Branch**: `005-enhance-the-schema` | **Date**: 2025-10-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-enhance-the-schema/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Extend the inventory schema to support composite matchers (OR/AND logic) with nested authorization metadata. This enables security administrators to express complex multi-condition authorization policies for Content-Security-Policy headers and other security controls without requiring code changes. The implementation will introduce `orMatcher` and `andMatcher` types that can be nested recursively, while maintaining 100% backward compatibility with existing inventory entries.

## Technical Context

**Language/Version**: TypeScript with Node.js >= 22, NPM >= 10
**Primary Dependencies**: Zod 4.x (schema validation), Puppeteer 24.x (detection), simple-git 3.x (inventory storage)
**Storage**: Git repository (script-inventory) for authorized inventories with audit trail
**Testing**: Jest (unit, integration, smoke tests via @mr-yum/node-builder)
**Target Platform**: Linux server (GitHub Actions, Docker containers for CI)
**Project Type**: Single project (Node.js CLI/service)
**Performance Goals**: Matcher evaluation must handle up to 10 nesting levels without significant degradation; deeper nesting supported but may impact performance
**Constraints**: Fail-secure behavior required (empty composite arrays → unauthorized); first-match-wins for OR logic; short-circuit evaluation for AND logic
**Scale/Scope**: Small codebase (~5K LOC), daily scheduled execution, critical PCI DSS compliance system

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle I: Security-First Development ✅ PASS

- **No security bypasses**: Composite matchers enhance authorization logic without weakening existing controls
- **No alert reduction**: Alert coverage maintained; authorization metadata path enriches alert context
- **Audit trail preserved**: Git-based inventory storage unchanged
- **Detection read-only**: No changes to detection workflow isolation
- **Fail-secure enforced**: Empty composite arrays explicitly trigger unauthorized state (FR-012)
- **Null/empty content**: Existing fail-secure behavior maintained (triggers UnknownScriptFound/UnknownHeaderFound)

### Principle II: Dual-Workflow Integrity ✅ PASS

- **No workflow mixing**: Composite matchers apply equally to inventory and detection workflows
- **Read-only detection**: No changes to DetectionService's read-only constraint
- **Alert categories**: Existing categories (new_inventory_script_identified, uninventoried_script_detected, mismatched_script_detected) remain unchanged; authorization metadata paths enhance context

### Principle III: Git-Based Audit Trail ✅ PASS

- **Commit requirements**: No changes to inventory commit workflow
- **Authorization metadata**: New nested authorization structure includes date/description fields for audit trail
- **History preservation**: No impact on Git history or branch protection

### Principle IV: Alert Completeness and Routing ✅ PASS

- **Alert categories unchanged**: All existing alert types remain functional
- **Enhanced context**: Authorization metadata path (root to leaf array) provides richer alert context for composite matchers
- **No blocking**: Alert failures still don't block detection
- **Sufficient context**: Authorization path includes description/date from all levels for comprehensive audit context

### Principle V: Test Coverage for Security Logic ⚠️ REQUIRES ATTENTION

- **Unit tests required**: ScriptComparisonService and HeaderComparisonService must have tests for composite matcher evaluation
- **Integration tests required**: Full workflow tests with composite matchers in inventory
- **Test scenarios required**: Empty arrays, nested composites, authorization metadata propagation, top-level override behavior
- **Coverage maintenance**: Refactoring must not reduce existing test coverage
- **Action**: Phase 1 must include comprehensive test plan for composite matcher logic

### Principle VI: Minimal Complexity ⚠️ REQUIRES JUSTIFICATION

**New abstractions introduced**:

1. **OrMatcher and AndMatcher types**: Composite matcher pattern
   - **Why needed**: Cannot express "all required directives present" (AND) or "any acceptable policy" (OR) with current single-matcher approach
   - **Why existing patterns insufficient**: Current NameMatcher/ContentMatcher/HashMatcher are leaf nodes; boolean composition requires new abstraction layer
   - **Simpler alternative rejected**: Array syntax for OR exists but cannot express AND; inline regex cannot handle complex multi-directive CSP validation

2. **Recursive evaluation**: Nested composite matcher trees
   - **Why needed**: Real-world policies like "(A AND B) OR (C AND D)" require nesting
   - **Why existing patterns insufficient**: Flat matcher arrays cannot express hierarchical logic
   - **Simpler alternative rejected**: Hard-coded depth limit would artificially constrain valid use cases; performance degradation is acceptable natural boundary

3. **Authorization metadata path**: Array of metadata objects from root to leaf
   - **Why needed**: Nested matchers may have authorization decisions at multiple levels; alerts need full context
   - **Why existing patterns insufficient**: Single authorisationInfo insufficient for composite trees
   - **Simpler alternative rejected**: Leaf-only metadata loses intermediate authorization rationale

**Dependency impact**: None (uses existing Zod for schema validation)

**Documentation**: Inline comments required for recursive evaluation logic and metadata path construction

### Gate Evaluation (Initial)

**Status**: ⚠️ **CONDITIONAL PASS** - May proceed to Phase 0 with constraints

**Constraints**:
1. Comprehensive test plan MUST be delivered in Phase 1 (Principle V violation)
2. Complexity justification MUST be documented in Complexity Tracking section (Principle VI)
3. Re-evaluate after Phase 1 design to ensure no additional abstractions introduced

---

### Gate Re-Evaluation (Post-Design)

**Date**: 2025-10-22 (after Phase 1 completion)

#### Principle I: Security-First Development ✅ PASS

**Re-evaluation**: Design maintains all security guarantees
- Fail-secure behavior enforced at multiple levels (Zod schema `.min(1)`, constructor validation, runtime checks)
- Null/empty content handling preserved via entry-point guards in `authorize()` methods
- Authorization metadata paths enhance audit trail (FR-009)
- No security regressions introduced

#### Principle II: Dual-Workflow Integrity ✅ PASS

**Re-evaluation**: No changes to workflow separation
- Composite matchers apply identically to inventory and detection workflows
- Read-only detection constraint maintained
- Alert categories unchanged (existing types enhanced with metadata paths)

#### Principle III: Git-Based Audit Trail ✅ PASS

**Re-evaluation**: Audit trail enhanced
- Authorization metadata now includes nested authorization decisions
- Git commit workflow unchanged
- Full metadata path provides richer audit context

#### Principle IV: Alert Completeness and Routing ✅ PASS

**Re-evaluation**: Alert context significantly improved
- Metadata path array (root to leaf) provides complete authorization history
- All existing alert types functional with enhanced context
- No blocking behavior introduced

#### Principle V: Test Coverage for Security Logic ✅ PASS (Constraint Resolved)

**Re-evaluation**: Comprehensive test plan delivered in quickstart.md
- Unit tests specified for: OrMatcher, AndMatcher, nested composites, array syntax
- Integration tests specified for: End-to-end composite matcher workflows
- Test scenarios cover: Empty arrays, null content, top-level override, metadata path collection
- Property-based tests specified for: Fail-secure properties across arbitrary inputs
- **Constraint satisfied**: Test plan meets requirements

#### Principle VI: Minimal Complexity ✅ PASS (Justified)

**Re-evaluation**: Abstractions justified and documented
- **OrMatcher/AndMatcher**: Necessary to express boolean composition (documented in Complexity Tracking)
- **Recursive evaluation**: Required for nested composite trees (documented in Complexity Tracking)
- **Authorization metadata path**: Needed for full audit trail (documented in Complexity Tracking)
- **No additional abstractions** introduced beyond initial assessment
- All new abstractions use existing Zod patterns (no new dependencies)
- **Constraint satisfied**: Justification documented

### Final Gate Evaluation

**Status**: ✅ **PASS** - All constraints satisfied, may proceed to implementation

**Resolved Constraints**:
1. ✅ Comprehensive test plan delivered (quickstart.md sections on testing)
2. ✅ Complexity justification documented (Complexity Tracking table)
3. ✅ No additional abstractions beyond initial design

**Design Artifacts Completed**:
- ✅ research.md: Zod recursive schemas, TypeScript composite pattern, fail-secure design
- ✅ data-model.md: Entity definitions, relationships, validation rules
- ✅ contracts/composite-matcher-schema.json: JSON Schema for composite matchers
- ✅ quickstart.md: Developer implementation guide with code examples
- ✅ Agent context updated (CLAUDE.md)

**Ready for**: Phase 2 task generation via `/speckit.tasks` command

---

### Design Refinement: Generic Matchable Type

**Question Raised**: Does the composite matcher design account for the separate logic for headers and scripts? Does it create duplication?

**Answer**: ✅ **No duplication - enhanced design uses generic `Matchable` type for type safety**

**Improved Architecture** (refinement from current codebase):

Instead of hardcoding `DetectedScript` type in the `Matcher` interface, we'll introduce a **generic `Matchable` type** that both scripts and headers implement:

```typescript
/**
 * Generic matchable resource (script or header)
 */
export interface Matchable {
  /** Resource name (script URL or header name) */
  name: string

  /** Resource content (script source or header value) */
  content: string | null

  /** Optional hash (scripts only, undefined for headers) */
  hash?: SHA256Hash
}

/**
 * Generic matcher interface
 */
export interface Matcher<T extends Matchable = Matchable> {
  getType(): 'name' | 'header-name' | 'content' | 'hash' | 'or' | 'and'
  getPattern(): string | InventoryScriptHashInfo[] | Matcher[]
  identify(resource: T): boolean
  authorize(resource: T): AuthorizationResult
}
```

**Benefits**:

1. **Type Safety**: Eliminates `hash: '' as unknown as SHA256Hash` workaround
2. **Explicit Contract**: Makes it clear matchers work on any matchable resource
3. **Zero Duplication**: Composite matchers work generically:

```typescript
// Same OrMatcher implementation works for both:
export class OrMatcher<T extends Matchable = Matchable> implements Matcher<T> {
  private readonly children: Matcher<T>[]

  authorize(resource: T): AuthorizationResult {
    // Works for scripts AND headers generically
    const matchingChild = this.children.find(child => child.identify(resource))
    return matchingChild ? matchingChild.authorize(resource) : { authorized: false }
  }
}

// Script use case (hash present)
const scriptData: Matchable = {
  name: 'https://cdn.example.com/script.js',
  content: 'function() { ... }',
  hash: 'abc123...' as SHA256Hash
}

// Header use case (hash undefined)
const headerData: Matchable = {
  name: 'content-security-policy',
  content: 'default-src https:; script-src https:;',
  hash: undefined  // No type cast needed!
}
```

**Migration Path**:

1. Introduce `Matchable` interface alongside existing `DetectedScript` type
2. Add `DetectedScript extends Matchable` for backward compatibility
3. Update `Matcher` interface to use generic `Matchable`
4. Composite matchers (`OrMatcher`, `AndMatcher`) use `Matcher<T extends Matchable>`
5. No changes required to comparison services (they already adapt data)

**Backward Compatibility**:

```typescript
// Existing code continues to work:
export type DetectedScript = Matchable & {
  hash: SHA256Hash  // Required for scripts (not optional)
}

// Existing matchers still work:
export class NameMatcher implements Matcher<Matchable> {
  identify(resource: Matchable): boolean {
    return this.pattern.test(resource.name)
  }
}

// HashMatcher only works with scripts:
export class HashMatcher implements Matcher<DetectedScript> {
  identify(script: DetectedScript): boolean {
    // script.hash is guaranteed to exist (not optional)
    return false  // Hash cannot identify, only authorize
  }
}
```

**Conclusion**: The refined design uses a **generic `Matchable` type** to:
- ✅ Eliminate type casting workarounds
- ✅ Make the abstraction explicit (matchers work on any matchable resource)
- ✅ Maintain zero duplication (single composite matcher implementation)
- ✅ Preserve backward compatibility (DetectedScript extends Matchable)

**Implementation Note**: This is an **optional refinement** that improves type safety. The composite matchers will work with the existing `DetectedScript` type as well, but using `Matchable` is cleaner and more maintainable.

## Project Structure

### Documentation (this feature)

```
specs/005-enhance-the-schema/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── inventory-schema.json  # Zod-to-JSON schema for composite matchers
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
src/
├── types/
│   ├── matcher/
│   │   ├── matcher.interface.ts      # Base Matcher interface (existing)
│   │   ├── name-matcher.ts           # NameMatcher implementation (existing)
│   │   ├── header-name-matcher.ts    # HeaderNameMatcher implementation (existing)
│   │   ├── content-matcher.ts        # ContentMatcher implementation (existing)
│   │   ├── hash-matcher.ts           # HashMatcher implementation (existing)
│   │   ├── or-matcher.ts             # NEW: OrMatcher composite
│   │   └── and-matcher.ts            # NEW: AndMatcher composite
│   ├── inventory/
│   │   ├── inventory.ts              # MODIFY: Update Zod schema for composite matchers
│   │   └── authorisation-info.ts     # MODIFY: Nested authorization metadata
│   └── comparison/
│       ├── authorized-script-found.ts         # MODIFY: Support metadata paths
│       ├── authorized-header-found.ts         # MODIFY: Support metadata paths
│       ├── known-script-unauthorised-content-found.ts  # MODIFY: Support metadata paths
│       └── known-header-unauthorised-content-found.ts  # MODIFY: Support metadata paths
├── services/
│   └── comparison/
│       ├── script.ts                 # MODIFY: Recursive composite matcher evaluation
│       └── header.ts                 # MODIFY: Recursive composite matcher evaluation
└── utils/
    └── inventory/
        └── validate-migration.js     # MODIFY: Update for composite matcher validation

test/
├── unit/
│   ├── types/matcher/
│   │   ├── or-matcher.test.ts        # NEW: OrMatcher unit tests
│   │   └── and-matcher.test.ts       # NEW: AndMatcher unit tests
│   ├── services/comparison/
│   │   ├── script-composite.test.ts  # NEW: Composite matcher comparison tests
│   │   └── header-composite.test.ts  # NEW: Composite matcher comparison tests
│   └── utils/inventory/
│       └── validate-migration.test.ts # MODIFY: Add composite matcher validation tests
└── integration/
    └── composite-matcher-workflow.test.ts  # NEW: End-to-end composite matcher tests
```

**Structure Decision**: Single project structure (Node.js CLI/service). Primary changes in `src/types/matcher/` (new composite matcher implementations), `src/types/inventory/` (Zod schema updates), and `src/services/comparison/` (recursive evaluation logic). Test coverage will mirror source structure with new unit tests for composite matchers and integration tests for full workflow.

## Complexity Tracking

| Abstraction                    | Why Needed                                                                                          | Simpler Alternative Rejected Because                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OrMatcher/AndMatcher types     | Cannot express "all required directives present" (AND) or "any acceptable policy" (OR) with current single-matcher approach | Array syntax for OR exists but cannot express AND; inline regex cannot handle complex multi-directive CSP validation |
| Recursive evaluation           | Real-world policies like "(A AND B) OR (C AND D)" require nesting                                   | Flat matcher arrays cannot express hierarchical logic; hard-coded depth limit would artificially constrain valid use cases |
| Authorization metadata path    | Nested matchers may have authorization decisions at multiple levels; alerts need full context       | Leaf-only metadata loses intermediate authorization rationale needed for compliance audit trail                    |
