# Research: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
**Date**: 2025-10-17
**Phase**: 0 (Research and Design Decisions)

## Overview

This document captures research findings, design decisions, and rationale for extending the typed comparison result pattern to headers and consolidating alert handling. All design decisions align with the project constitution and PCI DSS compliance requirements.

---

## R1: Typed Header Comparison Result Architecture

### Decision
Extend the ComparisonResult base class pattern to headers with three result types mirroring the script implementation:

1. **UnknownHeaderFound**: Header not in inventory or has null/empty values
2. **KnownHeaderWithUnauthorisedContentFound**: Header identified but value authorization failed
3. **AuthorizedHeaderFound**: Header both identified and authorized

### Rationale

**Why chosen:**
- Maintains architectural consistency with script comparison system
- Provides complete context to alert handlers (no additional queries needed)
- Enables discriminated union pattern for exhaustive type checking
- Reuses existing ComparisonResult base class (target, timestamp)
- Follows constitution principle VI (Minimal Complexity) by applying established patterns

**Alternatives considered:**
1. **Simple boolean flags**: Would lose context and require handlers to query for details
2. **Single result with enum status**: Would not leverage TypeScript's discriminated unions for type safety
3. **Custom header-specific base class**: Would create unnecessary divergence from script pattern

**Implementation notes:**
- Header result classes will extend `ComparisonResult` from `src/types/comparison/comparison-result.ts`
- Each result type includes full header details (name, values) for alert generation
- Result types use readonly properties to prevent mutation
- Discriminator field (`type`) enables switch statement exhaustive checking

---

## R2: Header Comparison with Multiple Values

### Decision
Generate one comparison result per header value when a header has multiple values. Each value is independently matched and authorized.

### Rationale

**Why chosen:**
- Aligns with FR-013: "System MUST handle headers with multiple values by generating one comparison result per value"
- Provides granular alerting (can distinguish which specific values are unauthorized)
- Prevents mixed authorization status hiding violations
- Maintains fail-secure behavior (one bad value triggers alert)

**Alternatives considered:**
1. **Single result for entire header**: Would lose granularity if some values authorized and others not
2. **Aggregate authorization (all-or-nothing)**: Would reject entirely authorized headers if one value fails
3. **Separate "partial authorization" result type**: Adds complexity without clear benefit

**Implementation notes:**
- HeaderComparisonService iterates over `Set<string>` values for each header
- For header with N values, service returns N comparison results
- Each result includes header name + single value being evaluated
- Empty string values are treated as valid per FR-013a

**Example:**
```
Detected: Content-Security-Policy: ["default-src 'self'", "script-src 'unsafe-inline'"]
Results:
  1. AuthorizedHeaderFound (value: "default-src 'self'")
  2. KnownHeaderWithUnauthorisedContentFound (value: "script-src 'unsafe-inline'")
```

---

## R3: Matcher Architecture for Headers

### Decision
Apply the existing Matcher interface pattern to headers using:
- **NameMatcher**: Identify headers by name (case-insensitive per HTTP RFC 7230)
- **ContentMatcher**: Authorize headers by value/content (case-sensitive)
- **First-match-wins**: Use first matching inventory entry in array order

### Rationale

**Why chosen:**
- Reuses battle-tested Matcher interface from script system
- NameMatcher already supports regex patterns for flexible name matching
- ContentMatcher supports regex patterns for flexible value validation
- HashMatcher not applicable to headers (content varies legitimately)
- Follows constitution principle VI (Minimal Complexity) by reusing existing abstractions

**Alternatives considered:**
1. **Inline regex matching**: Current header implementation uses this, but creates inconsistency with scripts
2. **Custom HeaderMatcher interface**: Would duplicate functionality without adding value
3. **Case-sensitive name matching**: Would violate HTTP standards (header names are case-insensitive)

**Implementation notes:**
- Header inventory entries will have `identifyWith` (NameMatcher) and `authoriseWith` (ContentMatcher)
- NameMatcher.identify() receives header name, performs case-insensitive match
- ContentMatcher.authorize() receives header value, performs case-sensitive match
- Matcher interface already provides `getType()` and `getPattern()` for logging

**Case sensitivity rules:**
- Header names: **Case-insensitive** (per HTTP RFC 7230 section 3.2)
  - "Content-Type" matches "content-type" matches "CONTENT-TYPE"
  - NameMatcher implementation must normalize to lowercase before regex test
- Header values: **Case-sensitive** (security implications)
  - "default-src 'self'" does NOT match "DEFAULT-SRC 'SELF'"
  - ContentMatcher uses regex as-is without normalization

---

## R4: Unified Typed Alert Handler

### Decision
Consolidate all alert handling into a single `alertForTypedResults` method that processes both script and header comparison results through discriminated union pattern. Remove legacy methods (`alertForScripts`, `alertForHeaders`).

### Rationale

**Why chosen:**
- Eliminates code duplication between script and header alert paths
- Ensures consistent alert formatting and routing across resource types
- Leverages TypeScript's exhaustive checking via discriminated unions
- Reduces maintenance burden (single code path to test and debug)
- Aligns with constitution principle VI (Minimal Complexity)

**Alternatives considered:**
1. **Keep separate methods**: Would perpetuate dual code paths and inconsistent handling
2. **Method overloading**: TypeScript's support is limited, discriminated unions more idiomatic
3. **Generic handler with callback functions**: Would add complexity without type safety benefits

**Implementation notes:**
- `alertForTypedResults` accepts `ComparisonResultType[]` (union of all result types)
- Switch statement on `result.type` provides exhaustive type checking
- Each case block has access to result-specific properties (e.g., `failureReason` for unauthorized content)
- Legacy methods remain temporarily but logged as deprecated, removed after migration confirmed

**Migration strategy:**
1. Update InventoryService and DetectionService to call `alertForTypedResults` with header results
2. Verify all alert scenarios covered in integration tests
3. Remove `alertForScripts` and `alertForHeaders` methods
4. Update interface definitions to remove deprecated methods

---

## R5: Header Inventory Schema Design

### Decision
Header inventory entries follow the same schema pattern as scripts:

```typescript
interface InventoryHeaderInfo {
  identifyWith: Matcher        // NameMatcher for header name (case-insensitive)
  authoriseWith: Matcher        // ContentMatcher for header value (case-sensitive)
  authorisationInfo: {
    authorised: boolean
    justification: string
    authorisedAt: string        // ISO 8601 date
  }
}
```

### Rationale

**Why chosen:**
- Mirrors script inventory schema for consistency
- Separates identification from authorization (flexible matching strategies)
- Includes justification for PCI DSS audit trail
- Zod validation ensures schema integrity
- Supports first-match-wins logic (array iteration order)

**Alternatives considered:**
1. **Separate `nameMatcher` and `contentMatcher` fields**: Current header schema uses this, but diverges from script pattern
2. **Inline regex strings without Matcher wrapper**: Would lose type safety and reusable validation logic
3. **Single matcher for both name and value**: Would prevent flexible matching strategies

**Implementation notes:**
- Define InventoryHeaderInfo Zod schema in `src/types/inventory/header-entry.ts`
- Use MatcherFactory to deserialize matchers from JSON inventory
- Validate `identifyWith` is NameMatcher and `authoriseWith` is ContentMatcher
- Empty values in headers are valid (authorization determined by ContentMatcher pattern)

**Migration considerations:**
- Existing header inventory entries use `nameMatcher` and `contentMatcher` (RegExp objects)
- Migration script needed to convert to `identifyWith` and `authoriseWith` with Matcher instances
- Migration must preserve existing authorization logic (validate against test cases first)

---

## R6: Alert Category Mapping

### Decision
Map header comparison results to alert categories following the dual-workflow pattern:

| Comparison Result | Inventory Workflow Alert | Detection Workflow Alert |
|------------------|-------------------------|-------------------------|
| UnknownHeaderFound | `new_inventory_header_identified` | `uninventoried_header_detected` |
| KnownHeaderWithUnauthorisedContentFound | N/A (should not occur) | `mismatched_header_detected` |
| AuthorizedHeaderFound | No alert | No alert |

### Rationale

**Why chosen:**
- Maintains parallel structure with script alerts
- Preserves dual-workflow integrity (constitution principle II)
- Distinguishes discovery (inventory) from violations (detection)
- Provides clear alert routing per workflow context

**Alternatives considered:**
1. **Single alert category for all violations**: Would lose context about workflow type
2. **Different naming convention from scripts**: Would create inconsistency in alert handling
3. **No alerts for authorized headers**: Retained for consistency (matches script behavior)

**Implementation notes:**
- Alert destinations configured in inventory `alerts` object
- Each alert category can route to different Slack channels
- Alert failures must not block comparison (log and continue per constitution principle IV)
- Alerts include full header context (name, values, target, timestamp)

---

## R7: Fail-Secure Behavior for Headers

### Decision
Headers with empty string values are treated as valid input and compared against inventory patterns. Authorization is determined by the ContentMatcher (e.g., `^$` regex pattern would authorize empty values).

### Rationale

**Why chosen:**
- Aligns with FR-013a specification
- Maintains consistency with script fail-secure behavior (but different trigger)
- Empty headers are valid HTTP (e.g., `X-Custom-Header: ""`)
- Pattern-based authorization provides explicit control over empty value handling
- Prevents false positives for legitimately empty headers

**Alternatives considered:**
1. **Auto-reject empty values**: Would cause false positives for valid empty headers
2. **Auto-authorize empty values**: Would bypass security controls
3. **Treat empty as "no header"**: Would lose distinction between absent vs empty

**Implementation notes:**
- Do NOT skip empty string values during iteration
- ContentMatcher receives empty string `""` as input
- Inventory patterns can explicitly match empty: `authoriseWith: ContentMatcher("^$")`
- Null/undefined values indicate absent header (not included in detection summary)

**Example:**
```typescript
// Inventory entry allowing empty X-Frame-Options
{
  identifyWith: NameMatcher("^X-Frame-Options$", "i"),
  authoriseWith: ContentMatcher("^(DENY|SAMEORIGIN|)$"),  // Allows empty
  authorisationInfo: { ... }
}

// Detected: X-Frame-Options: ""
// Result: AuthorizedHeaderFound (empty value matches pattern)
```

---

## R8: TypeScript Discriminated Union for Result Types

### Decision
Define a `ComparisonResultType` union that includes both script and header result types:

```typescript
type ComparisonResultType =
  | AuthorizedScriptFound
  | KnownScriptWithUnauthorisedContentFound
  | UnknownScriptFound
  | AuthorizedHeaderFound
  | KnownHeaderWithUnauthorisedContentFound
  | UnknownHeaderFound
```

### Rationale

**Why chosen:**
- Enables single unified alert handler processing all result types
- TypeScript compiler enforces exhaustive handling in switch statements
- Provides type narrowing within each case block (access to type-specific properties)
- Prevents mixing incompatible result types at compile time
- Supports future extensibility (new result types added to union)

**Alternatives considered:**
1. **Separate unions for scripts vs headers**: Would require separate handlers, defeating unification goal
2. **Runtime type checking with instanceof**: Would lose compile-time safety
3. **Generic Result<T> type**: Would complicate type narrowing and lose discriminator pattern benefits

**Implementation notes:**
- Update `src/types/comparison.ts` to export the expanded union
- Alert handler switch statement must handle all union members
- TypeScript `never` type at switch default ensures exhaustive checking
- Each result class must have unique `type` discriminator value

**Example usage:**
```typescript
function alertForTypedResults(results: ComparisonResultType[]) {
  results.forEach(result => {
    switch (result.type) {
      case 'unknown_script_found':
        // TypeScript knows result is UnknownScriptFound
        alert(result.script.name)
        break
      case 'unknown_header_found':
        // TypeScript knows result is UnknownHeaderFound
        alert(result.header.name)
        break
      // ... other cases
      default:
        const _exhaustive: never = result  // Compile error if case missing
    }
  })
}
```

---

## R9: Testing Strategy

### Decision
Follow the refactoring protocol from constitution principle V with comprehensive test coverage:

**Phase 1: Capture current behavior**
1. Write unit tests for existing HeaderComparisonService
2. Write unit tests for existing alert methods
3. Verify all tests pass before refactoring

**Phase 2: Refactor with test protection**
1. Implement typed header result classes
2. Update HeaderComparisonService to return typed results
3. Verify existing tests still pass (behavior unchanged)

**Phase 3: Extend coverage**
1. Unit tests for each header result type
2. Unit tests for unified alert handler
3. Integration tests for full workflow with header violations

### Rationale

**Why chosen:**
- Follows constitution principle V (Test Coverage for Security Logic)
- Prevents regressions during refactoring
- Provides confidence in behavioral equivalence
- Establishes baseline for future changes
- Documents expected behavior as executable tests

**Test scenarios to cover:**
- Headers with single value (authorized, unauthorized, unknown)
- Headers with multiple values (all authorized, mixed, all unauthorized)
- Headers with empty string values
- Case-insensitive name matching
- Case-sensitive value matching
- First-match-wins for overlapping patterns
- Alert routing for inventory vs detection workflows
- Matcher failure logging and context

---

## R10: Performance Considerations

### Decision
Maintain current performance characteristics with minimal overhead from typed results:

- Object instantiation cost negligible (small result classes)
- Array iteration same (one result per header value)
- Matcher pattern reuse eliminates regex recompilation
- Logging already present (no new overhead)

### Rationale

**Why chosen:**
- Detection runs are scheduled (not latency-sensitive)
- Bottleneck is Puppeteer browser execution, not comparison logic
- Current script comparison performance acceptable
- TypeScript compiles to efficient JavaScript (no runtime type checking)

**Monitoring:**
- Log comparison times (already implemented for scripts)
- Track total detection run time (existing metric)
- Alert if comparison exceeds threshold (future enhancement)

**No optimization needed:**
- Header counts per page are low (typically <20)
- Inventory sizes are small (typically <50 entries)
- First-match-wins minimizes iteration
- No database queries or I/O in comparison logic

---

## Summary of NEEDS CLARIFICATION Items

All items from Technical Context have been resolved through this research:

1. ✅ **Language/Version**: TypeScript with Node.js >=22, NPM >=10
2. ✅ **Dependencies**: Zod, Puppeteer, simple-git, axios (existing)
3. ✅ **Testing**: Jest via @mr-yum/node-builder (existing)
4. ✅ **Performance Goals**: Detection completes within CRON window (existing constraint)
5. ✅ **Constraints**: Read-only detection, Git audit trail, alert failures non-blocking (existing)

No new unknowns introduced. All design decisions leverage existing patterns and infrastructure.

---

## Next Steps

With research complete, proceed to Phase 1:
1. Generate `data-model.md` (entity definitions)
2. Generate API contracts in `/contracts/` (TypeScript interfaces)
3. Generate `quickstart.md` (developer onboarding)
4. Update agent context with new technology choices

All design decisions documented here will inform Phase 2 task generation.
