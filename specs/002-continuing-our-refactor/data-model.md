# Data Model: Header Comparison and Alert Refactor

**Feature Branch**: `002-continuing-our-refactor`
**Date**: 2025-10-17
**Phase**: 1 (Design & Contracts)

## Overview

This document defines the core entities, their relationships, and validation rules for the header comparison and alert refactor. All entities follow the typed comparison result pattern established for scripts.

---

## Entity Definitions

### E1: UnknownHeaderFound

**Purpose**: Represents a detected header with no matching inventory entry.

**Properties:**

| Property  | Type                     | Required | Validation          | Description                        |
| --------- | ------------------------ | -------- | ------------------- | ---------------------------------- |
| type      | `"unknown_header_found"` | Yes      | Literal string      | Discriminator for TypeScript union |
| target    | Target                   | Yes      | Valid Target object | The target being processed         |
| timestamp | Date                     | Yes      | Valid Date          | When the comparison occurred (UTC) |
| header    | DetectedHeader           | Yes      | Non-null object     | Full details of the unknown header |

**Relationships:**

- Extends: ComparisonResult (inherits target, timestamp)
- Contains: DetectedHeader (composition)

**Validation Rules:**

- `type` must be the literal string `"unknown_header_found"`
- `target` must be a valid Target with both inventoryUrl and detectionUrl
- `timestamp` must be a valid Date object
- `header.name` must be non-empty string
- `header.values` must be non-empty Set<string>

**State Transitions:**

- Created by HeaderComparisonService when no inventory entry matches
- Immutable after creation (all properties readonly)
- Passed to alert handler for workflow-appropriate alert

**Triggers:**

- No inventory entry's identifyWith matcher returns true for header name
- Header has null/empty value set (fail-secure behavior per R7)

**Alert Mapping:**

- Inventory workflow → `new_inventory_header_identified`
- Detection workflow → `uninventoried_header_detected`

---

### E2: KnownHeaderWithUnauthorisedContentFound

**Purpose**: Represents a header identified by inventory but with unauthorized value(s). Critical security event indicating potential tampering.

**Properties:**

| Property             | Type                                  | Required | Validation             | Description                                            |
| -------------------- | ------------------------------------- | -------- | ---------------------- | ------------------------------------------------------ |
| type                 | `"known_header_unauthorised_content"` | Yes      | Literal string         | Discriminator for TypeScript union                     |
| target               | Target                                | Yes      | Valid Target object    | The target being processed                             |
| timestamp            | Date                                  | Yes      | Valid Date             | When the comparison occurred (UTC)                     |
| header               | DetectedHeader                        | Yes      | Non-null object        | Full details of the detected header                    |
| inventoryEntry       | InventoryHeaderInfo                   | Yes      | Non-null object        | Inventory entry that identified this header            |
| authorizationMatcher | Matcher                               | Yes      | Valid Matcher instance | The matcher that failed authorization                  |
| failureReason        | string                                | Yes      | Non-empty string       | Human-readable explanation of why authorization failed |

**Relationships:**

- Extends: ComparisonResult (inherits target, timestamp)
- Contains: DetectedHeader (composition)
- References: InventoryHeaderInfo (inventory entry that matched)
- References: Matcher (specific matcher that failed)

**Validation Rules:**

- `type` must be the literal string `"known_header_unauthorised_content"`
- `target` must be a valid Target
- `timestamp` must be a valid Date
- `header.name` must match `inventoryEntry.identifyWith` pattern
- `inventoryEntry.authorisationInfo.authorised` must be true
- `authorizationMatcher` must be the same instance as `inventoryEntry.authoriseWith`
- `failureReason` must be non-empty (e.g., "value does not match pattern")

**State Transitions:**

- Created when identifyWith matcher succeeds but authoriseWith matcher fails
- Immutable after creation
- Passed to alert handler for critical security alert

**Triggers:**

- Header name matches inventory entry's identifyWith matcher (case-insensitive)
- Same header's value fails inventory entry's authoriseWith matcher (case-sensitive)
- One result generated per unauthorized value (multiple values = multiple results)

**Alert Mapping:**

- Detection workflow → `mismatched_header_detected`
- Inventory workflow → Should not occur (inventory updates baseline)

---

### E3: AuthorizedHeaderFound

**Purpose**: Represents a header that is both identified and authorized. Indicates compliance, no alert generated.

**Properties:**

| Property       | Type                  | Required | Validation          | Description                                 |
| -------------- | --------------------- | -------- | ------------------- | ------------------------------------------- |
| type           | `"authorized_header"` | Yes      | Literal string      | Discriminator for TypeScript union          |
| target         | Target                | Yes      | Valid Target object | The target being processed                  |
| timestamp      | Date                  | Yes      | Valid Date          | When the comparison occurred (UTC)          |
| header         | DetectedHeader        | Yes      | Non-null object     | Full details of the authorized header       |
| inventoryEntry | InventoryHeaderInfo   | Yes      | Non-null object     | Inventory entry that matched and authorized |

**Relationships:**

- Extends: ComparisonResult (inherits target, timestamp)
- Contains: DetectedHeader (composition)
- References: InventoryHeaderInfo (inventory entry that authorized)

**Validation Rules:**

- `type` must be the literal string `"authorized_header"`
- `target` must be a valid Target
- `timestamp` must be a valid Date
- `header.name` must match `inventoryEntry.identifyWith` pattern (case-insensitive)
- `header.value` must match `inventoryEntry.authoriseWith` pattern (case-sensitive)
- `inventoryEntry.authorisationInfo.authorised` must be true

**State Transitions:**

- Created when both identifyWith and authoriseWith matchers succeed
- Immutable after creation
- Passed to alert handler (no alert generated)

**Triggers:**

- Header name matches inventory entry's identifyWith matcher
- Same header's value matches inventory entry's authoriseWith matcher
- One result per authorized value (header with 3 values = 3 separate results)

**Alert Mapping:**

- No alert (compliant header)

---

### E4: DetectedHeader

**Purpose**: Represents a single header name-value pair detected during workflow execution.

**Properties:**

| Property | Type   | Required | Validation                     | Description                                   |
| -------- | ------ | -------- | ------------------------------ | --------------------------------------------- |
| name     | string | Yes      | Non-empty string               | Header name (e.g., "Content-Security-Policy") |
| value    | string | Yes      | Non-null string (may be empty) | Single header value being evaluated           |
| target   | Target | Yes      | Valid Target object            | Target where header was detected              |
| workflow | string | Yes      | Non-empty string               | Workflow context (e.g., "checkout")           |

**Relationships:**

- Used by: All header comparison result types
- Created from: HeaderDetectionSummary (one DetectedHeader per name-value pair)

**Validation Rules:**

- `name` must be non-empty string (case-insensitive for matching)
- `value` must be non-null string (empty string `""` is valid per FR-013a)
- `target` must be valid Target object
- `workflow` must be non-empty string

**State Transitions:**

- Created during HeaderComparisonService processing
- Immutable after creation
- Included in comparison result for alert context

**Special Cases:**

- **Empty values**: Valid input, authorization determined by ContentMatcher pattern
- **Multiple values**: Original `Set<string>` expanded to N DetectedHeader instances
- **Case handling**: Name normalized to lowercase for matching, value kept as-is

---

### E5: InventoryHeaderInfo

**Purpose**: Defines how to identify and authorize a header in the inventory. Mirrors InventoryScriptInfo schema.

**Properties:**

| Property          | Type              | Required | Validation              | Description                                |
| ----------------- | ----------------- | -------- | ----------------------- | ------------------------------------------ |
| identifyWith      | Matcher           | Yes      | NameMatcher instance    | Matcher for header name (case-insensitive) |
| authoriseWith     | Matcher           | Yes      | ContentMatcher instance | Matcher for header value (case-sensitive)  |
| authorisationInfo | AuthorisationInfo | Yes      | Valid object            | Justification and audit metadata           |

**Relationships:**

- Used by: Inventory (array of header entries)
- References: Matcher interface implementations (NameMatcher, ContentMatcher)
- Contains: AuthorisationInfo (composition)

**Validation Rules:**

- `identifyWith` must be NameMatcher instance (enforced by Zod schema)
- `authoriseWith` must be ContentMatcher instance (enforced by Zod schema)
- `authorisationInfo.authorised` must be boolean
- `authorisationInfo.justification` must be non-empty string
- `authorisationInfo.authorisedAt` must be valid ISO 8601 date string

**State Transitions:**

- Loaded from Git inventory repository on startup
- Immutable during comparison (read-only)
- Modified only via InventoryService Git commits

**Matcher Constraints:**

- **identifyWith (NameMatcher)**: Pattern matched case-insensitively against header name
- **authoriseWith (ContentMatcher)**: Pattern matched case-sensitively against header value
- HashMatcher not applicable (headers have no cryptographic hash)

**Example:**

```typescript
{
  identifyWith: NameMatcher("^Content-Security-Policy$", "i"),
  authoriseWith: ContentMatcher("^default-src 'self'; script-src 'self'$"),
  authorisationInfo: {
    authorised: true,
    justification: "Approved CSP for payment page",
    authorisedAt: "2025-10-17T12:00:00Z"
  }
}
```

---

### E6: ComparisonResultType (Union)

**Purpose**: Discriminated union of all comparison result types for exhaustive type checking.

**Definition:**

```typescript
type ComparisonResultType = AuthorizedScriptFound | KnownScriptWithUnauthorisedContentFound | UnknownScriptFound | AuthorizedHeaderFound | KnownHeaderWithUnauthorisedContentFound | UnknownHeaderFound
```

**Validation Rules:**

- Each type must have unique `type` discriminator value
- All types must extend ComparisonResult base class
- Switch statements must handle all union members (TypeScript enforces)

**Usage:**

- Alert handler parameter type: `alertForTypedResults(results: ComparisonResultType[])`
- Enables type narrowing in switch statements
- Compile-time exhaustive checking via `never` type

---

### E7: HeaderDetectionSummary

**Purpose**: Results from a workflow execution containing detected headers.

**Properties:**

| Property | Type                          | Required | Validation          | Description                             |
| -------- | ----------------------------- | -------- | ------------------- | --------------------------------------- |
| headers  | Map<HeaderName, HeaderValues> | Yes      | Non-null Map        | Detected headers (name → Set of values) |
| target   | Target                        | Yes      | Valid Target object | Target where headers were detected      |
| workflow | string                        | Yes      | Non-empty string    | Workflow executed (e.g., "checkout")    |

**Relationships:**

- Created by: DetectionService (Puppeteer response handler)
- Consumed by: HeaderComparisonService (expanded to DetectedHeader instances)

**Validation Rules:**

- `headers` must be Map with string keys and Set<string> values
- Each header name must be non-empty string
- Each header values Set must be non-empty (no header = not in Map)
- `target` must be valid Target
- `workflow` must be non-empty string

**State Transitions:**

- Created during Puppeteer workflow execution
- Passed to HeaderComparisonService.compare()
- Expanded: Map entry (name, Set[v1, v2, v3]) → 3 DetectedHeader instances

---

## Entity Relationships Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     ComparisonResult (Base)                     │
│  + target: Target                                               │
│  + timestamp: Date                                              │
│  + type: string (abstract)                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ extends
              ┌───────────────┼───────────────┐
              │               │               │
┌─────────────────────┐ ┌──────────────────────────┐ ┌─────────────────────┐
│ UnknownHeaderFound  │ │ KnownHeaderWith          │ │ AuthorizedHeader    │
│                     │ │ UnauthorisedContentFound │ │ Found               │
│ + header            │ │ + header                 │ │ + header            │
│                     │ │ + inventoryEntry         │ │ + inventoryEntry    │
│                     │ │ + authorizationMatcher   │ │                     │
│                     │ │ + failureReason          │ │                     │
└──────────┬──────────┘ └────────────┬─────────────┘ └──────────┬──────────┘
           │                         │                           │
           │ contains                │ contains                  │ contains
           ▼                         ▼                           ▼
    ┌───────────────────────────────────────────────────────────────┐
    │                     DetectedHeader                            │
    │  + name: string                                               │
    │  + value: string                                              │
    │  + target: Target                                             │
    │  + workflow: string                                           │
    └───────────────────────────────────────────────────────────────┘


    ┌───────────────────────────────────────────────────────────────┐
    │                 InventoryHeaderInfo                           │
    │  + identifyWith: Matcher (NameMatcher)                        │
    │  + authoriseWith: Matcher (ContentMatcher)                    │
    │  + authorisationInfo: AuthorisationInfo                       │
    └───────────────────────────────────────────────────────────────┘
                              ▲
                              │ referenced by
                              │
                   KnownHeader... & AuthorizedHeader...
```

---

## Validation Matrix

| Entity                                  | Null Safety             | Empty String                                     | Case Sensitivity                            | Immutability                |
| --------------------------------------- | ----------------------- | ------------------------------------------------ | ------------------------------------------- | --------------------------- |
| UnknownHeaderFound                      | All properties non-null | header.name non-empty, header.value may be empty | Name case-insensitive                       | All readonly                |
| KnownHeaderWithUnauthorisedContentFound | All properties non-null | failureReason non-empty                          | Name case-insensitive, value case-sensitive | All readonly                |
| AuthorizedHeaderFound                   | All properties non-null | header.name non-empty                            | Name case-insensitive, value case-sensitive | All readonly                |
| DetectedHeader                          | All properties non-null | name non-empty, value may be empty               | Name lowercase normalized, value as-is      | All readonly                |
| InventoryHeaderInfo                     | All properties non-null | justification non-empty                          | Matcher-dependent                           | Read-only during comparison |
| ComparisonResultType                    | Type must be non-null   | Discriminator non-empty                          | Type-specific                               | All readonly                |

---

## Business Rules

### BR-1: Header Value Iteration

When a header has N values, generate N separate comparison results (one per value). Each result evaluates a single name-value pair independently.

**Example:**

```
Input: Content-Security-Policy: ["default-src 'self'", "script-src 'unsafe-inline'"]
Output:
  - Result 1: DetectedHeader { name: "content-security-policy", value: "default-src 'self'" }
  - Result 2: DetectedHeader { name: "content-security-policy", value: "script-src 'unsafe-inline'" }
```

### BR-2: First-Match-Wins Identification

Iterate inventory header entries in array order. Return first entry where `identifyWith.identify(headerName)` returns true. Subsequent matches ignored.

**Example:**

```
Inventory: [
  { identifyWith: NameMatcher("^X-.*$"), ... },
  { identifyWith: NameMatcher("^X-Frame-Options$"), ... }
]
Detected: "X-Frame-Options"
Matched: First entry (^X-.*$) wins, second entry never tested
```

### BR-3: Case-Insensitive Name Matching

Header names are normalized to lowercase before NameMatcher.identify() call. Matcher patterns should use case-insensitive flag `"i"`.

**Example:**

```
Inventory: NameMatcher("^content-security-policy$", "i")
Detected names that match: "Content-Security-Policy", "content-security-policy", "CONTENT-SECURITY-POLICY"
```

### BR-4: Case-Sensitive Value Authorization

Header values are passed to ContentMatcher.authorize() without normalization. Patterns are case-sensitive unless explicitly flagged.

**Example:**

```
Inventory: ContentMatcher("^DENY$")  // No "i" flag
Detected value "DENY": Authorized
Detected value "deny": NOT authorized (case mismatch)
```

### BR-5: Empty Value Handling

Empty string values (`""`) are valid input and compared against inventory patterns. Authorization is determined by whether the empty value matches the ContentMatcher pattern.

**Example:**

```
Inventory: ContentMatcher("^(DENY|SAMEORIGIN|)$")  // Allows empty
Detected: X-Frame-Options: ""
Result: AuthorizedHeaderFound (empty value matches pattern)

Inventory: ContentMatcher("^(DENY|SAMEORIGIN)$")  // Does NOT allow empty
Detected: X-Frame-Options: ""
Result: KnownHeaderWithUnauthorisedContentFound (empty value fails pattern)
```

### BR-6: Alert Routing by Workflow

Alert category depends on workflow context (inventory vs detection):

- **Inventory workflow**: New headers → `new_inventory_header_identified`
- **Detection workflow**: Uninventoried → `uninventoried_header_detected`, Mismatched → `mismatched_header_detected`
- **Authorized headers**: No alert in either workflow

---

## Migration Considerations

### Current Schema → New Schema

**Current InventoryHeaderInfo:**

```typescript
{
  nameMatcher: RegExp,
  contentMatcher: RegExp,
  authorisationInfo: { ... }
}
```

**New InventoryHeaderInfo:**

```typescript
{
  identifyWith: NameMatcher,
  authoriseWith: ContentMatcher,
  authorisationInfo: { ... }
}
```

**Migration Steps:**

1. Read existing inventory JSON
2. For each header entry:
   - Convert `nameMatcher` RegExp → `NameMatcher(pattern, flags)`
   - Convert `contentMatcher` RegExp → `ContentMatcher(pattern, flags)`
3. Validate against new Zod schema
4. Write migrated inventory back to Git
5. Tag migration commit for audit trail

**Validation:**

- Run comparison with both old and new schema against test cases
- Verify identical results for all test scenarios
- Document any behavioral changes (expected: none)

---

## Next Steps

With data model complete, proceed to:

1. Generate TypeScript contracts in `/contracts/`
2. Generate `quickstart.md` for developers
3. Update agent context with new entity definitions
