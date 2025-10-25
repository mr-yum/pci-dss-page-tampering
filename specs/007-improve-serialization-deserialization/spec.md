# Feature Specification: Improve Serialization/Deserialization for Composite Matchers

**Feature Branch**: `007-improve-serialization-deserialization`
**Created**: 2025-10-24
**Status**: Draft
**Input**: User description: "Improve serialization/deserialization, including fixing support for matcher composition (and/or) that currently breaks serialization."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Serialize Composite Matchers to JSON (Priority: P1)

Security engineers need to persist inventory configurations with composite matchers (OrMatcher, AndMatcher) to Git repositories. When inventory updates are pushed, the system must correctly convert composite matcher instances back to JSON-serializable configuration objects without data loss or errors.

**Why this priority**: This is the core blocker. Without serialization support, composite matchers cannot be persisted, making the feature unusable in production workflows.

**Independent Test**: Can be fully tested by creating an inventory entry with a simple OrMatcher containing two ContentMatchers, calling `inventoryScriptInfoToRawInventoryScriptInfo`, and verifying the returned JSON structure contains an `orMatcher` array with two `contentMatcher` entries.

**Acceptance Scenarios**:

1. **Given** an InventoryScriptInfo with OrMatcher containing two HashMatchers, **When** serializing to RawInventoryScriptInfo, **Then** the JSON structure contains `orMatcher` array with two `hashes` entries and preserves authorization metadata
2. **Given** an InventoryHeaderInfo with AndMatcher containing three ContentMatchers, **When** serializing to RawInventoryHeaderInfo, **Then** the JSON structure contains `andMatcher` array with three `contentMatcher` entries
3. **Given** a composite matcher with nested authorization info, **When** serializing, **Then** the top-level `authorisationInfo` is preserved alongside the matcher configuration
4. **Given** any valid composite matcher in memory, **When** serialization is attempted, **Then** no errors are thrown and valid JSON is produced

---

### User Story 2 - Deserialize Composite Matchers from JSON (Priority: P1)

Security engineers loading inventory configurations from Git repositories need the system to correctly reconstruct composite matcher instances (OrMatcher, AndMatcher) from JSON. All matcher logic, authorization metadata, and nesting relationships must be preserved during deserialization.

**Why this priority**: Equal priority to serialization - without both directions working, the feature cannot function. Deserialization is required every time the system starts or pulls updated inventories.

**Independent Test**: Can be fully tested by creating a RawInventoryScriptInfo JSON object with an `orMatcher` array containing two matcher configs, calling `rawInventoryScriptInfoToInventoryScriptInfo`, and verifying the returned object contains an OrMatcher instance with two child matchers.

**Acceptance Scenarios**:

1. **Given** RawInventoryScriptInfo JSON with `orMatcher` containing two `hashes` entries, **When** deserializing to InventoryScriptInfo, **Then** an OrMatcher instance is created with two HashMatcher children
2. **Given** RawInventoryHeaderInfo JSON with `andMatcher` containing three `contentMatcher` entries, **When** deserializing to InventoryHeaderInfo, **Then** an AndMatcher instance is created with three ContentMatcher children
3. **Given** JSON with nested authorization info on a composite matcher, **When** deserializing, **Then** the OrMatcher/AndMatcher instance contains the authorization metadata accessible via constructor parameter
4. **Given** any valid composite matcher JSON configuration, **When** deserialization is attempted, **Then** the resulting Matcher instance behaves identically to one created directly via constructors

---

### User Story 3 - Round-Trip Preservation (Priority: P2)

Security engineers modifying inventory files through the system need confidence that composite matcher configurations survive serialization/deserialization cycles without data corruption. All matcher patterns, authorization metadata, nesting structures, and date precision must be perfectly preserved across round-trips.

**Why this priority**: This ensures data integrity for the entire inventory management workflow. Without round-trip preservation, cumulative data loss occurs with each update cycle, degrading security configurations over time.

**Independent Test**: Can be fully tested by creating an InventoryScriptInfo with a nested OrMatcher (containing an AndMatcher with three children), serializing it, deserializing it, and verifying the final structure matches the original by comparing matcher types, patterns, authorization info, and dates.

**Acceptance Scenarios**:

1. **Given** an InventoryScriptInfo with OrMatcher containing two ContentMatchers, **When** serializing then deserializing, **Then** the resulting structure has identical matcher types, patterns, and authorization metadata
2. **Given** an InventoryHeaderInfo with AndMatcher containing nested OrMatcher, **When** performing round-trip, **Then** all nesting levels are preserved with correct matcher types
3. **Given** a composite matcher with authorization info containing special characters and millisecond-precision dates, **When** performing round-trip, **Then** all fields match exactly including date precision
4. **Given** a composite matcher with 10 levels of nesting, **When** performing round-trip, **Then** the structure is preserved without truncation or corruption

---

### User Story 4 - Nested Composite Matchers (Priority: P3)

Security engineers defining complex authorization policies need to create composite matchers with multiple nesting levels (e.g., OrMatcher containing AndMatchers containing ContentMatchers). The serialization system must handle arbitrary nesting depths up to practical limits (10 levels) without stack overflow or performance degradation.

**Why this priority**: While important for advanced use cases like complex CSP policies, most authorization scenarios use 2-4 nesting levels. This can be implemented after basic serialization/deserialization works.

**Independent Test**: Can be fully tested by creating an OrMatcher containing an AndMatcher containing an OrMatcher containing three leaf matchers, serializing it, deserializing it, and verifying all nesting levels and leaf patterns are preserved.

**Acceptance Scenarios**:

1. **Given** an OrMatcher containing AndMatchers which contain ContentMatchers (3 levels), **When** serializing and deserializing, **Then** all three nesting levels are preserved with correct matcher types
2. **Given** a deeply nested structure (10 levels), **When** serializing, **Then** no stack overflow occurs and JSON is produced in under 100ms
3. **Given** nested composite matchers with authorization metadata at multiple levels, **When** performing round-trip, **Then** metadata at each level is preserved and accessible
4. **Given** a composite matcher with mixed child types (OrMatcher with both leaf matchers and AndMatchers), **When** serializing and deserializing, **Then** all child types are correctly reconstructed

---

### Edge Cases

- What happens when a composite matcher has an empty children array? (Constructor should throw error per existing fail-secure behavior, serialization should never encounter this)
- What happens when serializing a composite matcher with null/undefined authorization info? (Should serialize without `authorisationInfo` field, deserialize creates matcher without metadata)
- What happens when deserializing JSON with both `orMatcher` and `andMatcher` fields? (Zod schema should reject as invalid, deserialization function should handle with error or precedence rule)
- How does the system handle extremely long descriptions or special characters in nested authorization metadata? (Should preserve all characters via JSON.stringify escaping, no truncation)
- What happens when serializing a composite matcher with circular references? (TypeScript types prevent construction, but runtime check may be needed)
- How does serialization perform with 100+ child matchers in a single composite? (Should complete without timeout, may need performance optimization for large arrays)

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST serialize OrMatcher instances to JSON objects with `orMatcher` array field containing serialized child matcher configurations
- **FR-002**: System MUST serialize AndMatcher instances to JSON objects with `andMatcher` array field containing serialized child matcher configurations
- **FR-003**: System MUST deserialize JSON objects with `orMatcher` field to OrMatcher instances with correctly reconstructed child matchers
- **FR-004**: System MUST deserialize JSON objects with `andMatcher` field to AndMatcher instances with correctly reconstructed child matchers
- **FR-005**: System MUST preserve top-level `authorisationInfo` on composite matchers during serialization (as sibling field to `orMatcher`/`andMatcher`)
- **FR-006**: System MUST preserve top-level `authorisationInfo` on composite matchers during deserialization (passed to constructor)
- **FR-007**: System MUST handle recursive serialization of nested composite matchers (composite matchers containing composite matchers)
- **FR-008**: System MUST handle recursive deserialization of nested composite matchers preserving all nesting levels
- **FR-009**: System MUST preserve authorization metadata paths through serialization/deserialization cycles (metadata at each nesting level)
- **FR-010**: System MUST convert authorization dates to ISO string format during serialization
- **FR-011**: System MUST convert ISO string dates to Date instances during deserialization
- **FR-012**: System MUST throw descriptive errors when encountering unknown matcher types during serialization
- **FR-013**: Serialization functions MUST support all existing leaf matcher types (NameMatcher, HeaderNameMatcher, ContentMatcher, HashMatcher)
- **FR-014**: Round-trip serialization/deserialization MUST preserve matcher behavior identically (identify() and authorize() produce same results)
- **FR-015**: System MUST complete serialization of composite matchers with up to 100 children in under 100ms

### Key Entities _(include if feature involves data)_

- **RawMatcherConfig**: JSON-serializable configuration object representing a matcher (discriminated union with `nameMatcher`, `headerNameMatcher`, `contentMatcher`, `hashes`, `orMatcher`, or `andMatcher` fields)
- **CompositeMatcherConfig**: Specific RawMatcherConfig variants for composite matchers containing `orMatcher: RawMatcherConfig[]` or `andMatcher: RawMatcherConfig[]` with optional `authorisationInfo`
- **SerializedInventoryEntry**: JSON structure for inventory entries containing serialized composite matchers with flat authorization structure (matcher config and authorisationInfo as siblings)

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Inventory configurations with composite matchers can be persisted to Git and retrieved without errors or data loss
- **SC-002**: 100% of round-trip serialization tests pass for all matcher types including nested composites up to 10 levels deep
- **SC-003**: Serialization completes in under 100ms for composite matchers with 100 children
- **SC-004**: All existing integration tests continue to pass without modification (no regression in leaf matcher serialization)
- **SC-005**: Authorization metadata including descriptions with special characters and millisecond-precision dates survive round-trips with exact equality
- **SC-006**: Deserialized composite matchers produce identical identify() and authorize() results compared to directly-constructed equivalents

## Assumptions

- The existing `createMatcher` factory function and `MatcherConfig` type already support composite matchers via `orMatcher` and `andMatcher` fields (confirmed by examining [src/types/matcher/matcher-factory.ts:31-37](src/types/matcher/matcher-factory.ts#L31-L37))
- The Zod schema for inventory validation already supports composite matcher JSON structures (validated at parse time before reaching serialization functions)
- Composite matcher constructors already validate non-empty children arrays and throw errors for invalid configurations (fail-secure behavior in [src/types/matcher/or-matcher.ts:55-63](src/types/matcher/or-matcher.ts#L55-L63))
- The existing serialization functions `inventoryScriptInfoToRawInventoryScriptInfo` and `inventoryHeaderInfoToRawInventoryHeaderInfo` are the correct extension points for adding composite matcher support
- JSON.stringify and JSON.parse are sufficient for serialization (no custom binary serialization or compression required)
- The system does not need to support bidirectional migration (existing inventories without composite matchers continue to work unchanged)
- Performance requirements are based on typical production inventories (10-50 scripts per target, 2-4 nesting levels)
- Authorization metadata at each nesting level is accessed via the existing `authorisationInfo` pattern (no new metadata access patterns required)

## Dependencies

- Existing matcher implementation ([src/types/matcher/](src/types/matcher/)) providing `getType()` and `getPattern()` methods for all matcher types
- Existing matcher factory ([src/types/matcher/matcher-factory.ts](src/types/matcher/matcher-factory.ts)) already supporting recursive composite matcher creation
- Existing Zod schemas ([src/types/inventory/zod.ts](src/types/inventory/zod.ts)) for validating inventory JSON structures before deserialization
- Existing test infrastructure ([test/unit/utils/script.test.ts](test/unit/utils/script.test.ts), [test/unit/utils/inventory.test.ts](test/unit/utils/inventory.test.ts)) with round-trip test patterns

## Out of Scope

- Modifying the Matcher interface or composite matcher implementations (OrMatcher, AndMatcher) - only serialization utilities are changed
- Changing the JSON schema structure for composite matchers - using existing `orMatcher`/`andMatcher` array format
- Adding new matcher types beyond the existing six (NameMatcher, HeaderNameMatcher, ContentMatcher, HashMatcher, OrMatcher, AndMatcher)
- Performance optimization for extremely large inventories (>500 scripts) - optimizations can be added later if needed
- Migration tools for converting existing inventories - composite matchers are additive, old inventories work unchanged
- UI/CLI tools for creating composite matcher configurations - manual JSON editing or programmatic creation only
- Validation beyond what Zod schema provides - serialization functions assume valid Matcher instances as input
- Binary serialization formats or compression - JSON is sufficient for Git-based storage
- Caching or memoization of serialized representations - serialize on demand when pushing to Git

## Non-Functional Requirements

- **NFR-001**: Serialization code must follow existing patterns in [src/utils/script.ts](src/utils/script.ts) and [src/utils/inventory.ts](src/utils/inventory.ts) for consistency
- **NFR-002**: Error messages must be descriptive enough for debugging (include matcher type and context)
- **NFR-003**: Code must be fully covered by unit tests following existing test patterns in [test/unit/utils/script.test.ts](test/unit/utils/script.test.ts)
- **NFR-004**: Implementation must not break existing serialization behavior for leaf matchers (backward compatible)
- **NFR-005**: Serialization functions must be pure (no side effects, same input produces same output)
