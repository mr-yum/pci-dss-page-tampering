# Data Model: Dedicated Alert Destination for Success Messages

**Feature**: 010-dedicated-alert-destination
**Date**: 2025-12-18

## Entity Changes

### AlertDestination (No Change)

Existing entity reused for success notifications.

```typescript
type AlertDestination = {
  destination: string // Slack channel ID or webhook URL
}
```

### InventoryAlert (Updated)

Extended with required `successNotification` field.

```typescript
// BEFORE
type InventoryAlert = {
  inventory: AlertInventory
  detection: AlertDetection
}

// AFTER
type InventoryAlert = {
  inventory: AlertInventory
  detection: AlertDetection
  successNotification: AlertDestination // NEW: Required field
}
```

### AlertInventory (No Change)

```typescript
type AlertInventory = {
  newScriptIdentified: AlertDestination
  newHeaderIdentified: AlertDestination
}
```

### AlertDetection (No Change)

```typescript
type AlertDetection = {
  newScriptDetected: AlertDestination
  scriptMismatchDetected: AlertDestination
  newHeaderDetected: AlertDestination
}
```

## Schema Changes

### Zod Schema Update

```typescript
// BEFORE
export const InventoryAlertSchema: z.ZodType<InventoryAlert> = z.object({
  inventory: AlertInventorySchema,
  detection: AlertDetectionSchema,
})

// AFTER
export const InventoryAlertSchema: z.ZodType<InventoryAlert> = z.object({
  inventory: AlertInventorySchema,
  detection: AlertDetectionSchema,
  successNotification: AlertDestinationSchema, // NEW: Required
})
```

### AlertDestinationSchema (Validation Enhancement)

Strengthen to require non-empty string:

```typescript
// BEFORE
export const AlertDestinationSchema: z.ZodType<AlertDestination> = z.object({
  destination: z.string(),
})

// AFTER
export const AlertDestinationSchema: z.ZodType<AlertDestination> = z.object({
  destination: z.string().min(1, 'Alert destination cannot be empty'),
})
```

## Validation Rules

| Field                                    | Rule             | Error Message                       |
| ---------------------------------------- | ---------------- | ----------------------------------- |
| `alerts.successNotification`             | Required         | "Required" (Zod default)            |
| `alerts.successNotification.destination` | Non-empty string | "Alert destination cannot be empty" |

## JSON Schema Example

```json
{
  "alerts": {
    "inventory": {
      "newScriptIdentified": { "destination": "#inventory-alerts" },
      "newHeaderIdentified": { "destination": "#inventory-alerts" }
    },
    "detection": {
      "newScriptDetected": { "destination": "#security-critical" },
      "scriptMismatchDetected": { "destination": "#security-critical" },
      "newHeaderDetected": { "destination": "#security-critical" }
    },
    "successNotification": {
      "destination": "#pci-compliance-status"
    }
  }
}
```

## Relationships

```
Inventory (1) ──contains──> InventoryAlert (1)
                                │
                                ├── AlertInventory (1)
                                │       └── AlertDestination (2)
                                │
                                ├── AlertDetection (1)
                                │       └── AlertDestination (3)
                                │
                                └── AlertDestination (1) [NEW: successNotification]
```

## State Transitions

N/A - This is configuration data with no state machine.

## Impact Analysis

### Breaking Changes

1. **Schema Breaking Change**: Inventory files without `successNotification` will fail Zod validation
2. **Migration Required**: All existing inventory files must be updated before deployment

### Non-Breaking Changes

1. `AlertDestination` type unchanged
2. `alertOnSuccess()` interface signature unchanged
3. Violation alert routing unchanged
