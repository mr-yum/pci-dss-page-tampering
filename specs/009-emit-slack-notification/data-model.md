# Data Model: Success Execution Notifications

**Feature**: Success Execution Notifications
**Date**: 2025-12-17

## Entities

### ExecutionSummary

Aggregated data about a completed workflow execution used to generate success notifications.

**Purpose**: Capture all relevant execution context needed for audit trail confirmation and operational visibility (FR-002 through FR-007).

**Fields**:

| Field               | Type             | Required | Description                                                     | Validation                                                            |
| ------------------- | ---------------- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `mode`              | `ExecutionMode`  | Yes      | Workflow execution mode                                         | One of: 'inventory', 'detection', 'all'                               |
| `targetsProcessed`  | `string[]`       | Yes      | Names of targets that were processed                            | Non-empty array, each string is target name or filename               |
| `repositoryUrl`     | `string`         | Yes      | Git repository URL that was monitored                           | Valid URL format (https:// or file://)                                |
| `inventoryBranch`   | `string \| null` | No       | Git branch used for inventory workflow                          | Required if mode='inventory' or mode='all', null for mode='detection' |
| `detectionBranch`   | `string \| null` | No       | Git branch used for detection workflow                          | Required if mode='detection' or mode='all', null for mode='inventory' |
| `resourceCount`     | `number`         | Yes      | Total scripts + headers monitored across all targets            | Non-negative integer                                                  |
| `completedAt`       | `Date`           | Yes      | Timestamp when workflow completed                               | ISO 8601 datetime                                                     |
| `executionDuration` | `number \| null` | No       | Milliseconds from start to completion (optional P3 enhancement) | Positive integer or null                                              |

**Relationships**:

- References `ExecutionMode` enum (already exists in `src/types/config.ts`)
- Used by both `SlackAlertService.alertOnSuccess()` and `ConsoleAlertService.alertOnSuccess()`
- Constructed in `main.ts` from `RuntimeConfiguration` and workflow execution results

**State Transitions**: N/A (immutable data structure created once at workflow completion)

**Example**:

```typescript
const summary: ExecutionSummary = {
  mode: ExecutionMode.All,
  targetsProcessed: ['1.0', '2.0', '3.0'],
  repositoryUrl: 'https://github.com/org/inventory',
  inventoryBranch: 'updates/scripts',
  detectionBranch: 'main',
  resourceCount: 42,
  completedAt: new Date('2025-12-17T14:30:00Z'),
  executionDuration: null, // Optional, not implemented in P1
}
```

---

### AlertDestination (Existing)

Reused from existing `src/types/inventory/model.ts` - no modifications needed.

**Usage in this feature**: Success notifications select destination based on workflow mode:

- `alerts.inventory.newScriptIdentified` for mode='inventory'
- `alerts.detection.newScriptDetected` for mode='detection' or mode='all'

---

## Validation Rules

### ExecutionSummary Validation

**Source**: Validated at construction site in `main.ts` before passing to alert service.

**Rules**:

1. **Mode-Branch Consistency**:
   - If `mode === 'inventory'`: `inventoryBranch` MUST be non-null, `detectionBranch` MUST be null
   - If `mode === 'detection'`: `detectionBranch` MUST be non-null, `inventoryBranch` MUST be null
   - If `mode === 'all'`: Both `inventoryBranch` AND `detectionBranch` MUST be non-null

2. **Non-Empty Targets**:
   - `targetsProcessed.length > 0` (at least one target processed)
   - Each string in array MUST be non-empty

3. **Valid Resource Count**:
   - `resourceCount >= 0` (zero is valid edge case per user story 2)

4. **Future Timestamp Prevention**:
   - `completedAt <= new Date()` (cannot be in the future)

5. **Duration Consistency** (optional):
   - If `executionDuration !== null`: MUST be positive integer

**Error Handling**:

- Validation failures log error and skip success notification (non-blocking per FR-009)
- Invalid summary treated as notification failure (workflow still succeeds)

---

## Type Definitions

### New File: `src/types/execution-summary.ts`

```typescript
import type { ExecutionMode } from './config'

/**
 * Summary of completed workflow execution for success notifications.
 * Contains all information needed for audit trail confirmation (FR-002 through FR-007).
 */
export type ExecutionSummary = {
  /** Workflow execution mode (inventory, detection, or all) */
  mode: ExecutionMode

  /** Names of targets that were processed (from inventory filename or target.name) */
  targetsProcessed: string[]

  /** Git repository URL that was monitored */
  repositoryUrl: string

  /** Git branch used for inventory workflow (null if not executed) */
  inventoryBranch: string | null

  /** Git branch used for detection workflow (null if not executed) */
  detectionBranch: string | null

  /** Total count of resources monitored (scripts + headers) across all targets */
  resourceCount: number

  /** Timestamp when workflow completed successfully */
  completedAt: Date

  /** Optional: Milliseconds from start to completion (P3 enhancement) */
  executionDuration?: number | null
}

/**
 * Validates ExecutionSummary for mode-branch consistency.
 * @throws Error if validation fails
 */
export function validateExecutionSummary(summary: ExecutionSummary): void {
  // Mode-branch consistency
  if (summary.mode === ExecutionMode.Inventory && (summary.inventoryBranch === null || summary.detectionBranch !== null)) {
    throw new Error('ExecutionSummary validation failed: inventory mode requires inventoryBranch only')
  }
  if (summary.mode === ExecutionMode.Detection && (summary.detectionBranch === null || summary.inventoryBranch !== null)) {
    throw new Error('ExecutionSummary validation failed: detection mode requires detectionBranch only')
  }
  if (summary.mode === ExecutionMode.All && (summary.inventoryBranch === null || summary.detectionBranch === null)) {
    throw new Error('ExecutionSummary validation failed: all mode requires both branches')
  }

  // Non-empty targets
  if (summary.targetsProcessed.length === 0) {
    throw new Error('ExecutionSummary validation failed: targetsProcessed cannot be empty')
  }

  // Valid resource count
  if (summary.resourceCount < 0) {
    throw new Error('ExecutionSummary validation failed: resourceCount must be non-negative')
  }

  // No future timestamps
  if (summary.completedAt > new Date()) {
    throw new Error('ExecutionSummary validation failed: completedAt cannot be in the future')
  }

  // Duration consistency (optional)
  if (summary.executionDuration !== undefined && summary.executionDuration !== null && summary.executionDuration <= 0) {
    throw new Error('ExecutionSummary validation failed: executionDuration must be positive if provided')
  }
}
```

---

## Integration Points

### 1. Construction in `main.ts`

**Location**: After workflow completion (before `process.exit(ExitCode.Success)`)

**Data Sources**:

- `mode`: From `config.executionMode`
- `targetsProcessed`: Extracted from `filteredInventory.map(inv => inv.fileName.replace(/\.json$/, ''))`
- `repositoryUrl`: From `config.repository.url`
- `inventoryBranch`/`detectionBranch`: From `config.branches`
- `resourceCount`: Aggregated from detection summaries (scripts + headers)
- `completedAt`: `new Date()` at completion time
- `executionDuration`: Optional (not implemented in P1)

### 2. Consumption by Alert Services

**SlackAlertService**:

- New method: `alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void>`
- Formats Slack Block Kit message with green success styling
- Selects destination based on `summary.mode`

**ConsoleAlertService**:

- New method: `alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void>`
- Logs structured text to console with same information
- Parallel implementation for local testing

### 3. Interface Extension

**IAlertService** (`src/interfaces/alert.ts`):

```typescript
export interface IAlertService {
  alertForTypedResults(comparisonResults: ComparisonResultType[], target: Target, alertDestinations: InventoryAlert): Promise<void>
  alertOnSuccess(summary: ExecutionSummary, alertDestinations: InventoryAlert): Promise<void> // NEW
}
```

---

## No Schema Migrations Required

- ExecutionSummary is ephemeral (constructed at runtime, not persisted)
- No changes to inventory JSON schema
- No database tables or Git storage
- Alert destinations reused from existing schema

---

## Testing Considerations

### Unit Tests

**File**: `src/types/execution-summary.test.ts`

- Test `validateExecutionSummary()` with valid/invalid inputs
- Test mode-branch consistency rules
- Test edge cases (zero resources, empty targets, future timestamps)

**Files**: `src/services/alert/slack.test.ts`, `src/services/alert/console.test.ts`

- Mock `alertOnSuccess()` calls with various ExecutionSummary payloads
- Verify message formatting (target list truncation, branch display)
- Verify error handling for invalid summaries

### Integration Tests

**File**: `test/integration/success-notification.test.ts`

- End-to-end workflow execution with success notification
- Verify notification sent after inventory workflow completion
- Verify notification sent after detection workflow completion
- Verify notification content matches workflow execution
- Verify notification failure doesn't break workflow (log and continue)
