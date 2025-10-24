# Data Model: Composite Matchers with Nested Authorization

**Feature**: 005-enhance-the-schema
**Date**: 2025-10-22
**Status**: Draft

## Overview

This document defines the data model for composite matchers (OR/AND logic) with nested authorization metadata. The model extends the existing matcher system to support recursive composition while maintaining backward compatibility.

---

## Core Entities

### 1. Matchable (Interface) - NEW

**Description**: Generic interface for matchable resources (scripts and headers). Provides common structure for matcher operations.

**Implementation**: `src/types/matcher/matcher.interface.ts` (NEW)

**Fields**:

| Field     | Type                      | Description                                      | Validation                                  |
| --------- | ------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `name`    | `string`                  | Resource name (script URL or header name)        | Required                                    |
| `content` | `string \| null`          | Resource content (script source or header value) | May be null (fail-secure handling required) |
| `hash`    | `SHA256Hash \| undefined` | Optional cryptographic hash (scripts only)       | Optional; undefined for headers             |

**Relationships**:

- Extended by: `DetectedScript` (with required hash)
- Used by: `Matcher<T extends Matchable>`

**State Transitions**: N/A (immutable value object)

**Validation Rules**:

- `name` must be non-empty string for successful identification
- `content` may be null; matchers handle null content as fail-secure (unauthorized)
- `hash` is optional; only present for scripts, undefined for headers

**Design Rationale**:

- **Type Safety**: Eliminates `hash: '' as unknown as SHA256Hash` workaround in header comparison
- **Explicit Contract**: Makes it clear matchers work on any matchable resource (scripts or headers)
- **Backward Compatible**: `DetectedScript` extends `Matchable` with required `hash` field

---

### 2. DetectedScript (Type) - MODIFIED

**Description**: Matchable resource representing a detected script with required hash.

**Implementation**: `src/types/matcher/matcher.interface.ts` (MODIFY)

**Definition**:

```typescript
export type DetectedScript = Matchable & {
  hash: SHA256Hash // Required for scripts (not optional)
}
```

**Relationships**:

- Extends: `Matchable`
- Used by: `ScriptComparisonService`, `HashMatcher`

**Backward Compatibility**: ✅ Existing code continues to work; `DetectedScript` is now a specialization of `Matchable`

---

### 3. Matcher (Interface) - MODIFIED

**Description**: Generic base interface for all matcher types (leaf and composite). Uses generic type parameter to work with any `Matchable` resource.

**Implementation**: `src/types/matcher/matcher.interface.ts` (MODIFY)

**Type Parameter**:

- `T extends Matchable = Matchable`: Generic matchable resource type (defaults to `Matchable`)

**Methods**:

| Method                   | Return Type                                                       | Description                                          |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `getType()`              | `'name' \| 'header-name' \| 'content' \| 'hash' \| 'or' \| 'and'` | Discriminator for matcher type                       |
| `getPattern()`           | `string \| InventoryScriptHashInfo[] \| Matcher[]`                | Returns matcher pattern or child matchers            |
| `identify(resource: T)`  | `boolean`                                                         | Returns true if this matcher applies to the resource |
| `authorize(resource: T)` | `AuthorizationResult`                                             | Returns authorization decision with metadata path    |

**Relationships**:

- Implemented by: `NameMatcher`, `HeaderNameMatcher`, `ContentMatcher`, `HashMatcher`, `OrMatcher<T>`, `AndMatcher<T>`

**State Transitions**: N/A (stateless)

**Validation Rules**:

- All implementations must provide type-safe `getType()` discriminator
- `authorize()` must never return authorized for null/empty content (fail-secure)

**Type Safety**:

- Generic matchers (`NameMatcher`, `ContentMatcher`, `HeaderNameMatcher`): `Matcher<Matchable>` (work with any resource)
- Script-specific matchers (`HashMatcher`): `Matcher<DetectedScript>` (require hash field)
- Composite matchers (`OrMatcher<T>`, `AndMatcher<T>`): Generic over `T extends Matchable`

---

### 4. OrMatcher (Composite Matcher) - NEW

**Description**: Generic composite matcher implementing OR logic. Authorizes if ANY child matcher succeeds (first-match-wins semantics). Works with any `Matchable` resource type.

**Implementation**: `src/types/matcher/or-matcher.ts` (NEW)

**Type Parameter**:

- `T extends Matchable = Matchable`: Generic matchable resource type

**Fields**:

| Field               | Type                                      | Description                                 | Validation                              |
| ------------------- | ----------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `children`          | `Matcher<T>[]`                            | Array of child matchers operating on type T | Min length: 1 (enforced by constructor) |
| `authorisationInfo` | `InventoryAuthorisationInfo \| undefined` | Optional top-level authorization metadata   | Standard authorization info schema      |

**Relationships**:

- Implements: `Matcher<T>`
- Contains: `Matcher<T>[]` (recursive - can contain other `OrMatcher<T>` or `AndMatcher<T>` instances)
- References: `InventoryAuthorisationInfo`

**State Transitions**: N/A (stateless)

**Validation Rules**:

- **FR-008**: Children array must contain at least 1 element (enforced at construction)
- **FR-001**: Authorization succeeds if ANY child matcher succeeds
- **FR-013**: First-match-wins evaluation order (short-circuit on first success)
- **FR-004**: Top-level `authorisationInfo.authorised` overrides child authorization decisions (if matchers match)
- **FR-011**: `authorisationInfo.authorised: false` always denies regardless of child results
- **FR-012**: Empty children array triggers constructor error (fail-secure)

**Behavior**:

1. Constructor validates children array is non-empty
2. `identify()` returns true if ANY child identifies the script
3. `authorize()` finds first matching child and delegates authorization
4. If top-level `authorisationInfo` present, its `authorised` value takes precedence
5. Returns `AuthorizationResult` with metadata path from root to leaf

---

### 5. AndMatcher (Composite Matcher) - NEW

**Description**: Generic composite matcher implementing AND logic. Authorizes only if ALL child matchers succeed. Works with any `Matchable` resource type.

**Implementation**: `src/types/matcher/and-matcher.ts` (NEW)

**Type Parameter**:

- `T extends Matchable = Matchable`: Generic matchable resource type

**Fields**:

| Field               | Type                                      | Description                                 | Validation                              |
| ------------------- | ----------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `children`          | `Matcher<T>[]`                            | Array of child matchers operating on type T | Min length: 1 (enforced by constructor) |
| `authorisationInfo` | `InventoryAuthorisationInfo \| undefined` | Optional top-level authorization metadata   | Standard authorization info schema      |

**Relationships**:

- Implements: `Matcher<T>`
- Contains: `Matcher<T>[]` (recursive - can contain other `OrMatcher<T>` or `AndMatcher<T>` instances)
- References: `InventoryAuthorisationInfo`

**State Transitions**: N/A (stateless)

**Validation Rules**:

- **FR-008**: Children array must contain at least 1 element (enforced at construction)
- **FR-002**: Authorization succeeds only if ALL child matchers succeed
- **FR-014**: Short-circuit evaluation (fails on first unsuccessful match)
- **FR-004**: Top-level `authorisationInfo.authorised` overrides child authorization decisions (if matchers match)
- **FR-011**: `authorisationInfo.authorised: false` always denies regardless of child results
- **FR-012**: Empty children array triggers constructor error (fail-secure)

**Behavior**:

1. Constructor validates children array is non-empty (prevents vacuous truth: `Array.every([]) === true`)
2. `identify()` returns true only if ALL children identify the script
3. `authorize()` evaluates all children in sequence, short-circuits on first failure
4. If top-level `authorisationInfo` present, its `authorised` value takes precedence
5. Returns `AuthorizationResult` with metadata path collected from all evaluated children

---

### 4. AuthorizationResult (Value Object)

**Description**: Result of authorization evaluation containing decision, reason, and metadata path through composite matcher tree.

**Implementation**: `src/types/matcher/authorization-result.ts` (NEW/MODIFY)

**Fields**:

| Field          | Type                                        | Description                                       | Validation                                              |
| -------------- | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `authorized`   | `boolean`                                   | Authorization decision                            | Required                                                |
| `reason`       | `string \| undefined`                       | Explanation when authorization fails              | Optional; present when `authorized === false`           |
| `metadataPath` | `InventoryAuthorisationInfo[] \| undefined` | Array of authorization metadata from root to leaf | Optional; populated during composite traversal (FR-009) |

**Relationships**:

- Returned by: `Matcher.authorize()`
- References: `InventoryAuthorisationInfo[]`

**State Transitions**: N/A (immutable value object)

**Validation Rules**:

- **FR-009**: `metadataPath` must contain full path from root composite to successful leaf
- `reason` should be present when `authorized === false` for audit trail
- `metadataPath` array ordering: root → intermediate → leaf (chronological traversal order)

**Behavior**:

- Composite matchers accumulate metadata by prepending their own `authorisationInfo` to child results
- Leaf matchers return single-element `metadataPath` (or empty if no authorization info)
- Failed authorization includes reason explaining which matcher rejected

---

### 5. InventoryAuthorisationInfo (Value Object)

**Description**: Authorization metadata containing justification, authorization status, and date. Can appear at composite matcher level or on leaf matchers.

**Existing Implementation**: `src/types/inventory/authorisation-info.ts`

**Fields**:

| Field         | Type      | Description                                                         | Validation                    |
| ------------- | --------- | ------------------------------------------------------------------- | ----------------------------- |
| `description` | `string`  | Human-readable justification for authorization decision             | Min length: 1                 |
| `authorised`  | `boolean` | Authorization status (true = authorized, false = explicitly denied) | Required                      |
| `date`        | `string`  | ISO 8601 timestamp of authorization decision                        | Must be valid datetime string |

**Relationships**:

- Referenced by: `OrMatcher`, `AndMatcher`, and all leaf matchers
- Collected in: `AuthorizationResult.metadataPath`

**State Transitions**: N/A (immutable once set in inventory)

**Validation Rules**:

- **FR-003**: Can appear on composite matchers and child matchers
- **FR-004**: Top-level value takes precedence when present on composite matchers
- **FR-011**: `authorised: false` always denies regardless of matcher success
- `date` must be valid ISO 8601 format for audit trail
- `description` must explain the authorization decision for compliance audits

**Enhancement for Composite Matchers**:

- **NEW**: Can now appear at multiple levels in composite matcher tree
- **NEW**: Collected as array path (root to leaf) in `AuthorizationResult`

---

## Inventory Schema Entities

### 6. MatcherConfig (Discriminated Union)

**Description**: JSON schema configuration for matchers. Discriminated union supporting leaf matchers and composite matchers with recursive structure.

**Implementation**: `src/types/inventory/matcher-config-schema.ts` (MODIFY)

**Variants**:

| Variant                   | Discriminator Key   | Fields                                                                            | Description                                       |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `NameMatcherConfig`       | `nameMatcher`       | `{ nameMatcher: string }`                                                         | Matches by script URL pattern                     |
| `HeaderNameMatcherConfig` | `headerNameMatcher` | `{ headerNameMatcher: string }`                                                   | Matches by header name pattern (case-insensitive) |
| `ContentMatcherConfig`    | `contentMatcher`    | `{ contentMatcher: string }`                                                      | Matches by content pattern                        |
| `HashMatcherConfig`       | `hashes`            | `{ hashes: InventoryScriptHashInfo[] }`                                           | Matches by SHA-256 hash                           |
| `OrMatcherConfig`         | `orMatcher`         | `{ orMatcher: MatcherConfig[], authorisationInfo?: InventoryAuthorisationInfo }`  | Composite OR matcher (NEW)                        |
| `AndMatcherConfig`        | `andMatcher`        | `{ andMatcher: MatcherConfig[], authorisationInfo?: InventoryAuthorisationInfo }` | Composite AND matcher (NEW)                       |

**Relationships**:

- Discriminated by: Field names (structural discrimination)
- Recursive: `OrMatcherConfig` and `AndMatcherConfig` contain `MatcherConfig[]`
- Validated by: Zod schema with `z.lazy()` for recursive definitions

**Validation Rules**:

- Exactly one discriminator field must be present
- **FR-008**: Composite matcher arrays must have min length 1
- **FR-010**: All existing matcher types supported as children in composites
- Recursive validation ensures nested composites are valid
- Schema validates before persistence to Git inventory

**JSON Schema Pattern**:

```typescript
// Zod Schema (using z.lazy for recursion)
const MatcherConfigSchema = z.union([
  NameMatcherConfigSchema,
  HeaderNameMatcherConfigSchema,
  ContentMatcherConfigSchema,
  HashMatcherConfigSchema,
  OrMatcherConfigSchema, // Contains z.lazy(() => z.array(MatcherConfigSchema))
  AndMatcherConfigSchema, // Contains z.lazy(() => z.array(MatcherConfigSchema))
])
```

---

### 7. AuthorizeWithConfig (Enhanced)

**Description**: Configuration for authorization matcher in inventory entries. Supports single matcher or array syntax (syntactic sugar for OR).

**Implementation**: `src/types/inventory/zod.ts` (MODIFY)

**Fields**:

| Field               | Type                         | Description                  | Validation                            |
| ------------------- | ---------------------------- | ---------------------------- | ------------------------------------- |
| `matcher`           | `Matcher`                    | Constructed matcher instance | Created via `createMatcher()` factory |
| `authorisationInfo` | `InventoryAuthorisationInfo` | Authorization metadata       | Required (existing field)             |

**Relationships**:

- Contains: `Matcher` (can be leaf or composite)
- References: `InventoryAuthorisationInfo`

**State Transitions**: N/A (constructed from JSON at inventory load)

**Validation Rules**:

- **FR-006**: `authoriseWith` can be an array (converted to `OrMatcher` automatically)
- Array syntax: `authoriseWith: [matcher1, matcher2]` → equivalent to `{ orMatcher: [matcher1, matcher2] }`
- Each array element must have its own `authorisationInfo`

**Enhancement**:

```typescript
// NEW: Array syntax support (FR-006)
export const RawAuthorizeWithConfigSchema = z.union([
  // Single matcher (existing)
  z.intersection(MatcherConfigSchema, z.object({ authorisationInfo: InventoryAuthorisationInfoRawSchema })),

  // Array of matchers (NEW - syntactic sugar for OR)
  z.array(z.intersection(MatcherConfigSchema, z.object({ authorisationInfo: InventoryAuthorisationInfoRawSchema }))).min(1),
])
```

---

## Comparison Result Entities (Enhanced)

### 8. AuthorizedScriptFound (Updated)

**Description**: Result indicating script was both identified and authorized. Enhanced to include authorization metadata path.

**Implementation**: `src/types/comparison/authorized-script-found.ts` (MODIFY)

**Fields**:

| Field            | Type                           | Description                               | Validation   |
| ---------------- | ------------------------------ | ----------------------------------------- | ------------ |
| `type`           | `'AuthorizedScriptFound'`      | Discriminator                             | Literal type |
| `script`         | `DetectedScript`               | The authorized script                     | Required     |
| `inventoryEntry` | `InventoryEntry`               | Matching inventory entry                  | Required     |
| `metadataPath`   | `InventoryAuthorisationInfo[]` | NEW: Authorization path from root to leaf | FR-009       |

**Enhancement**: Add `metadataPath` field for composite matcher context in alerts.

---

### 9. KnownScriptWithUnauthorisedContentFound (Updated)

**Description**: Result indicating script was identified but authorization failed. Enhanced to include authorization metadata path and failure details.

**Implementation**: `src/types/comparison/known-script-unauthorised-content-found.ts` (MODIFY)

**Fields**:

| Field            | Type                                        | Description                                    | Validation   |
| ---------------- | ------------------------------------------- | ---------------------------------------------- | ------------ |
| `type`           | `'KnownScriptWithUnauthorisedContentFound'` | Discriminator                                  | Literal type |
| `script`         | `DetectedScript`                            | The unauthorized script                        | Required     |
| `inventoryEntry` | `InventoryEntry`                            | Matching inventory entry                       | Required     |
| `reason`         | `string`                                    | Explanation of authorization failure           | Required     |
| `metadataPath`   | `InventoryAuthorisationInfo[]`              | NEW: Partial authorization path (if available) | FR-009       |

**Enhancement**: Add `metadataPath` field to show which composite matchers were evaluated before failure.

---

### 10. AuthorizedHeaderFound (Updated)

**Description**: Result indicating header was both identified and authorized. Enhanced to include authorization metadata path.

**Implementation**: `src/types/comparison/authorized-header-found.ts` (MODIFY)

**Fields**:

| Field            | Type                           | Description                               | Validation   |
| ---------------- | ------------------------------ | ----------------------------------------- | ------------ |
| `type`           | `'AuthorizedHeaderFound'`      | Discriminator                             | Literal type |
| `header`         | `DetectedHeader`               | The authorized header                     | Required     |
| `inventoryEntry` | `InventoryEntry`               | Matching inventory entry                  | Required     |
| `metadataPath`   | `InventoryAuthorisationInfo[]` | NEW: Authorization path from root to leaf | FR-009       |

**Enhancement**: Add `metadataPath` field for composite matcher context in alerts.

---

### 11. KnownHeaderUnauthorisedContentFound (Updated)

**Description**: Result indicating header was identified but authorization failed. Enhanced to include authorization metadata path and failure details.

**Implementation**: `src/types/comparison/known-header-unauthorised-content-found.ts` (MODIFY)

**Fields**:

| Field            | Type                                    | Description                                    | Validation   |
| ---------------- | --------------------------------------- | ---------------------------------------------- | ------------ |
| `type`           | `'KnownHeaderUnauthorisedContentFound'` | Discriminator                                  | Literal type |
| `header`         | `DetectedHeader`                        | The unauthorized header                        | Required     |
| `inventoryEntry` | `InventoryEntry`                        | Matching inventory entry                       | Required     |
| `reason`         | `string`                                | Explanation of authorization failure           | Required     |
| `metadataPath`   | `InventoryAuthorisationInfo[]`          | NEW: Partial authorization path (if available) | FR-009       |

**Enhancement**: Add `metadataPath` field to show which composite matchers were evaluated before failure.

---

## Entity Relationship Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                         Matcher                                │
│  (Interface)                                                   │
│  + getType(): 'name' | 'header-name' | ... | 'or' | 'and'     │
│  + identify(script): boolean                                   │
│  + authorize(script): AuthorizationResult                      │
└────────────────────────────────────────────────────────────────┘
                            △
                            │ implements
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────┴────────┐  ┌──────┴──────┐  ┌─────────┴─────────┐
│  NameMatcher   │  │ OrMatcher   │  │   AndMatcher      │
│  (Leaf)        │  │ (Composite) │  │   (Composite)     │
└────────────────┘  └─────────────┘  └───────────────────┘
                           │                    │
                           │ contains           │ contains
                           │ (recursive)        │ (recursive)
                           ├────────────────────┤
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐      ┌─────────────┐
                    │  Matcher[]  │      │  Matcher[]  │
                    └─────────────┘      └─────────────┘
                           │
                           │ references
                           ▼
                 ┌──────────────────────────┐
                 │ InventoryAuthorisationInfo│
                 │  + description: string    │
                 │  + authorised: boolean    │
                 │  + date: string           │
                 └──────────────────────────┘
                           │
                           │ collected in
                           ▼
                 ┌──────────────────────────┐
                 │  AuthorizationResult     │
                 │  + authorized: boolean   │
                 │  + reason?: string       │
                 │  + metadataPath?: Info[] │
                 └──────────────────────────┘
                           │
                           │ used in
                           ▼
         ┌─────────────────────────────────────────┐
         │  AuthorizedScriptFound /                │
         │  KnownScriptWithUnauthorisedContentFound│
         │  (Enhanced with metadataPath)           │
         └─────────────────────────────────────────┘
```

---

## JSON Schema Examples

### Example 1: Simple OR Matcher (Array Syntax)

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": [
    {
      "contentMatcher": "default-src.*self",
      "authorisationInfo": {
        "description": "Strict CSP policy",
        "authorised": true,
        "date": "2025-10-22T12:00:00.000Z"
      }
    },
    {
      "contentMatcher": "default-src.*unsafe-inline",
      "authorisationInfo": {
        "description": "Legacy CSP policy (migration period)",
        "authorised": true,
        "date": "2025-10-22T12:00:00.000Z"
      }
    }
  ]
}
```

**Semantics**: Authorize if content matches EITHER "self" directive OR "unsafe-inline" directive.

---

### Example 2: AND Matcher with Multiple Required Directives

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "andMatcher": [{ "contentMatcher": "default-src" }, { "contentMatcher": "script-src" }, { "contentMatcher": "connect-src" }],
    "authorisationInfo": {
      "description": "Complete CSP policy with all required directives",
      "authorised": true,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

**Semantics**: Authorize only if content contains ALL three directives (default-src AND script-src AND connect-src).

---

### Example 3: Nested Composite - OR containing AND

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "orMatcher": [
      {
        "andMatcher": [{ "contentMatcher": "default-src.*self" }, { "contentMatcher": "script-src.*nonce-" }],
        "authorisationInfo": {
          "description": "Strict CSP with nonce-based scripts",
          "authorised": true,
          "date": "2025-10-22T12:00:00.000Z"
        }
      },
      {
        "andMatcher": [{ "contentMatcher": "default-src.*unsafe-inline" }, { "contentMatcher": "report-uri" }],
        "authorisationInfo": {
          "description": "Legacy CSP with reporting enabled",
          "authorised": true,
          "date": "2025-10-22T12:00:00.000Z"
        }
      }
    ],
    "authorisationInfo": {
      "description": "CSP policy - either strict or legacy with reporting",
      "authorised": true,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

**Semantics**: Authorize if EITHER:

- (default-src with 'self' AND script-src with nonce), OR
- (default-src with 'unsafe-inline' AND report-uri present)

**Metadata Path**: When second AND matcher succeeds, path would be:

```json
[
  { "description": "CSP policy - either strict or legacy with reporting", ... },
  { "description": "Legacy CSP with reporting enabled", ... }
]
```

---

### Example 4: Top-Level Authorization Override (Explicit Denial)

```json
{
  "identifyWith": { "headerNameMatcher": "^x-deprecated-header$" },
  "authoriseWith": {
    "contentMatcher": ".*",
    "authorisationInfo": {
      "description": "This header is deprecated and should not be used",
      "authorised": false,
      "date": "2025-10-22T12:00:00.000Z"
    }
  }
}
```

**Semantics**: Even if content matches the pattern, authorization is denied because `authorised: false`.

---

## Validation Summary

### Structural Validation (Zod Schema)

- ✅ Composite matcher arrays must have min length 1 (FR-008)
- ✅ Authorization info must have required fields (description, authorised, date)
- ✅ Recursive validation of nested composites
- ✅ Date fields must be valid ISO 8601 format
- ✅ Discriminated union ensures exactly one matcher type per config

### Runtime Validation (Constructors)

- ✅ Empty array rejection (prevents vacuous truth scenarios)
- ✅ Null/undefined child array rejection
- ✅ Fail-fast on invalid configuration

### Authorization Logic Validation

- ✅ Null/empty content triggers unauthorized result (fail-secure)
- ✅ Top-level `authorised: false` always denies (FR-011)
- ✅ First-match-wins for OR matchers (FR-013)
- ✅ Short-circuit evaluation for AND matchers (FR-014)
- ✅ Metadata path collection from root to leaf (FR-009)

---

## Migration Path

### Backward Compatibility

✅ **100% Compatible** - No changes required to existing inventory entries:

- Leaf matchers (NameMatcher, ContentMatcher, HashMatcher, HeaderNameMatcher) remain unchanged
- Existing `authoriseWith` single matcher configurations work identically
- Schema validation is additive (union expands to include composites)

### New Features Available

- **NEW**: Composite matchers (OR/AND logic)
- **NEW**: Nested composite matcher trees
- **NEW**: Array syntax for OR (syntactic sugar)
- **NEW**: Authorization metadata paths in comparison results
- **NEW**: Top-level authorization override capability

### Example Migration

**Before** (existing single matcher):

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "contentMatcher": "default-src.*self",
    "authorisationInfo": { ... }
  }
}
```

**After** (enhanced with AND logic):

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "andMatcher": [
      { "contentMatcher": "default-src.*self" },
      { "contentMatcher": "script-src.*nonce-" }
    ],
    "authorisationInfo": { ... }
  }
}
```

**Migration Strategy**: Wrap existing matcher in composite matcher array without changing its logic.
