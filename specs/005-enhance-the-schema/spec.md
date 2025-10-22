# Feature Specification: Composite Matchers with Nested Authorization

**Feature Branch**: `005-enhance-the-schema`
**Created**: 2025-10-22
**Status**: Draft
**Input**: User description: "Enhance the schema to support composite matchers (OR/AND) with nested authorization"

## Clarifications

### Session 2025-10-22

- Q: When multiple nested matchers succeed in a composite tree, which authorization metadata should be exposed to alerts? → A: Full path of authorization metadata from root composite to successful leaf (array of metadata objects)
- Q: Should the system enforce a hard maximum nesting depth limit, and if so, at what point? → A: No hard limit, allow unlimited nesting depth (rely on performance degradation as natural boundary)
- Q: Should FR-009 about circular reference validation be retained? → A: Removed - circular references are impossible in JSON by design
- Q: Should composite matchers with a single child be allowed, and if so, how should they behave? → A: Allow single-child matchers; evaluate normally (OR/AND of one element returns that result)
- Q: When a composite matcher has both top-level `authorisationInfo` and child matchers with their own `authorisationInfo`, which takes precedence? → A: Top-level `authorisationInfo` always takes precedence (both true and false override child matchers), but matchers must still successfully match first

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Complex Content-Security-Policy Authorization (Priority: P1)

A security administrator needs to authorize a Content-Security-Policy header that must contain multiple required directives (AND logic). The header is compliant only when ALL required security directives are present in the policy. The `andMatcher` can contain any number of child matchers (two or more).

**Why this priority**: This is the core use case driving the feature - real-world CSP headers require multiple directive validations, and current single-matcher approach cannot express "all of these must be present" logic.

**Independent Test**: Can be fully tested by creating an inventory entry with an `andMatcher` containing multiple `contentMatcher` children (e.g., three or more directives), then verifying that headers are only authorized when all matchers succeed.

**Acceptance Scenarios**:

1. **Given** an inventory entry with `andMatcher` containing two content matchers, **When** a detected header matches both patterns, **Then** the header is authorized
2. **Given** an inventory entry with `andMatcher` containing three content matchers, **When** a detected header matches all three patterns, **Then** the header is authorized
3. **Given** an inventory entry with `andMatcher` containing three content matchers, **When** a detected header matches only two of three patterns, **Then** the header is unauthorized
4. **Given** an inventory entry with `andMatcher` and a top-level `authorisationInfo` with `authorised: true`, **When** a detected header matches all patterns, **Then** the header is authorized using the top-level authorization
5. **Given** an inventory entry with `andMatcher` and a top-level `authorisationInfo` with `authorised: false`, **When** a detected header matches all patterns, **Then** the header is unauthorized despite pattern match success
6. **Given** an inventory entry with `andMatcher` and a top-level `authorisationInfo` with `authorised: true`, **When** a detected header does not match the patterns, **Then** the inventory entry does not apply (continues to next entry)

---

### User Story 2 - Alternative Authorization Policies (Priority: P1)

A security administrator needs to authorize a header that can match ANY of several acceptable patterns (OR logic). For example, different valid CSP configurations from different deployment environments or phased rollouts. The `orMatcher` can contain any number of child matchers (two or more).

**Why this priority**: Equally critical to AND logic - organizations often have multiple acceptable security configurations (e.g., different CSP policies for different markets, A/B testing scenarios, or migration periods).

**Independent Test**: Can be fully tested by creating an inventory entry with an `orMatcher` containing multiple matcher alternatives (e.g., three or more options), then verifying that headers matching any single alternative are authorized.

**Acceptance Scenarios**:

1. **Given** an inventory entry with `orMatcher` containing two content matchers, **When** a detected header matches the first pattern only, **Then** the header is authorized
2. **Given** an inventory entry with `orMatcher` containing two content matchers, **When** a detected header matches the second pattern only, **Then** the header is authorized
3. **Given** an inventory entry with `orMatcher` containing four content matchers, **When** a detected header matches only the third pattern, **Then** the header is authorized
4. **Given** an inventory entry with `orMatcher` containing three content matchers, **When** a detected header matches none of the patterns, **Then** the header is unauthorized
5. **Given** an inventory entry with `orMatcher` where one child has `authorisationInfo` with `authorised: true`, **When** that child matcher matches, **Then** the authorization metadata is available for alert context

---

### User Story 3 - Backward-Compatible Array Syntax (Priority: P2)

A security administrator uses the simplified array syntax for `authoriseWith` to express OR logic without explicit `orMatcher` wrapper. Each array element represents an alternative authorization with its own metadata.

**Why this priority**: Provides syntactic sugar for the common OR case, reducing verbosity and improving readability. This is P2 because it's equivalent to explicit `orMatcher` - nice to have but not blocking.

**Independent Test**: Can be fully tested by creating an inventory entry where `authoriseWith` is an array of matchers (each with `authorisationInfo`), then verifying behavior is identical to explicit `orMatcher`.

**Acceptance Scenarios**:

1. **Given** an `authoriseWith` array with two content matchers, **When** a detected header matches the first matcher, **Then** the header is authorized using the first matcher's metadata
2. **Given** an `authoriseWith` array with two content matchers, **When** a detected header matches the second matcher, **Then** the header is authorized using the second matcher's metadata
3. **Given** an `authoriseWith` array with two content matchers, **When** a detected header matches both matchers, **Then** the header is authorized using the first matching matcher's metadata (first-match-wins)

---

### User Story 4 - Nested Composite Matchers (Priority: P3)

A security administrator creates complex authorization logic by nesting composite matchers (e.g., OR containing AND, or AND containing OR). This enables expressing sophisticated policies like "(A AND B) OR (C AND D)".

**Why this priority**: Advanced use case for complex security policies. P3 because simpler cases cover 90% of needs, but this provides maximum flexibility for edge cases.

**Independent Test**: Can be fully tested by creating an inventory entry with nested composite matchers (e.g., `orMatcher` containing `andMatcher` children), then verifying the logic tree evaluates correctly.

**Acceptance Scenarios**:

1. **Given** an `orMatcher` containing two `andMatcher` children, **When** a detected header satisfies all conditions of the first AND group, **Then** the header is authorized
2. **Given** an `orMatcher` containing two `andMatcher` children, **When** a detected header satisfies all conditions of the second AND group, **Then** the header is authorized
3. **Given** an `orMatcher` containing two `andMatcher` children, **When** a detected header partially satisfies both AND groups but completes neither, **Then** the header is unauthorized

---

### Edge Cases

- What happens when an `andMatcher` array is empty? (Should fail-secure: unauthorized)
- What happens when an `orMatcher` array is empty? (Should fail-secure: unauthorized)
- How does the system handle deeply nested composite matchers (e.g., 5+ levels)? (Should evaluate correctly with no hard depth limit; performance degradation is acceptable for extreme nesting)
- What happens when both a composite matcher AND a top-level `authorisationInfo` are present? (Top-level `authorisationInfo.authorised` value always takes precedence over child authorization decisions, but matchers must still match successfully)
- How does authorization metadata propagate from nested matchers? (Should capture full path of metadata from root to leaf as an array)
- What happens when `authoriseWith` is an array but contains composite matchers (mixing syntaxes)? (Should evaluate as OR of composites)
- What happens when a matcher has `authorisationInfo.authorised: false`? (Should be treated as unauthorized regardless of pattern match)

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support an `orMatcher` field that accepts an array of one or more child matchers and authorizes if ANY child matcher succeeds
- **FR-002**: System MUST support an `andMatcher` field that accepts an array of one or more child matchers and authorizes only if ALL child matchers succeed
- **FR-003**: System MUST allow child matchers within composite matchers to have their own `authorisationInfo` metadata (description, authorised, date)
- **FR-004**: System MUST evaluate authorization according to top-level `authorisationInfo.authorised` value (true or false) when present, overriding child matcher authorization decisions; matchers must still successfully match for the inventory entry to apply
- **FR-005**: System MUST evaluate authorization as successful when all subordinated matchers (in absence of top-level `authorisationInfo`) are authorized
- **FR-006**: System MUST treat `authoriseWith` as an array of matchers as equivalent to an `orMatcher` (syntactic sugar)
- **FR-007**: System MUST support nesting composite matchers within other composite matchers (e.g., `orMatcher` containing `andMatcher` elements)
- **FR-008**: System MUST validate that composite matchers (`orMatcher` and `andMatcher`) contain at least one child matcher (arrays cannot be empty); single-child matchers are valid and evaluate normally
- **FR-009**: System MUST preserve and expose the full path of authorization metadata from root composite matcher to successful leaf matcher as an array of metadata objects for alert context
- **FR-010**: System MUST support all existing matcher types (`contentMatcher`, `headerNameMatcher`, `nameMatcher`, `hashMatcher`) as children within composite matchers
- **FR-011**: System MUST evaluate `authorisationInfo.authorised: false` as unauthorized regardless of pattern match success
- **FR-012**: System MUST fail-secure (unauthorized) when composite matcher arrays are empty
- **FR-013**: System MUST maintain first-match-wins semantics for `orMatcher` evaluation order
- **FR-014**: System MUST evaluate all matchers in `andMatcher` and fail on the first unsuccessful match (short-circuit evaluation)

### Key Entities

- **OrMatcher**: Composite matcher that succeeds if any child matcher succeeds; contains an array of one or more child matchers (any matcher type including other composites); supports optional `authorisationInfo` override
- **AndMatcher**: Composite matcher that succeeds only if all child matchers succeed; contains an array of one or more child matchers (any matcher type including other composites); supports optional `authorisationInfo` override
- **AuthorisationInfo**: Metadata structure containing description (string), authorised (boolean), and date (ISO 8601 timestamp); can appear at composite matcher level or on individual child matchers
- **Composite Matcher Tree**: Hierarchical structure of nested OR/AND matchers with leaf nodes of concrete matcher types; evaluated recursively from root to leaves

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Security administrators can express complex multi-condition authorization policies using composite matchers without requiring code changes
- **SC-002**: Existing inventory entries without composite matchers continue to function identically (100% backward compatibility)
- **SC-003**: Alert context includes the complete authorization path (array of metadata objects from root to leaf) through the composite matcher tree
- **SC-004**: Schema validation rejects invalid composite matcher configurations (empty arrays) with clear error messages
- **SC-005**: Authorization evaluation completes for reasonably nested matchers (up to 10 levels) without significant performance degradation; deeper nesting is supported but may experience performance impact
- **SC-006**: Security administrators can migrate from simple matchers to composite matchers by wrapping existing configurations without changing matcher logic

## Assumptions

- **A-001**: The existing matcher system (NameMatcher, ContentMatcher, HashMatcher, HeaderNameMatcher) is stable and well-tested
- **A-002**: Inventory entries are validated at schema level before being persisted to Git
- **A-003**: Authorization decisions are made during comparison service execution, not at inventory load time
- **A-004**: The matcher interface supports extension to include composite matcher types
- **A-005**: Authorization metadata from nested matchers is collected as a full path array (root to leaf) for alert display
- **A-006**: JSON schema validation is preferred over runtime validation for structural checks (empty arrays)
- **A-007**: The system uses recursive evaluation for nested composite matchers
- **A-008**: First-match-wins semantics for OR logic aligns with existing inventory matching behavior

## Dependencies

- **D-001**: Zod schema updates for inventory validation
- **D-002**: Matcher interface extensions to support composite matcher types
- **D-003**: Comparison service updates to evaluate composite matcher logic
- **D-004**: Existing unit tests for matcher system must pass after changes
- **D-005**: Migration path for existing inventory entries (if needed - though backward compatibility suggests none required)

## Out of Scope

- **OOS-001**: Graphical UI for composing complex matcher trees (command-line/JSON editing is sufficient)
- **OOS-002**: Hard enforcement of maximum nesting depth - system allows unlimited depth with natural performance boundaries
- **OOS-003**: Automatic simplification or unwrapping of single-child composite matchers (they are valid and evaluate normally)
- **OOS-004**: Support for NOT logic or other boolean operators beyond AND/OR
- **OOS-005**: Backward migration from composite matchers to simple matchers
- **OOS-006**: Visual debugging tools for composite matcher evaluation
