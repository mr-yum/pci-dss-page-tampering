# Feature Specification: Embed Authorization Info in Authorization Entity

**Feature Branch**: `004-enhance-the-schema`
**Created**: 2025-10-21
**Status**: Draft
**Input**: User description: "Enhance the schema so that the authorisationInfo is part of the authoriseWith entity so authorisation info is directly linked to the authorisation logic. Make sure this is also the case when saving updates. Include tests to validate that the written schema is valid for updates."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Schema Restructuring for Better Data Cohesion (Priority: P1)

As a system maintainer, when I examine an inventory entry's authorization configuration, I need all authorization-related information (matcher logic AND metadata) grouped together so that I can understand the complete authorization context from a single source.

**Why this priority**: This is the core structural change that enables all other improvements. Without this, the data model remains fragmented and prone to integrity issues.

**Independent Test**: Can be fully tested by creating a new inventory entry with the nested structure, saving it to JSON, and verifying the schema validates correctly and preserves the nested structure on round-trip.

**Acceptance Scenarios**:

1. **Given** an inventory entry with nested authorisationInfo inside authoriseWith, **When** the entry is serialized to JSON, **Then** the JSON structure shows authorisationInfo as a child of authoriseWith
2. **Given** a JSON inventory file with nested authorisationInfo, **When** the file is loaded and validated, **Then** the Zod schema validation passes without errors
3. **Given** an inventory entry with authorization metadata, **When** accessing authorization context, **Then** all information (matcher + metadata) is available from the authoriseWith field

---

### User Story 2 - Backward Compatibility During Updates (Priority: P2)

As a system operator, when existing inventory files are updated with the new schema, I need the system to handle the transition gracefully so that no data is lost and all existing entries continue to function.

**Why this priority**: Ensures smooth migration without data loss or system disruption. Critical for production deployments.

**Independent Test**: Can be tested by loading an old-format inventory, converting it to the new format, saving it, and verifying all data is preserved and accessible.

**Acceptance Scenarios**:

1. **Given** an inventory file in the old format (separate authorisationInfo), **When** the system loads it, **Then** a migration process converts it to the new nested format
2. **Given** a converted inventory entry, **When** saving to JSON, **Then** the output uses the new nested structure
3. **Given** multiple inventory entries with varying authorization states, **When** migration occurs, **Then** all authorised flags, descriptions, and dates are preserved accurately

---

### User Story 3 - Test Validation for Schema Integrity (Priority: P1)

As a developer, when I make changes to inventory structures, I need comprehensive tests that validate the schema's correctness so that I can be confident the changes work correctly and don't introduce bugs.

**Why this priority**: Testing infrastructure is critical for ensuring the schema enhancement works correctly and continues to work as the codebase evolves.

**Independent Test**: Can be tested by running the test suite and verifying all schema validation, round-trip serialization, and service integration tests pass.

**Acceptance Scenarios**:

1. **Given** a new inventory entry created in code, **When** it's serialized to JSON and deserialized back, **Then** the authorisationInfo remains nested within authoriseWith
2. **Given** an inventory entry with the new schema, **When** comparison services access authorization data, **Then** they correctly retrieve authorisationInfo from the nested location
3. **Given** various edge cases (missing fields, null values, unauthorized entries), **When** schema validation runs, **Then** appropriate validation errors or successes occur

---

### Edge Cases

- What happens when an inventory entry has authoriseWith but missing authorisationInfo?
- How does the system handle a JSON file with partially migrated entries (some old format, some new format)?
- What occurs when authorisationInfo fields are null or have invalid date formats?
- How does serialization handle matcher types that don't support certain configurations?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST nest authorisationInfo inside the authoriseWith field in the inventory schema
- **FR-002**: System MUST update InventoryScriptInfo and InventoryHeaderInfo type definitions to reflect the nested structure
- **FR-003**: System MUST validate inventory data to ensure authorisationInfo is correctly nested within authoriseWith structure
- **FR-004**: System MUST update matcher configuration schema to wrap matcher configs with authorisationInfo in a composite structure
- **FR-005**: System MUST update conversion utilities (scriptInfoToInventoryScriptInfo, rawInventoryScriptInfoToInventoryScriptInfo, inventoryScriptInfoToRawInventoryScriptInfo) to create and preserve the nested structure
- **FR-006**: System MUST update ScriptComparisonService to access authorisationInfo from the nested location within authoriseWith
- **FR-007**: System MUST update HeaderComparisonService to access authorisationInfo from the nested location within authoriseWith
- **FR-008**: System MUST ensure serialization (saving to JSON) preserves the nested authorisationInfo within authoriseWith
- **FR-009**: System MUST ensure deserialization (loading from JSON) correctly reconstructs the nested structure
- **FR-010**: System MUST provide tests that validate the new schema structure conforms to defined data contracts
- **FR-011**: System MUST provide tests that validate round-trip serialization (save and load) preserves nested authorisationInfo
- **FR-012**: System MUST provide tests that validate comparison services correctly access authorization data from the new location
- **FR-013**: System MUST handle edge cases (missing authorisationInfo, null values, unauthorized entries) with appropriate validation or error handling

### Key Entities _(include if feature involves data)_

- **AuthorizeWith Entity**: Composite structure containing both the matcher configuration (nameMatcher, contentMatcher, hashes, headerNameMatcher) AND the authorisationInfo metadata (description, authorised flag, date). This replaces the current flat structure where authorisationInfo is a sibling of authoriseWith.

- **InventoryScriptInfo**: Inventory entry for scripts with identifyWith (Matcher), and authoriseWith (new composite structure with matcher + authorisationInfo)

- **InventoryHeaderInfo**: Inventory entry for headers with identifyWith (Matcher), and authoriseWith (new composite structure with matcher + authorisationInfo)

- **RawMatcherConfigWithAuth**: JSON-serializable wrapper that combines a RawMatcherConfig with InventoryAuthorisationInfo for persistence

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All inventory entries serialized to JSON show authorisationInfo nested within authoriseWith object (100% of entries)
- **SC-002**: Data validation passes for all inventory files using the new nested structure (0 validation errors)
- **SC-003**: Round-trip serialization tests (save to JSON, load from JSON) preserve nested authorisationInfo with 100% data fidelity
- **SC-004**: All comparison service tests pass with authorization data accessed from the new nested location (0 test failures)
- **SC-005**: Schema enhancement introduces zero breaking changes to existing functionality as validated by full test suite passing
- **SC-006**: Authorization data access is simplified to a single location in 100% of service code that accesses authorization information

## Assumptions

- **A-001**: The system does not need to support reading old-format inventory files indefinitely; a one-time migration or manual update is acceptable
- **A-002**: The Matcher interface itself does not need to change; only the wrapper structure around matchers needs enhancement
- **A-003**: All existing inventory files can be updated before deploying this change, or the system will provide a migration script
- **A-004**: Test coverage will focus on the new schema structure; comprehensive tests for unchanged matcher logic are already in place
- **A-005**: The authoriseWith field will become a composite object type rather than a direct Matcher instance in the processed model

## Dependencies

- **D-001**: Data validation framework for schema validation (already in use)
- **D-002**: Existing matcher system for identifying and authorizing resources remains unchanged
- **D-003**: Existing serialization infrastructure for inventory files remains unchanged

## Out of Scope

- Changing the Matcher interface or implementations
- Modifying the identification logic (identifyWith remains unchanged)
- Altering the comparison algorithm beyond accessing authorisationInfo from a new location
- Creating automated migration tools (manual inventory updates acceptable)
- Changing alert logic or detection workflows
- Modifying the Git-based storage mechanism
