# Feature Specification: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
**Created**: 2025-10-17
**Status**: Draft
**Input**: User description: "continuing our refactor, we want to persue a similar approach for headers as well as ensure any downstream actions such as alerting leverage our strongly typed approach."

## Clarifications

### Session 2025-10-17

- Q: What happens when header name matching is case-sensitive vs case-insensitive? → A: case-insensitive for header names (not content)
- Q: What happens when a header has multiple values and some match the inventory while others don't? → A: Generate separate comparison results for each value (one result per value)
- Q: What happens when inventory header entries have overlapping name patterns? → A: First-match-wins - Use first matching inventory entry in array order (consistent with scripts)
- Q: How does the system handle headers with empty string values? → A: Treat as valid - Compare empty values against inventory patterns (pattern determines authorization)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Typed Header Comparison Results (Priority: P1)

The header comparison system currently returns a simple summary with an optional Map of unauthorized headers, lacking the context and type safety achieved in the script refactor. Operations teams need to receive header alerts that clearly distinguish between "unknown header found" versus "known header with unauthorized content" versus "authorized header". Each alert must include all information needed to take action without additional system queries.

**Why this priority**: This is the foundation for consistent, actionable header compliance reporting. Without typed results matching the script system's structure, handlers receive ambiguous information and the codebase has inconsistent patterns.

**Independent Test**: Can be fully tested by processing a header detection summary against an inventory and verifying each header generates the appropriate typed result (UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, or AuthorizedHeaderFound) with complete context.

**Acceptance Scenarios**:

1. **Given** a detected header with no matching inventory entry, **When** comparison completes, **Then** an UnknownHeaderFound result is generated with the full header details (name, values) and target information
2. **Given** a detected header matching an inventory entry's name pattern but failing content validation, **When** comparison completes, **Then** a KnownHeaderWithUnauthorisedContentFound result is generated with header details, detected values, target, and the matcher that failed
3. **Given** a detected header matching both name and content patterns in inventory, **When** comparison completes, **Then** an AuthorizedHeaderFound result is generated confirming compliance
4. **Given** a header with multiple values where some are authorized and some are not, **When** comparison completes, **Then** separate typed results are generated for each value

---

### User Story 2 - Alert Service Leveraging Typed Results (Priority: P2)

The alert service has both legacy alert methods (`alertForScripts`, `alertForHeaders`) and new typed alert methods (`alertForTypedResults`). The codebase needs to fully adopt the typed approach, removing legacy methods and ensuring all alerts are generated from typed comparison results. This provides consistency, maintainability, and ensures all alert handlers have complete context.

**Why this priority**: Consistent alert handling across scripts and headers reduces maintenance burden and ensures predictable alert behavior. Removing dual code paths prevents bugs from inconsistent alert routing.

**Independent Test**: Can be tested by triggering each comparison result type (for both scripts and headers) and verifying alerts are routed correctly with complete context and no legacy methods invoked.

**Acceptance Scenarios**:

1. **Given** typed header comparison results, **When** the alert service processes them, **Then** alerts are generated using the typed alert handler with complete header context
2. **Given** typed script comparison results, **When** the alert service processes them, **Then** alerts are generated using the typed alert handler with complete script context
3. **Given** a mix of script and header comparison results, **When** the alert service processes them, **Then** all alerts are routed through the unified typed alert handler
4. **Given** legacy alert methods have been removed, **When** the codebase is compiled, **Then** no references to `alertForScripts` or `alertForHeaders` exist

---

### User Story 3 - Header Matcher Architecture (Priority: P3)

The header comparison service currently uses inline regex matching logic without the matcher abstraction pattern used for scripts. To maintain consistency and enable future extensibility, headers should use the same Matcher interface pattern (NameMatcher for header names, ContentMatcher for header values).

**Important Distinction**: While headers will use the same architectural pattern as scripts (`identifyWith` and `authoriseWith` properties in inventory entries), the concrete matcher implementations will likely differ. For example, a `HeaderNameMatcher` will perform case-insensitive matching against HTTP header names, while a `ScriptNameMatcher` performs case-sensitive matching against script URLs. Both implement the Matcher interface but have different matching behavior appropriate to their domain. This allows the system to maintain architectural consistency while accommodating the different semantics of header vs script identification.

**Why this priority**: Architectural consistency enables easier maintenance and future enhancements. While not immediately critical, mismatched patterns create technical debt.

**Independent Test**: Can be tested by configuring inventory entries with HeaderMatcher instances and verifying the comparison service correctly identifies and authorizes headers using the matcher pattern.

**Acceptance Scenarios**:

1. **Given** an inventory with header entries using HeaderNameMatcher (or similar header-specific name matcher) for header name matching, **When** headers are compared, **Then** the matcher's identify method performs case-insensitive matching instead of inline regex logic
2. **Given** an inventory with header entries using ContentMatcher for header value authorization, **When** headers are compared, **Then** the matcher's authorize method is used instead of inline content validation
3. **Given** a header matcher that fails, **When** the failure is logged, **Then** the matcher type and pattern are included for debugging (consistent with script matchers)
4. **Given** both HeaderNameMatcher and ScriptNameMatcher implementations exist, **When** each is used in their respective domains, **Then** both correctly implement the Matcher interface while providing domain-appropriate matching behavior (case-insensitive for headers, case-sensitive for script URLs)

---

### Edge Cases

- When a header has multiple values with mixed authorization status, the system generates one comparison result per value (authorized values get AuthorizedHeaderFound, unauthorized values get separate UnknownHeaderFound or KnownHeaderWithUnauthorisedContentFound results)
- Headers with empty string values are treated as valid and compared against inventory patterns; authorization is determined by whether the empty value matches the contentMatcher (e.g., `^$` regex pattern would authorize empty values)
- Header names are matched case-insensitively (per HTTP RFC 7230), but header content/values are matched case-sensitively
- How does the system handle duplicate header values in the Set?
- When multiple inventory header entries have overlapping name patterns, the first matching entry in array order is used (subsequent matches are ignored); this maintains consistency with script matching behavior
- How does the system handle headers with values containing special characters or non-ASCII content?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST generate typed comparison results for headers: UnknownHeaderFound, KnownHeaderWithUnauthorisedContentFound, AuthorizedHeaderFound
- **FR-002**: Header comparison results MUST extend the same ComparisonResult base class used by script results, providing target and timestamp properties
- **FR-003**: UnknownHeaderFound MUST include the detected header name, values, and target information
- **FR-004**: KnownHeaderWithUnauthorisedContentFound MUST include the detected header details, inventory entry that matched, matcher that failed authorization, and failure reason
- **FR-005**: AuthorizedHeaderFound MUST include the detected header details and matching inventory entry
- **FR-006**: Header comparison results MUST be returned as an array of typed results (same pattern as script comparison)
- **FR-007**: Alert service MUST process typed header results through a unified typed alert handler (no separate header-specific methods)
- **FR-008**: Alert service MUST remove legacy methods `alertForScripts` and `alertForHeaders` after migration to typed results
- **FR-009**: Alert service typed handler MUST support both script and header result types through discriminated union pattern
- **FR-010**: Header comparison service MUST support matchers for header name identification and content authorization (matching script matcher architecture)
- **FR-010a**: System MUST implement distinct matcher classes for headers and scripts (e.g., HeaderNameMatcher vs ScriptNameMatcher) that share the Matcher interface but provide domain-appropriate matching behavior; both headers and scripts use `identifyWith` and `authoriseWith` properties but reference different concrete matcher implementations
- **FR-010b**: System MUST perform case-insensitive matching for header names (per HTTP RFC 7230) while maintaining case-sensitive matching for header content values
- **FR-010c**: System MUST use first-match-wins logic when multiple inventory header entries have overlapping name patterns; the first matching entry in array order is selected and subsequent matches are ignored
- **FR-011**: System MUST maintain existing alert destinations and routing logic (inventory workflow → newHeaderIdentified, detection workflow → newHeaderDetected)
- **FR-012**: Typed header results MUST include sufficient context that alert handlers require zero additional queries to generate alerts
- **FR-013**: System MUST handle headers with multiple values by generating one comparison result per value; each value is independently matched and authorized (a header with 3 values produces 3 separate comparison results)
- **FR-013a**: System MUST treat headers with empty string values as valid input and compare them against inventory patterns; authorization is determined by the contentMatcher (empty values are not automatically authorized or rejected)
- **FR-014**: ComparisonResultType union MUST include both script and header result types for exhaustive type checking in handlers

### Key Entities

- **Header Inventory Entry**: Defines how to identify and authorize a header. Contains nameMatcher (pattern for header name), contentMatcher (pattern for header value), and authorisationInfo (description, authorized flag, date)
- **Header Comparison Result**: Typed outcome of comparing a detected header against inventory. Types: UnknownHeaderFound (header not in inventory), KnownHeaderWithUnauthorisedContentFound (header identified but value authorization failed), AuthorizedHeaderFound (header fully compliant). Each includes full context for handlers
- **Detected Header**: A header found during workflow execution. Contains name, values (Set of strings), and context (target, workflow)
- **Unified Comparison Result Union**: Combined type for all comparison results (scripts and headers). Enables a single alert handler to process all result types with exhaustive type checking

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: System correctly generates typed results for 100% of header comparison scenarios (unknown, unauthorized content, authorized)
- **SC-002**: Alert handlers process header results with zero additional queries needed for context (measured by handler code review showing no lookups)
- **SC-003**: Codebase has zero references to legacy alert methods after migration (measured by grep search for `alertForScripts` and `alertForHeaders`)
- **SC-004**: Both script and header alerts flow through a single unified typed alert handler (measured by single code path in alert service)
- **SC-005**: Header comparison service uses matcher pattern consistently with script comparison (measured by both services using Matcher interface)
- **SC-006**: System maintains existing alert routing and destinations with zero regression (measured by comparison with current production alerts)
- **SC-007**: Type system prevents mixing script and header result processing incorrectly (measured by TypeScript compilation enforcing discriminated unions)

## Assumptions

- The header comparison system will adopt the same Matcher interface pattern used for scripts (NameMatcher, ContentMatcher)
- While the architectural pattern is shared (using `identifyWith` and `authoriseWith`), concrete matcher implementations will differ between headers and scripts to accommodate their different matching semantics (e.g., `HeaderNameMatcher` for case-insensitive header names vs `ScriptNameMatcher` for case-sensitive script URLs)
- Header inventory entries will follow a similar schema structure to script entries (identifyWith, authoriseWith)
- Existing header inventory data will need migration to the new typed schema format
- Alert destinations (Slack channels) remain unchanged
- The dual-workflow architecture (inventory vs detection) continues to apply to headers
- Header name matching follows the same first-match-wins logic as scripts
- Headers with multiple values will generate separate comparison results for each value to maintain granularity
- The system continues to use SHA-256 for any hash-based header integrity verification (if applicable)
