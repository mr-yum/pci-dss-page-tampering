# Feature Specification: Dedicated Alert Destination for Success Messages

**Feature Branch**: `010-dedicated-alert-destination`
**Created**: 2025-12-18
**Status**: Draft
**Input**: User description: "Dedicated alert destination for successful run messages"

## Clarifications

### Session 2025-12-18

- Q: Should the system support fallback behavior for missing success destination? → A: No fallback; system should fail validation if success destination is not defined.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Separate success notifications from violation alerts (Priority: P1)

Security operations teams currently receive successful workflow completion notifications in the same channel as violation alerts. This dilutes the urgency of violation alerts and makes it harder to monitor for critical security events. Teams need the ability to route success notifications to a dedicated destination (e.g., a low-priority monitoring channel) while keeping violation alerts in high-priority channels.

**Why this priority**: This is the core value proposition - reducing alert fatigue and ensuring violation alerts maintain high signal-to-noise ratio in critical channels.

**Independent Test**: Can be fully tested by configuring a success destination and verifying success notifications route to that destination while violations route elsewhere.

**Acceptance Scenarios**:

1. **Given** an inventory file with a dedicated success destination configured, **When** a workflow completes successfully without violations, **Then** the success notification is sent only to the success destination (not to violation alert channels).

2. **Given** an inventory file with a dedicated success destination configured, **When** a workflow detects violations, **Then** violation alerts are sent to the appropriate violation destination AND the success notification (if sent) goes to the success destination.

3. **Given** an inventory file without a success destination configured (field omitted), **When** the inventory is loaded, **Then** the system rejects the inventory with a validation error indicating the required field is missing.

---

### User Story 2 - Validate required success destination (Priority: P2)

Operators need clear feedback when inventory files are missing the required success destination configuration. The system should fail fast at validation time with an actionable error message, preventing silent misconfiguration.

**Why this priority**: Ensures explicit configuration and prevents runtime surprises; supports the "fail-secure" principle.

**Independent Test**: Can be tested by attempting to load an inventory file without the success destination field.

**Acceptance Scenarios**:

1. **Given** an inventory file without the `successNotification` field, **When** the inventory is loaded, **Then** the system returns a validation error specifying that `successNotification` is required.

2. **Given** an inventory file with an empty `successNotification.destination` value, **When** the inventory is loaded, **Then** the system returns a validation error specifying that the destination must be a non-empty string.

---

### Edge Cases

- What happens when the success destination field is missing entirely?
  - System MUST reject the inventory file at validation time with a clear error message indicating `successNotification` is required.

- What happens when the success destination field is present but empty (empty string)?
  - System should treat empty string as invalid and reject the inventory file at validation time.

- What happens when the success destination is the same as a violation destination?
  - This is valid - users may want success and violations in the same channel for some targets but separate for others.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support a **required** `successNotification` field in the inventory alert configuration at the same level as `inventory` and `detection` alert groups.

- **FR-002**: System MUST use the configured success destination for sending workflow completion notifications.

- **FR-003**: System MUST reject inventory files that do not include the `successNotification` field with a validation error.

- **FR-004**: System MUST validate that the success destination field contains a non-empty string value.

- **FR-005**: System MUST continue sending violation alerts to their configured destinations regardless of success destination configuration.

- **FR-006**: System MUST support the success destination independently per inventory file, allowing different targets to have different configurations.

### Key Entities _(include if feature involves data)_

- **AlertDestination**: Existing entity representing a single notification destination (contains `destination` string field).

- **InventoryAlert**: Container for all alert destinations. Currently contains `inventory` and `detection` sub-objects. Will be extended with **required** `successNotification` field.

- **SuccessNotificationAlert**: New **required** field in InventoryAlert containing a single AlertDestination for success messages.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Security teams can configure success notifications to route to a different channel than violation alerts without code changes.

- **SC-002**: Inventory files missing the `successNotification` field fail validation with a clear error message.

- **SC-003**: 100% of success notifications route to the configured success destination.

- **SC-004**: 100% of violation alerts continue routing to their designated destinations regardless of success destination configuration.

## Assumptions

- The success destination uses the same format as existing alert destinations (a single `destination` string field pointing to a Slack channel or webhook URL).

- Success notifications are sent per execution (not per target) - this matches the current behavior where `alertOnSuccess` is called once with an `ExecutionSummary` containing all processed targets.

- The success destination is defined at the inventory file level (in the `alerts` object), not at a global configuration level.

- Existing inventory files will need to be updated to include the new required field before this version can be deployed (migration required).
