# Research: Dedicated Alert Destination for Success Messages

**Feature**: 010-dedicated-alert-destination
**Date**: 2025-12-18

## Overview

This feature adds a dedicated alert destination for success notifications, separate from violation alerts. The research scope is minimal as this is a well-understood extension of existing patterns.

## Decision 1: Schema Field Location

**Decision**: Add `successNotification` as a sibling to `inventory` and `detection` in the `alerts` object.

**Rationale**:

- Follows existing pattern of organizing alert destinations by type/purpose
- Keeps the `alerts` object as the single source of truth for all notification routing
- Maintains flat structure (no nested hierarchies) for easy comprehension

**Alternatives Considered**:

1. **Nested under detection**: Rejected - success notifications apply to all modes, not just detection
2. **Top-level field outside alerts**: Rejected - fragments configuration, violates cohesion principle
3. **Separate success config object**: Rejected - over-engineering for single destination

## Decision 2: Field Requirement Level

**Decision**: Make `successNotification` a **required** field (no fallback behavior).

**Rationale**:

- Per clarification: "No fallback; system should fail validation if success destination is not defined"
- Fail-fast approach prevents silent misconfiguration
- Explicit configuration is better than implicit defaults for security-sensitive systems
- Migration cost is acceptable (one-time update to inventory files)

**Alternatives Considered**:

1. **Optional with fallback to existing destinations**: Rejected per user clarification
2. **Optional with no notification if missing**: Rejected - silent failure is undesirable

## Decision 3: Validation Approach

**Decision**: Use Zod schema validation with `z.string().min(1)` constraint.

**Rationale**:

- Consistent with existing `AlertDestinationSchema` pattern
- Fails at load time (inventory parsing) rather than runtime
- Provides clear error messages via Zod

**Alternatives Considered**:

1. **Custom validator function**: Rejected - Zod already handles this elegantly
2. **Runtime check in alertOnSuccess()**: Rejected - fails too late, violates fail-fast principle

## Decision 4: Destination Selection Logic Simplification

**Decision**: Remove `selectSuccessDestination()` mode-based logic; directly use `alertDestinations.successNotification`.

**Rationale**:

- No fallback needed means no mode-based selection required
- Simplifies code (fewer branches, less to test)
- The dedicated destination is mode-agnostic (applies to all execution modes)

**Alternatives Considered**:

1. **Keep selectSuccessDestination() with single return**: Rejected - unnecessary indirection
2. **Mode-specific success destinations**: Rejected - over-engineering; single destination covers use case

## Decision 5: Interface Signature Change

**Decision**: Keep `alertOnSuccess(summary, alertDestinations)` signature unchanged.

**Rationale**:

- `alertDestinations` already contains all alert configuration including new field
- No breaking changes to calling code
- `ExecutionSummary` may still be used for message content (targets, duration, etc.)

**Alternatives Considered**:

1. **Add separate successDestination parameter**: Rejected - redundant with alertDestinations
2. **Create new interface method**: Rejected - unnecessary API churn

## Migration Impact

**Affected Files**:

- All inventory JSON files in external repository must add `successNotification` field
- Breaking change requiring coordinated deployment

**Migration Strategy**:

1. Update all inventory files to include `successNotification` before deploying code
2. Deploy code change
3. No rollback path without reverting inventory files

**Example Migration**:

```json
// Before
{
  "alerts": {
    "inventory": { ... },
    "detection": { ... }
  }
}

// After
{
  "alerts": {
    "inventory": { ... },
    "detection": { ... },
    "successNotification": {
      "destination": "#pci-compliance-success"
    }
  }
}
```

## Open Questions

None - all technical decisions resolved.
