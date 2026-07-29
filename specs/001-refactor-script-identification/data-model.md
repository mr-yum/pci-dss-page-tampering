# Data Model: Script Identification and Authorisation Refactor

**Date**: 2025-10-15
**Feature**: Script Identification and Authorisation Refactor
**Branch**: 001-refactor-script-identification

## Overview

This document defines the data structures for the refactored matcher system, typed comparison results, and updated inventory schema.

---

## Core Entities

### 1. Matcher (Abstract Interface)

**Purpose**: Strategy interface for script matching operations (identification and authorization).

**Fields**:

- `type`: `'name' | 'content' | 'hash'` - Discriminator for matcher type
- `identify(script: DetectedScript): boolean` - Returns true if script matches identification criteria
- `authorize(script: DetectedScript): AuthorizationResult` - Returns authorization result with reason if failed
- `getPattern(): string | Hash[]` - Returns pattern/hashes for logging and debugging

**Validation Rules**:

- Matcher instances are immutable once created
- Pattern validation occurs at Zod schema level (not in matcher constructor)

**Relationships**:

- Created from `MatcherConfig` in inventory schema
- Used by `ScriptComparisonService` for identification and authorization

---

### 2. NameMatcher (Concrete Implementation)

**Purpose**: Matches scripts by name/URL using regex patterns.

**Fields**:

- `pattern`: `RegExp` - Compiled regex pattern
- `type`: `'name'` (constant)

**Behavior**:

- `identify()`: Tests `script.name` against pattern
- `authorize()`: Tests `script.content` against pattern (same pattern used for both in this implementation)
- Returns `false` for null/undefined script names

**Use Cases**:

- External scripts with dynamic query parameters: `^https://example.com/script.js\?.*$`
- Scripts with versioned URLs: `^https://cdn.example.com/v[0-9]+/script.js$`

---

### 3. ContentMatcher (Concrete Implementation)

**Purpose**: Matches scripts by content using regex patterns.

**Fields**:

- `pattern`: `RegExp` - Compiled regex pattern
- `type`: `'content'` (constant)

**Behavior**:

- `identify()`: Tests `script.content` against pattern
- `authorize()`: Tests `script.content` against pattern
- Returns `false` for null/empty content (triggers UnknownScriptFound per clarification Q3)

**Use Cases**:

- Inline scripts with identifying code snippets: `fbq\('init',`
- Scripts with specific structure: `__NEXT_DATA__`

---

### 4. HashMatcher (Concrete Implementation)

**Purpose**: Matches scripts by cryptographic hash (SHA-256).

**Fields**:

- `authorizedHashes`: `Hash[]` - Array of authorized hash values with timestamps
- `type`: `'hash'` (constant)

**Behavior**:

- `identify()`: Checks the script's pre-computed hash against `authorizedHashes`.
  This supports exact-version identity, although inventory entries conventionally
  identify by stable name/content/provenance so changed bytes remain a known
  script with unauthorized content.
- `authorize()`: Computes SHA-256 hash of `script.content`, checks if in `authorizedHashes` array
- Returns `false` for null/empty content (cannot compute hash)

**Use Cases**:

- Strict integrity verification for external scripts
- Tracking hash history for scripts that change over time

**Validation Rules**:

- `authorizedHashes` array must contain at least 1 hash
- Each hash must have `value` (hex string) and `timestamp` (ISO 8601)

---

## Comparison Result Entities

### 5. ComparisonResult (Abstract Base)

**Purpose**: Base class for all comparison results, provides common context.

**Fields**:

- `type`: `string` - Discriminator for result type (subclass-specific)
- `target`: `Target` - Target being processed (inventory or detection URL)
- `timestamp`: `Date` - When comparison occurred

**Relationships**:

- Extended by `UnknownScriptFound`, `KnownScriptWithUnauthorisedContentFound`, `AuthorizedScriptFound`
- Consumed by alert handlers

---

### 6. UnknownScriptFound (Concrete Result)

**Purpose**: Indicates a detected script with no matching inventory entry.

**Fields**:

- `type`: `'unknown_script_found'` (constant)
- `script`: `DetectedScript` - Full script details (name, content, hash)
- `target`: `Target` (inherited)
- `timestamp`: `Date` (inherited)

**Alert Mapping**:

- Inventory workflow → `newScriptIdentified` alert
- Detection workflow → `newScriptDetected` alert

**Triggers**:

- No inventory entry matches via `identifyWith` matcher
- Detected script has null/empty content (per clarification Q3)

---

### 7. KnownScriptWithUnauthorisedContentFound (Concrete Result)

**Purpose**: Indicates a script matched by identification but failed authorization.

**Fields**:

- `type`: `'known_script_unauthorised_content'` (constant)
- `script`: `DetectedScript` - Full script details
- `inventoryEntry`: `ScriptInventoryEntry` - Matched inventory entry
- `authorizationMatcher`: `Matcher` - The matcher that failed authorization
- `failureReason`: `string` - Human-readable explanation (e.g., "content does not match pattern", "hash not in authorized list")
- `target`: `Target` (inherited)
- `timestamp`: `Date` (inherited)

**Alert Mapping**:

- Detection workflow → `scriptMismatchDetected` alert

**Triggers**:

- Script identified by `identifyWith` matcher
- Same script fails `authoriseWith` matcher

---

### 8. AuthorizedScriptFound (Concrete Result)

**Purpose**: Indicates a script that is both identified and authorized.

**Fields**:

- `type`: `'authorized_script'` (constant)
- `script`: `DetectedScript` - Full script details
- `inventoryEntry`: `ScriptInventoryEntry` - Matched inventory entry
- `target`: `Target` (inherited)
- `timestamp`: `Date` (inherited)

**Alert Mapping**:

- No alert generated (compliant script)

**Triggers**:

- Script identified by `identifyWith` matcher
- Same script passes `authoriseWith` matcher

---

## Inventory Schema Entities

### 9. MatcherConfig (Union Type)

**Purpose**: Configuration for a single matcher in inventory JSON.

**Variants**:

```typescript
type MatcherConfig =
  | { nameMatcher: string } // Regex pattern for name matching
  | { contentMatcher: string } // Regex pattern for content matching
  | { hashes: Hash[] } // Array of authorized hashes
```

**Validation Rules** (Zod schema):

- Exactly one property must be present (enforced by union)
- `nameMatcher` and `contentMatcher` must be valid regex (custom refinement)
- `hashes` array must have at least 1 element
- Regex validation provides detailed error messages (per research R6)

**Example**:

```json
{
  "nameMatcher": "^https:\\/\\/example\\.com\\/script\\.js\\?.*$"
}
```

---

### 10. ScriptInventoryEntry (Updated Schema)

**Purpose**: Defines how to identify and authorize a single script.

**Fields**:

- `identifyWith`: `MatcherConfig` - How to identify this script among detected scripts
- `authoriseWith`: `MatcherConfig` - How to authorize this script's content
- `authorisationInfo`: `AuthorisationInfo` - Metadata (description, authorized flag, date)

**Validation Rules**:

- `identifyWith` and `authoriseWith` can use the same matcher type (per clarification Q5)
- Both fields are required (no defaults)
- Old schema format (without these fields) is rejected (per clarification Q4)

**Example**:

```json
{
  "identifyWith": {
    "nameMatcher": "^https:\\/\\/cdn\\.example\\.com\\/.*$"
  },
  "authoriseWith": {
    "hashes": [
      {
        "timestamp": "2025-10-15T00:00:00.000Z",
        "hash": { "value": "abc123..." }
      }
    ]
  },
  "authorisationInfo": {
    "description": "Example CDN script",
    "authorised": true,
    "date": "2025-10-15T00:00:00.000Z"
  }
}
```

---

### 11. Hash (Existing, Unchanged)

**Purpose**: Represents a cryptographic hash with timestamp.

**Fields**:

- `value`: `string` - SHA-256 hash in hexadecimal format (64 characters)
- `timestamp`: `string` - ISO 8601 timestamp when hash was recorded

**Validation Rules**:

- `value` must be 64-character hex string
- `timestamp` must be valid ISO 8601 date string

---

### 12. AuthorisationInfo (Existing, Unchanged)

**Purpose**: Metadata about script authorization.

**Fields**:

- `description`: `string` - Human-readable description of script purpose
- `authorised`: `boolean` - Whether script is authorized (legacy field, always true in practice)
- `date`: `string` - ISO 8601 timestamp when script was authorized

---

### 13. DetectedScript (Existing, Minor Update)

**Purpose**: Represents a script detected during workflow execution.

**Fields**:

- `name`: `string` - URL for external scripts, identifier for inline scripts
- `content`: `string | null` - Script source code (null if fetch failed)
- `hash`: `string` - SHA-256 hash of content (computed on detection)
- `context`: `{ target: Target, workflowStep: string }` - Where script was found

**Updates for Refactoring**:

- No schema changes
- Null `content` now triggers `UnknownScriptFound` (per clarification Q3)

---

## Data Flow

### Identification Flow

```
DetectedScript
  ↓
Iterate inventory.scripts array (in order)
  ↓
For each ScriptInventoryEntry:
  ↓
Create Matcher from identifyWith config
  ↓
matcher.identify(script) → boolean
  ↓
First true result → matched entry (first-match-wins)
  ↓
No matches → UnknownScriptFound
```

### Authorization Flow

```
Matched ScriptInventoryEntry
  ↓
Create Matcher from authoriseWith config
  ↓
matcher.authorize(script) → AuthorizationResult
  ↓
If authorized: AuthorizedScriptFound
If not authorized: KnownScriptWithUnauthorisedContentFound
  (includes failureReason from AuthorizationResult)
```

### Comparison Service Output

```
Array<ComparisonResult>
  ↓
Handlers iterate results
  ↓
Switch on result.type
  ↓
Generate alerts with full context (no additional queries needed)
```

---

## Entity Relationships

```
MatcherConfig (JSON)
  ↓ (parsed by Zod, creates)
Matcher (NameMatcher | ContentMatcher | HashMatcher)
  ↓ (used by)
ScriptComparisonService
  ↓ (produces)
ComparisonResult (UnknownScriptFound | KnownScriptWithUnauthorisedContentFound | AuthorizedScriptFound)
  ↓ (consumed by)
Alert Handlers
```

```
Inventory (JSON file in Git)
  ↓ (contains)
ScriptInventoryEntry[]
  ↓ (each has)
identifyWith: MatcherConfig
authoriseWith: MatcherConfig
authorisationInfo: AuthorisationInfo
```

---

## State Transitions

### Script Processing States

```
[Detected] → (identification) → [Identified | Unknown]
                                       ↓
                              (authorization)
                                       ↓
                              [Authorized | Unauthorized]
```

**State Definitions**:

- **Detected**: Script captured by Puppeteer, hash computed
- **Identified**: Script matched by `identifyWith` matcher
- **Unknown**: No inventory entry matched script
- **Authorized**: Script passed `authoriseWith` matcher
- **Unauthorized**: Script failed `authoriseWith` matcher

**Terminal States** (produce ComparisonResult):

- **Unknown** → `UnknownScriptFound`
- **Authorized** → `AuthorizedScriptFound`
- **Unauthorized** → `KnownScriptWithUnauthorisedContentFound`

---

## Validation Summary

| Entity                  | Validation Location         | Rules                                                  |
| ----------------------- | --------------------------- | ------------------------------------------------------ |
| MatcherConfig           | Zod schema (inventory load) | Valid regex syntax, non-empty patterns, min 1 hash     |
| ScriptInventoryEntry    | Zod schema (inventory load) | Required fields, matcher config validation             |
| Matcher implementations | Runtime (constructor)       | Pattern must be RegExp, hashes must be non-empty array |
| ComparisonResult        | TypeScript type system      | Type discriminator enforced at compile time            |
| DetectedScript          | Runtime (detection service) | Null content triggers UnknownScriptFound               |

---

## Migration Impact

### Old Schema → New Schema

**Old Format** (no longer supported):

```json
{
  "matcher": { "nameMatcher": "..." },
  "hashes": [...]
}
```

**New Format** (required):

```json
{
  "identifyWith": { "nameMatcher": "..." },
  "authoriseWith": { "hashes": [...] }
}
```

**Migration Steps** (see quickstart.md for details):

1. For each old entry, determine identification strategy (usually `nameMatcher`)
2. Determine authorization strategy (usually `hashes` if present, else `contentMatcher`)
3. Create `identifyWith` and `authoriseWith` objects
4. Validate with Zod schema
5. Test against staging target before deploying

---

## Summary

- **3 Matcher Implementations**: NameMatcher, ContentMatcher, HashMatcher
- **3 Comparison Result Types**: UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, AuthorizedScriptFound
- **Updated Inventory Schema**: Requires `identifyWith` and `authoriseWith` for each script entry
- **First-Match-Wins**: Enforced by array iteration order
- **Fail-Secure**: Null/empty content → UnknownScriptFound
- **Regex Validation**: Detailed error messages at schema load time
