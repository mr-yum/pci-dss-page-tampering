# Feature Specification: Script Identification and Authorisation Refactor

**Feature Branch**: `001-refactor-script-identification`
**Created**: 2025-10-15
**Status**: Draft
**Input**: User description: "Refactor script identification and authorisation based on initial plan in refactor-plan.md"

## Clarifications

### Session 2025-10-15

- Q: When a detected script matches multiple inventory entries (e.g., both a broad `.*facebook.*` nameMatcher and a specific `facebook.net/signals/config/.*` nameMatcher), which inventory entry should be used? → A: First match wins (order-dependent in inventory array)
- Q: When an inventory is loaded with an invalid regex pattern in a nameMatcher or contentMatcher (e.g., unclosed bracket `[abc`), what should the system do? → A: Fail inventory load with validation error (reject entire inventory)
- Q: When a detected script has null or empty content (e.g., an inline script tag with no content or a failed external script fetch), how should the system handle it? → A: Treat as UnknownScriptFound (generate alert for investigation)
- Q: When the new schema with identifyWith/authoriseWith is deployed, how should existing inventory files be migrated? → A: Reject old schema, require manual update
- Q: When an inventory entry uses the same matcher type for both identifyWith and authoriseWith (e.g., contentMatcher for both), is this allowed? → A: Allow same matcher type (valid use case)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Flexible Script Matching (Priority: P1)

The compliance system needs to identify and authorize scripts using different matching strategies. Currently, the system uses hardcoded logic that cannot distinguish between how a script is identified versus how its content is authorized. Operations teams need the ability to match scripts by name patterns (for external scripts with dynamic URLs), content patterns (for inline scripts), or cryptographic hashes (for strict integrity verification).

**Why this priority**: This is the foundation for all other improvements. Without separating identification from authorization, the system cannot properly handle different script types or provide accurate compliance reporting.

**Independent Test**: Can be fully tested by processing an inventory containing scripts with different matcher types (nameMatcher, contentMatcher, hashes) and verifying each script is correctly identified and authorized according to its configured matchers.

**Acceptance Scenarios**:

1. **Given** an inventory with a script configured with nameMatcher for identification and contentMatcher for authorization, **When** the system processes a detected script matching the name pattern, **Then** the script is identified correctly and its content is validated against the content pattern
2. **Given** an inventory with a script configured with contentMatcher for identification and hashes for authorization, **When** the system processes an inline script matching the content pattern, **Then** the script is identified correctly and its hash is validated against the authorized hash list
3. **Given** an inventory with a script configured with nameMatcher for identification and hashes for authorization, **When** the system processes an external script, **Then** the script is identified by URL pattern and its content hash is verified
4. **Given** multiple scripts with overlapping identification patterns, **When** the system processes a detected script, **Then** the first matching inventory entry (in array order) is selected

---

### User Story 2 - Modular Matcher System (Priority: P2)

The development team needs to add new matching strategies without modifying core comparison logic. Each matcher type (name, content, hash) should be independently testable and extensible. This enables the team to add new matcher types in the future (such as script size limits, execution time patterns, or structural patterns) without risking regressions in existing functionality.

**Why this priority**: Modularity enables safe evolution of the system and reduces maintenance burden. Without this, every new matcher type requires changes to multiple parts of the codebase and increases regression risk.

**Independent Test**: Can be tested by implementing a new matcher type and verifying it integrates with the comparison system without requiring changes to existing matchers or comparison orchestration logic.

**Acceptance Scenarios**:

1. **Given** a new matcher type implementation, **When** it is registered with the matcher system, **Then** it can be used in inventory configurations without changes to core comparison logic
2. **Given** multiple matcher types operating on the same script, **When** any matcher fails, **Then** the failure is isolated and does not affect other matchers
3. **Given** a matcher type with specific validation rules, **When** an inventory is loaded with invalid matcher configuration, **Then** the system reports the specific validation error for that matcher type

---

### User Story 3 - Typed Comparison Results (Priority: P3)

Alert handlers need complete context about what was detected and why it violated policy. Currently, comparison results lack type safety and sufficient context. Operations teams need to receive alerts that clearly distinguish between "unknown script found" versus "known script with unauthorized content" versus "known script with updated hash". Each alert must include all information needed to take action without additional system queries.

**Why this priority**: Clear, actionable alerts reduce response time and prevent alert fatigue. Without typed results, handlers receive ambiguous information leading to delayed incident response.

**Independent Test**: Can be tested by triggering each comparison result type and verifying the handler receives complete context (script details, target information, matcher that failed) without additional lookups.

**Acceptance Scenarios**:

1. **Given** a script not in the inventory, **When** comparison completes, **Then** an UnknownScriptFound result is generated with the full script details and target information
2. **Given** a script in the inventory with content that fails authorization, **When** comparison completes, **Then** a KnownScriptWithUnauthorisedContentFound result is generated with script details, detected content, target, and the authorization matcher that failed
3. **Given** a script in the inventory matching all criteria, **When** comparison completes, **Then** an AuthorizedScriptFound result is generated confirming compliance
4. **Given** comparison results from a full workflow execution, **When** handlers process the results, **Then** each handler receives only results relevant to its alert type with no additional context required

---

### Edge Cases

- When a script matches multiple inventory entries, the first matching entry in array order is used (subsequent matches are ignored)
- Inventory entries with identifyWith and authoriseWith using the same matcher type are valid and allowed (e.g., contentMatcher for both identification and authorization)
- Invalid regex patterns in nameMatcher or contentMatcher cause inventory load to fail with a specific validation error identifying the invalid pattern
- How does the system handle hash collision (extremely unlikely but theoretically possible)?
- Detected scripts with null or empty content are treated as UnknownScriptFound and generate alerts for investigation (fail-secure approach)
- How does the system handle inventory entries missing required matcher properties?
- What happens when a nameMatcher pattern matches both external and inline scripts?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support three matcher types: nameMatcher (regex pattern for script names/URLs), contentMatcher (regex pattern for script content), and hashes (array of cryptographic hash values with timestamps)
- **FR-002**: Each inventory script entry MUST define separate identifyWith and authoriseWith properties, each specifying exactly one matcher type
- **FR-003**: System MUST match detected scripts against inventory using the identifyWith matcher to determine which inventory entry applies; when multiple entries match, the first match in array order is selected
- **FR-004**: System MUST validate detected script content against the matched inventory entry's authoriseWith matcher to determine authorization status
- **FR-005**: System MUST support nameMatcher for external scripts loaded from URLs with dynamic query parameters
- **FR-006**: System MUST support contentMatcher for inline scripts embedded in page HTML
- **FR-007**: System MUST support hashes matcher for strict cryptographic integrity verification using SHA-256 or stronger algorithms
- **FR-008**: System MUST generate typed comparison results with complete context: UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound
- **FR-009**: Comparison results MUST include all information needed by handlers: script details (name, content, hash), target information (URL, workflow), matcher details (type, pattern/hashes, failure reason)
- **FR-010**: System MUST validate inventory schema on load and reject invalid configurations with specific error messages identifying the validation failure; this includes validating all regex patterns in nameMatcher and contentMatcher fields are syntactically valid
- **FR-011**: System MUST reject inventories using the old schema format and provide clear error messages indicating manual migration is required; inventories must be manually updated to the new identifyWith/authoriseWith schema before deployment
- **FR-012**: Each matcher type MUST be independently testable without requiring full workflow execution
- **FR-013**: System MUST handle matcher failures gracefully and continue processing remaining scripts
- **FR-014**: System MUST log matcher execution details for audit purposes (which matcher ran, result, execution time)
- **FR-015**: Comparison results MUST be returned as an array that can be processed sequentially by handlers
- **FR-016**: System MUST treat detected scripts with null or empty content as UnknownScriptFound and generate alerts for investigation

### Key Entities

- **Script Inventory Entry**: Defines how to identify and authorize a script. Contains identifyWith matcher (one of: nameMatcher, contentMatcher, hashes), authoriseWith matcher (one of: nameMatcher, contentMatcher, hashes), and authorisationInfo (description, authorized flag, date)
- **Matcher**: A strategy for matching scripts. Three types: NameMatcher (regex pattern for script name/URL), ContentMatcher (regex pattern for script content), HashMatcher (array of authorized hash values with timestamps)
- **Detected Script**: A script found during workflow execution. Contains name (URL or identifier), content (source code), hash (computed cryptographic hash), and context (target, workflow step)
- **Comparison Result**: Typed outcome of comparing a detected script against inventory. Types: UnknownScriptFound (script not in inventory), KnownScriptWithUnauthorisedContentFound (script identified but authorization failed), AuthorizedScriptFound (script fully compliant). Each includes full context for handlers
- **Alert Configuration**: Maps comparison result types to alert destinations. Different destinations for inventory workflow (newScriptIdentified) versus detection workflow (newScriptDetected, scriptMismatchDetected)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: System correctly identifies and authorizes 100% of test cases covering all combinations of matcher types (nameMatcher, contentMatcher, hashes for both identify and authorize)
- **SC-002**: New matcher types can be added and tested independently without modifying core comparison logic (measured by zero changes required outside matcher implementation)
- **SC-003**: Comparison results contain sufficient context that handlers require zero additional queries to generate alerts (measured by handler code review showing no lookups)
- **SC-004**: Inventory validation detects 100% of invalid matcher configurations before processing begins (measured by test coverage of schema validation)
- **SC-005**: Alert handlers can distinguish between all comparison result types and route to appropriate destinations (measured by correct alert routing for each result type)
- **SC-006**: System maintains existing detection and inventory workflows with zero regression in alert accuracy (measured by comparison with current production alerts)
- **SC-007**: Matcher execution is fully auditable with logs showing which matchers ran and their results (measured by log completeness in test scenarios)

## Assumptions

- The refactored system will maintain the existing dual-workflow architecture (inventory vs detection)
- Existing inventories will be manually migrated to the new schema format before deployment (no automatic migration)
- Cryptographic hash algorithm remains SHA-256 (current standard)
- Matcher patterns use JavaScript regular expression syntax
- Alert destinations (Slack channels) remain unchanged
- The system continues to run on scheduled intervals (daily)
- Git-based audit trail for inventory changes is preserved
- Puppeteer workflow execution and script capture mechanisms remain unchanged
- Performance requirements remain unchanged (processing time per target)
