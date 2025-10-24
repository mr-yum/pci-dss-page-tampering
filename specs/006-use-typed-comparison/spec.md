# Feature Specification: Use Typed Comparison Results for Inventory Updates

**Feature Branch**: `006-use-typed-comparison`
**Created**: 2025-10-24
**Status**: Draft
**Input**: User description: "Use typed comparison results to directly apply diff on inventory in generic way during inventory stage, instead of converting into legacy model"

## Clarifications

### Session 2025-10-24

- Q: When duplicate typed results occur (same script detected multiple times), should the system deduplicate before processing or handle idempotently during inventory updates? → A: Handle idempotently during inventory updates (allow duplicates in input, ensure inventory update operations are idempotent)
- Q: When automatically adding a new hash or content matcher during inventory updates, what should the authorization metadata describe and what should the authorized status be? → A: If it is an additional hash of a known script, add hash and keep authorisationInfo as is
- Q: When converting a single matcher to array syntax (adding a new hash/content matcher alongside the original), should the new matcher in the array have its own separate authorisationInfo or share the parent's? → A: Each matcher in the array has its own authorisationInfo (original matcher keeps its info, new matcher gets new info with discovery context)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Direct Inventory Updates from Typed Results (Priority: P1)

The PCI DSS compliance system currently converts typed comparison results (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, etc.) back into a legacy model (ScriptComparisonResult with newScripts/newHashes arrays) before applying inventory updates. This conversion is unnecessary since typed results contain all information needed to update the inventory directly.

**Why this priority**: This is the core refactoring that eliminates unnecessary data transformations and simplifies the codebase. All other improvements depend on having a direct path from comparison results to inventory updates.

**Independent Test**: Can be fully tested by running the inventory workflow with any target and verifying that the inventory is updated correctly with new scripts, new hashes, and new headers without using the legacy ScriptComparisonResult/HeaderComparisonSummary types.

**Acceptance Scenarios**:

1. **Given** an inventory workflow detects an unknown script, **When** the comparison service returns UnknownScriptFound result, **Then** the inventory service adds a new entry directly from the typed result without converting to ScriptComparisonResult
2. **Given** an inventory workflow detects a known script with new hash, **When** the comparison service returns KnownScriptWithUnauthorisedContentFound result with hash mismatch, **Then** the inventory service adds the new hash to the existing entry's authoriseWith (converting to array syntax if it's currently a single matcher)
3. **Given** an inventory workflow detects a known script with unauthorized content where authoriseWith uses non-hash matcher, **When** the comparison service returns KnownScriptWithUnauthorisedContentFound, **Then** the inventory service converts authoriseWith to array syntax containing both the original matcher and a new hash matcher with the detected hash
4. **Given** an inventory workflow detects a known header with unauthorized content, **When** the comparison service returns KnownHeaderWithUnauthorisedContentFound, **Then** the inventory service adds a new content matcher to the existing entry's authoriseWith array (not creating a new inventory entry)
5. **Given** an inventory workflow completes with multiple typed results, **When** the inventory service processes all results, **Then** the inventory is updated with all changes in a single pass without intermediate legacy model conversions

---

### User Story 2 - Generic Resource Update Handler (Priority: P2)

The system currently has separate update logic for scripts (getUpdatedInventoryWithNewScripts, getUpdatedInventoryWithNewHashes) and headers (getUpdatedInventoryWithNewHeaders). Since both use the same matcher-based structure, a generic update handler can process both resource types.

**Why this priority**: Reduces code duplication and makes the system more maintainable. This builds on P1 by providing a unified way to handle all resource types.

**Independent Test**: Can be tested independently by verifying that both script and header updates go through the same generic processing logic and produce the same results as the current separate implementations.

**Acceptance Scenarios**:

1. **Given** a typed comparison result for any resource type (script or header), **When** the generic update handler processes it, **Then** the correct inventory section (scripts or headers) is updated with the appropriate changes
2. **Given** multiple typed results of mixed types (scripts and headers), **When** the generic handler processes them, **Then** all resources are correctly added or updated in their respective inventory sections
3. **Given** an UnknownScriptFound result, **When** the generic handler processes it, **Then** a new inventory entry is created with identifyWith and authoriseWith matchers derived from the detected resource

---

### User Story 3 - Remove Legacy Comparison Types (Priority: P3)

Once the inventory service uses typed results directly, the legacy ScriptComparisonResult and ScriptComparisonSummary types can be removed from the codebase, along with any conversion utilities.

**Why this priority**: This is a cleanup task that simplifies the type system after the core refactoring is complete. It ensures no legacy code paths remain.

**Independent Test**: Can be tested by verifying that the codebase compiles without ScriptComparisonResult/ScriptComparisonSummary types and that all tests pass.

**Acceptance Scenarios**:

1. **Given** the inventory service uses typed results directly, **When** the ScriptComparisonResult type is removed, **Then** all code compiles and all tests pass
2. **Given** legacy conversion utilities exist, **When** they are no longer referenced, **Then** they can be safely deleted without affecting functionality
3. **Given** the comparison service interface changes, **When** it returns only ComparisonResultType[], **Then** all consumers (inventory service, alert handlers) work correctly

---

### Edge Cases

- What happens when a typed result contains a script with null/empty content? (System should handle as UnknownScriptFound per existing fail-secure logic)
- How does the system handle a KnownScriptWithUnauthorisedContentFound result where the inventory entry's authoriseWith is not a hash matcher? (System should convert authoriseWith to array syntax with both the original matcher and a new hash matcher)
- How does the system handle a KnownScriptWithUnauthorisedContentFound result where authoriseWith is already an array? (System should add the new hash matcher to the existing array)
- What happens when processing mixed typed results (scripts and headers) in a single batch? (System should update both inventory sections correctly in a single pass)
- How does the system handle duplicate typed results (same script detected multiple times in different workflows)? (System should handle idempotently during inventory updates - allow duplicates in input array, ensure update operations check for existing hashes/matchers before adding)
- What happens when a KnownHeaderWithUnauthorisedContentFound result occurs for a header that already has an array of content matchers? (System should add the new content matcher to the existing authoriseWith array)
- What happens when a KnownHeaderWithUnauthorisedContentFound result occurs for a header with a single content matcher? (System should convert to array syntax and add the new content matcher)

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST process UnknownScriptFound results by creating new inventory entries with identifyWith and authoriseWith matchers
- **FR-002**: System MUST process KnownScriptWithUnauthorisedContentFound results by adding the detected hash to the matched inventory entry's authoriseWith, not creating a new entry
- **FR-002a**: When processing KnownScriptWithUnauthorisedContentFound where authoriseWith is a hash matcher, system MUST add the new hash to the existing hashes array
- **FR-002b**: When processing KnownScriptWithUnauthorisedContentFound where authoriseWith is not a hash matcher, system MUST convert authoriseWith to array syntax containing both the original matcher (preserving its authorisationInfo) and a new hash matcher with the detected hash and new authorisationInfo (description indicates discovery context, timestamp reflects addition date)
- **FR-003**: System MUST process UnknownHeaderFound results by creating new header inventory entries with identifyWith and authoriseWith matchers
- **FR-003a**: System MUST process KnownHeaderWithUnauthorisedContentFound results by adding a new content matcher to the matched inventory entry's authoriseWith array, not creating a new entry
- **FR-003b**: When processing KnownHeaderWithUnauthorisedContentFound where authoriseWith is a single matcher, system MUST convert to array syntax containing both the original matcher (preserving its authorisationInfo) and the new content matcher with new authorisationInfo (description indicates discovery context, timestamp reflects addition date)
- **FR-004**: System MUST handle typed results for both scripts and headers using a generic update mechanism
- **FR-005**: System MUST eliminate all conversions from ComparisonResultType[] to ScriptComparisonResult/HeaderComparisonSummary
- **FR-006**: System MUST preserve all existing inventory update behaviors (timestamp handling, hash deduplication, matcher structure)
- **FR-006a**: Inventory update operations MUST be idempotent - processing duplicate typed results multiple times produces the same final inventory state (check for existing hashes/matchers before adding)
- **FR-007**: System MUST process typed results in a single pass through the inventory, avoiding multiple mutation steps
- **FR-008**: System MUST maintain the distinction between inventory workflow (updates allowed) and detection workflow (read-only) based on target type
- **FR-009**: Inventory service MUST accept ComparisonResultType[] directly instead of ScriptComparisonSummary/HeaderComparisonSummary
- **FR-010**: System MUST handle AuthorizedScriptFound and AuthorizedHeaderFound results by taking no action (already compliant)
- **FR-011**: When adding a new hash to an existing hash matcher's hashes array (FR-002a), system MUST preserve the existing authorisationInfo unchanged (add hash only, do not modify authorization metadata)
- **FR-011a**: When adding a new content matcher to an existing header array (FR-003a where already an array), system MUST give the new matcher its own authorisationInfo with discovery context and timestamp
- **FR-011b**: When converting to array syntax (FR-002b, FR-003b), each matcher in the resulting array MUST have its own authorisationInfo - original matcher preserves its existing metadata, new matcher gets new metadata with discovery context

### Key Entities _(include if feature involves data)_

- **ComparisonResultType**: Union type of all typed comparison results (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound, UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound)
- **InventoryUpdateAction**: Representation of a change to be applied to inventory (add new entry, update existing entry with hash, no action needed)
- **ResourceType**: Discriminator indicating whether a typed result refers to a script or header

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Inventory service processes typed comparison results without any intermediate conversion to legacy types
- **SC-002**: All existing inventory workflow tests pass without modification to test expectations (behavior unchanged)
- **SC-003**: Codebase contains zero references to ScriptComparisonResult and ScriptComparisonSummary types after refactoring
- **SC-004**: Code complexity reduces by eliminating separate update methods for scripts and headers
- **SC-005**: Inventory update logic completes in a single pass through typed results (no multiple iterations)
- **SC-006**: Type safety improves by removing legacy types and relying solely on typed comparison results
