# Implementation Plan: Dedicated Alert Destination for Success Messages

**Branch**: `010-dedicated-alert-destination` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-dedicated-alert-destination/spec.md`

## Summary

Add a **required** `successNotification` field to the inventory alert configuration to route workflow success notifications to a dedicated destination, separate from violation alerts. This reduces alert fatigue by ensuring violation alerts maintain high signal-to-noise ratio in critical security channels while success notifications go to lower-priority monitoring channels.

**Key changes**:
1. Extend `InventoryAlert` type with required `successNotification: AlertDestination` field
2. Update Zod schema to require and validate the new field (non-empty string)
3. Simplify `selectSuccessDestination()` to use dedicated field directly (remove mode-based fallback logic)
4. Update interface documentation

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js >=22)
**Primary Dependencies**: Zod 4.x (schema validation), axios (HTTP client for Slack)
**Storage**: Git-based JSON inventory files (external repository)
**Testing**: Jest via `@mr-yum/node-builder` (unit tests co-located, integration tests in `test/`)
**Target Platform**: Linux server (GitHub Actions, Docker)
**Project Type**: Single project (CLI tool)
**Performance Goals**: N/A (background job, not latency-sensitive)
**Constraints**: Existing inventory files must be migrated to include new required field
**Scale/Scope**: ~5-10 inventory files per deployment

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Security-First Development | ✅ PASS | No weakening of hash verification, detection, or alert coverage. Success notifications supplement violation alerts. |
| II. Dual-Workflow Integrity | ✅ PASS | No changes to inventory/detection workflow separation. Alert routing only. |
| III. Git-Based Audit Trail | ✅ PASS | No changes to Git commit behavior. Inventory files include new field. |
| IV. Alert Completeness and Routing | ✅ PASS | Enhances routing by adding dedicated success destination. All violation alerts continue unchanged. |
| V. Test Coverage for Security Logic | ✅ PASS | Unit tests required for schema validation and destination selection. |
| VI. Minimal Complexity | ✅ PASS | Removes mode-based fallback logic (simplification). Reuses existing AlertDestination pattern. |

**Gate Result**: PASS - No violations. Feature aligns with all constitution principles.

## Project Structure

### Documentation (this feature)

```
specs/010-dedicated-alert-destination/
├── plan.md              # This file
├── research.md          # Phase 0 output (minimal - well-understood domain)
├── data-model.md        # Phase 1 output (schema changes)
├── quickstart.md        # Phase 1 output (implementation guide)
├── contracts/           # Phase 1 output (updated schema)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```
src/
├── types/
│   └── inventory/
│       ├── model.ts       # Add successNotification to InventoryAlert type
│       ├── zod.ts         # Add successNotification to InventoryAlertSchema
│       └── raw.ts         # (no changes - inherits from model.ts)
├── services/
│   └── alert/
│       ├── slack.ts       # Update selectSuccessDestination() method
│       └── slack.test.ts  # Add unit tests for new destination logic
├── interfaces/
│   └── alert.ts           # Update alertOnSuccess() documentation
└── main.ts                # (no changes - uses InventoryAlert type)

test/
└── integration/           # Integration tests for end-to-end flow
```

**Structure Decision**: Single project layout. Changes isolated to `src/types/inventory/` (schema) and `src/services/alert/` (routing logic).

## Post-Design Constitution Re-Check

_Re-evaluated after Phase 1 design completion._

| Principle | Status | Post-Design Notes |
| --------- | ------ | ----------------- |
| I. Security-First Development | ✅ PASS | No security regressions. Validation enforces non-empty destination strings. |
| II. Dual-Workflow Integrity | ✅ PASS | No workflow separation changes. Both modes use same successNotification destination. |
| III. Git-Based Audit Trail | ✅ PASS | Inventory file schema changes tracked in Git. |
| IV. Alert Completeness and Routing | ✅ PASS | Success alerts now have dedicated destination. Violation alerts unchanged. |
| V. Test Coverage for Security Logic | ✅ PASS | Test cases defined in quickstart.md for schema validation and routing. |
| VI. Minimal Complexity | ✅ PASS | Removes conditional logic (selectSuccessDestination), net simplification. |

**Post-Design Gate Result**: PASS - Design maintains constitutional compliance.

## Generated Artifacts

| Artifact | Path | Description |
| -------- | ---- | ----------- |
| Research | [research.md](./research.md) | Design decisions and alternatives |
| Data Model | [data-model.md](./data-model.md) | Schema changes and entity relationships |
| Schema Contract | [contracts/inventory-alert-schema.json](./contracts/inventory-alert-schema.json) | JSON Schema for updated InventoryAlert |
| Quickstart | [quickstart.md](./quickstart.md) | Implementation guide with code examples |

## Next Steps

Run `/speckit.tasks` to generate actionable task breakdown for implementation.
