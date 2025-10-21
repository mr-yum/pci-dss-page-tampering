# Data Model: Schema Enhancement for Nested Authorization Info

**Feature**: Embed Authorization Info in Authorization Entity
**Branch**: 004-enhance-the-schema
**Date**: 2025-10-21

## Overview

This document defines the enhanced data model that nests `authorisationInfo` within the `authoriseWith` entity, creating a cohesive authorization structure. The model includes both runtime TypeScript types and JSON-serializable raw types for persistence.

## Entity Definitions

### Core Authorization Types

#### InventoryAuthorisationInfo

**Purpose**: Metadata about authorization status and justification.

**Location**: `src/types/inventory/model.ts`

**Definition** (unchanged):
```typescript
export type InventoryAuthorisationInfo = {
  description: string      // Human-readable justification for authorization
  authorised: boolean      // Whether the resource is authorized
  date: Date              // Date of authorization decision
}
```

**Validation Rules**:
- `description`: Non-empty string, required
- `authorised`: Boolean, required
- `date`: Valid Date instance, required

**State Transitions**:
- Initial state: `authorised: false`, `description: "NO_DESCRIPTION"` (new script discovery)
- After review: `authorised: true`, `description: <justification>` (manual authorization)

---

#### AuthorizeWithConfig

**Purpose**: Composite structure combining authorization matcher logic with authorization metadata.

**Location**: `src/types/inventory/model.ts` (new type)

**Definition** (new):
```typescript
export type AuthorizeWithConfig = {
  matcher: Matcher                             // How to authorize content
  authorisationInfo: InventoryAuthorisationInfo  // Authorization metadata
}
```

**Validation Rules**:
- `matcher`: Valid Matcher instance (NameMatcher | ContentMatcher | HashMatcher | HeaderNameMatcher)
- `authorisationInfo`: Valid InventoryAuthorisationInfo object

**Relationships**:
- Contains exactly one Matcher instance
- Contains exactly one InventoryAuthorisationInfo instance
- Used in both InventoryScriptInfo and InventoryHeaderInfo

---

### Inventory Entry Types

#### InventoryScriptInfo (Updated)

**Purpose**: Processed inventory script entry with Matcher instances and nested authorization info.

**Location**: `src/types/inventory/model.ts`

**Definition** (updated):
```typescript
export type InventoryScriptInfo = {
  identifyWith: Matcher           // How to identify the script (unchanged)
  authoriseWith: AuthorizeWithConfig  // NEW: Composite authorization structure
}
```

**Changes from Current**:
- **Before**: `authoriseWith: Matcher`, `authorisationInfo: InventoryAuthorisationInfo` (siblings)
- **After**: `authoriseWith: AuthorizeWithConfig` (nested)

**Validation Rules**:
- `identifyWith`: Valid Matcher instance (typically NameMatcher for URL matching or ContentMatcher for inline scripts)
- `authoriseWith`: Valid AuthorizeWithConfig object

**Access Patterns**:
- Identification: `entry.identifyWith.identify(scriptInfo)`
- Authorization: `entry.authoriseWith.matcher.authorize(scriptInfo)`
- Metadata: `entry.authoriseWith.authorisationInfo.authorised`

---

#### InventoryHeaderInfo (Updated)

**Purpose**: Processed inventory header entry with Matcher instances and nested authorization info.

**Location**: `src/types/inventory/model.ts`

**Definition** (updated):
```typescript
export type InventoryHeaderInfo = {
  identifyWith: Matcher           // How to identify the header (unchanged)
  authoriseWith: AuthorizeWithConfig  // NEW: Composite authorization structure
}
```

**Changes from Current**:
- **Before**: `authoriseWith: Matcher`, `authorisationInfo: InventoryAuthorisationInfo` (siblings)
- **After**: `authoriseWith: AuthorizeWithConfig` (nested)

**Validation Rules**:
- `identifyWith`: Valid Matcher instance (typically HeaderNameMatcher for case-insensitive name matching)
- `authoriseWith`: Valid AuthorizeWithConfig object (typically ContentMatcher for header value)

**Access Patterns**:
- Identification: `entry.identifyWith.identify(headerInfo)`
- Authorization: `entry.authoriseWith.matcher.authorize(headerInfo)`
- Metadata: `entry.authoriseWith.authorisationInfo.authorised`

---

### Raw (Serializable) Types

#### RawAuthorizeWithConfig

**Purpose**: JSON-serializable version of AuthorizeWithConfig for persistence.

**Location**: `src/types/inventory/raw.ts` (new type)

**Definition** (new):
```typescript
export type RawAuthorizeWithConfig = RawMatcherConfig & {
  authorisationInfo: {
    description: string
    authorised: boolean
    date: string  // ISO 8601 date string
  }
}
```

**Structure**: Intersection type combining matcher configuration fields (one of: `nameMatcher`, `contentMatcher`, `hashes`, `headerNameMatcher`) with `authorisationInfo` metadata as siblings in the same object.

**Validation Rules** (Zod schema):
- Matcher config fields: Valid RawMatcherConfig (discriminated union - exactly one matcher type present)
- `authorisationInfo.description`: Non-empty string
- `authorisationInfo.authorised`: Boolean
- `authorisationInfo.date`: ISO 8601 date string

**Serialization**:
- Date → ISO 8601 string: `date.toISOString()`
- ISO string → Date: `new Date(dateString)`

---

#### RawInventoryScriptInfo (Updated)

**Purpose**: JSON-serializable version of InventoryScriptInfo.

**Location**: `src/types/inventory/raw.ts`

**Definition** (updated):
```typescript
export type RawInventoryScriptInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig  // NEW: Nested authorization config
}
```

**Changes from Current**:
- **Before**: Inherited `authorisationInfo` as sibling field via Omit
- **After**: `authoriseWith` contains nested `RawAuthorizeWithConfig`

**JSON Structure Example**:
```json
{
  "identifyWith": {
    "nameMatcher": "^https://example\\.com/script\\.js$"
  },
  "authoriseWith": {
    "hashes": [
      {
        "timestamp": "2025-10-21T12:00:00.000Z",
        "hash": "sha256-abc123..."
      }
    ],
    "authorisationInfo": {
      "description": "Analytics script for conversion tracking",
      "authorised": true,
      "date": "2025-10-21T12:00:00.000Z"
    }
  }
}
```

---

#### RawInventoryHeaderInfo (Updated)

**Purpose**: JSON-serializable version of InventoryHeaderInfo.

**Location**: `src/types/inventory/raw.ts`

**Definition** (updated):
```typescript
export type RawInventoryHeaderInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig  // NEW: Nested authorization config
}
```

**Changes from Current**:
- **Before**: Inherited `authorisationInfo` as sibling field via Omit
- **After**: `authoriseWith` contains nested `RawAuthorizeWithConfig`

**JSON Structure Example**:
```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-security-policy$"
  },
  "authoriseWith": {
    "contentMatcher": "^default-src 'self'; script-src 'self' https://trusted\\.example\\.com$",
    "authorisationInfo": {
      "description": "Standard CSP policy for payment pages",
      "authorised": true,
      "date": "2025-10-21T12:00:00.000Z"
    }
  }
}
```

---

## Entity Relationships

```
Inventory
├── scripts: InventoryScriptInfo[]
│   ├── identifyWith: Matcher
│   └── authoriseWith: AuthorizeWithConfig
│       ├── matcher: Matcher
│       └── authorisationInfo: InventoryAuthorisationInfo
│           ├── description: string
│           ├── authorised: boolean
│           └── date: Date
└── headers: InventoryHeaderInfo[]
    ├── identifyWith: Matcher
    └── authoriseWith: AuthorizeWithConfig
        ├── matcher: Matcher
        └── authorisationInfo: InventoryAuthorisationInfo
            ├── description: string
            ├── authorised: boolean
            └── date: Date
```

## Data Validation

### Zod Schemas

#### AuthorizeWithConfigSchema (New)

**Location**: `src/types/inventory/zod.ts` (new schema)

**Definition**:
```typescript
import { z } from 'zod'
import { RawMatcherConfigSchema } from './matcher-config-schema'

const InventoryAuthorisationInfoSchema = z.object({
  description: z.string().min(1),
  authorised: z.boolean(),
  date: z.string().datetime()  // ISO 8601 date string
})

const RawAuthorizeWithConfigSchema = z.intersection(
  RawMatcherConfigSchema,
  z.object({
    authorisationInfo: InventoryAuthorisationInfoSchema
  })
)
```

**Alternative Definition** (if discriminated union preferred):
```typescript
// Each matcher type variant includes authorisationInfo
const RawAuthorizeWithConfigSchema = z.discriminatedUnion('type', [
  z.object({
    nameMatcher: z.string(),
    authorisationInfo: InventoryAuthorisationInfoSchema
  }),
  z.object({
    contentMatcher: z.string(),
    authorisationInfo: InventoryAuthorisationInfoSchema
  }),
  z.object({
    hashes: z.array(InventoryScriptHashInfoSchema),
    authorisationInfo: InventoryAuthorisationInfoSchema
  }),
  z.object({
    headerNameMatcher: z.string(),
    authorisationInfo: InventoryAuthorisationInfoSchema
  })
])
```

**Note**: The intersection approach is cleaner as it reuses the existing `RawMatcherConfigSchema`. Choose based on error message preferences and schema complexity.

**Validation Behavior**:
- Fails if `authorisationInfo` is missing
- Fails if `matcher` is invalid (per RawMatcherConfigSchema)
- Fails if `date` is not ISO 8601 format
- Fails if `description` is empty string

#### Updated InventoryScriptInfoSchema

**Location**: `src/types/inventory/zod.ts`

**Definition** (updated):
```typescript
const RawInventoryScriptInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema  // NEW: Use nested schema
})
```

#### Updated InventoryHeaderInfoSchema

**Location**: `src/types/inventory/zod.ts`

**Definition** (updated):
```typescript
const RawInventoryHeaderInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema  // NEW: Use nested schema
})
```

### Edge Cases

1. **Missing authorisationInfo**:
   - **Validation**: Zod schema fails with error: "Required field missing: authorisationInfo"
   - **Handling**: Reject inventory load, log error, alert operator

2. **Null matcher**:
   - **Validation**: Zod schema fails with error: "Expected object, received null"
   - **Handling**: Reject inventory load

3. **Invalid date format**:
   - **Validation**: Zod schema fails with error: "Invalid datetime string"
   - **Handling**: Reject inventory load

4. **Empty description**:
   - **Validation**: Zod schema fails with error: "String must contain at least 1 character(s)"
   - **Handling**: Reject inventory load

5. **Unauthorized entry (authorised: false)**:
   - **Validation**: Schema passes (valid state)
   - **Handling**: Comparison service generates alert based on `authorised` flag

## Data Flow

### 1. New Script Discovery (Inventory Workflow)

**Function**: `scriptInfoToInventoryScriptInfo` (`src/utils/script.ts`)

**Input**: `ScriptInfo` (detected script), `Date` (discovery timestamp)

**Output**: `InventoryScriptInfo` with nested authorization info

**Process**:
```typescript
export function scriptInfoToInventoryScriptInfo(scriptInfo: ScriptInfo, date: Date): InventoryScriptInfo {
  const scriptSource = getScriptSource(scriptInfo)
  const escapedPattern = `^${escapeRegex(scriptSource)}$`

  return {
    identifyWith: createMatcher({ nameMatcher: escapedPattern }),
    authoriseWith: {  // NEW: Composite structure
      matcher: createMatcher({ hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)] }),
      authorisationInfo: {
        description: 'NO_DESCRIPTION',
        authorised: false,
        date: date,
      }
    }
  }
}
```

### 2. Load from JSON (Deserialization)

**Function**: `rawInventoryScriptInfoToInventoryScriptInfo` (`src/utils/script.ts`)

**Input**: `RawInventoryScriptInfo` (from JSON)

**Output**: `InventoryScriptInfo` (with Matcher instances)

**Process**:
```typescript
export function rawInventoryScriptInfoToInventoryScriptInfo(rawInventoryScriptInfo: RawInventoryScriptInfo): InventoryScriptInfo {
  // Destructure authoriseWith to separate matcher config from authorisationInfo
  const { authorisationInfo, ...matcherConfig } = rawInventoryScriptInfo.authoriseWith

  return {
    identifyWith: createMatcher(rawInventoryScriptInfo.identifyWith),
    authoriseWith: {  // NEW: Construct composite structure
      matcher: createMatcher(matcherConfig),  // matcherConfig contains nameMatcher/contentMatcher/hashes/headerNameMatcher
      authorisationInfo: {
        description: authorisationInfo.description,
        authorised: authorisationInfo.authorised,
        date: new Date(authorisationInfo.date)  // ISO string → Date
      }
    }
  }
}
```

### 3. Save to JSON (Serialization)

**Function**: `inventoryScriptInfoToRawInventoryScriptInfo` (`src/utils/script.ts`)

**Input**: `InventoryScriptInfo` (with Matcher instances)

**Output**: `RawInventoryScriptInfo` (for JSON)

**Process**:
```typescript
export function inventoryScriptInfoToRawInventoryScriptInfo(inventoryScriptInfo: InventoryScriptInfo): RawInventoryScriptInfo {
  function matcherToConfig(matcher: Matcher): RawMatcherConfig {
    const matcherType = matcher.getType()
    const pattern = matcher.getPattern()

    switch (matcherType) {
      case 'name':
        return { nameMatcher: pattern as string }
      case 'content':
        return { contentMatcher: pattern as string }
      case 'hash':
        return { hashes: pattern as InventoryScriptHashInfo[] }
      default:
        throw new Error(`Unknown matcher type: ${matcherType}`)
    }
  }

  // Convert matcher to config and spread into authoriseWith alongside authorisationInfo
  const matcherConfig = matcherToConfig(inventoryScriptInfo.authoriseWith.matcher)

  return {
    identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
    authoriseWith: {  // NEW: Flatten matcher config and authorisationInfo as siblings
      ...matcherConfig,  // Spreads nameMatcher/contentMatcher/hashes/headerNameMatcher
      authorisationInfo: {
        description: inventoryScriptInfo.authoriseWith.authorisationInfo.description,
        authorised: inventoryScriptInfo.authoriseWith.authorisationInfo.authorised,
        date: inventoryScriptInfo.authoriseWith.authorisationInfo.date.toISOString()  // Date → ISO string
      }
    }
  }
}
```

### 4. Authorization Check (Comparison Service)

**Function**: `ScriptComparisonService.compare()` (`src/services/comparison/script.ts`)

**Input**: `ScriptInfo` (detected), `InventoryScriptInfo[]` (inventory)

**Output**: Comparison result (UnknownScriptFound | KnownScriptWithUnauthorisedContentFound | AuthorizedScriptFound)

**Process** (updated access pattern):
```typescript
// Identify script
const inventoryEntry = inventoryScripts.find(entry => entry.identifyWith.identify(scriptInfo))

if (!inventoryEntry) {
  return new UnknownScriptFound(scriptInfo)
}

// Authorize content
const isAuthorized = inventoryEntry.authoriseWith.matcher.authorize(scriptInfo)  // NEW: Access nested matcher

if (!isAuthorized) {
  return new KnownScriptWithUnauthorisedContentFound(
    scriptInfo,
    inventoryEntry.authoriseWith.matcher,  // NEW: Access nested matcher
    inventoryEntry.authoriseWith.authorisationInfo  // NEW: Access nested authorisationInfo
  )
}

return new AuthorizedScriptFound(
  scriptInfo,
  inventoryEntry.authoriseWith.authorisationInfo  // NEW: Access nested authorisationInfo
)
```

## Migration Considerations

### Manual Inventory Update

**Process**:
1. Load existing inventory JSON file
2. For each script/header entry:
   - Extract `authoriseWith` matcher config
   - Extract `authorisationInfo` (currently sibling field)
   - Create new nested structure: `{ matcher: <config>, authorisationInfo: <info> }`
3. Save updated JSON file
4. Commit to Git with message: "Migrate inventory to nested authorization schema"

**Example Transformation**:

**Before** (current format):
```json
{
  "identifyWith": { "nameMatcher": "^https://example\\.com/script\\.js$" },
  "authoriseWith": { "hashes": [...] },
  "authorisationInfo": {
    "description": "Analytics script",
    "authorised": true,
    "date": "2025-10-21T12:00:00.000Z"
  }
}
```

**After** (new format):
```json
{
  "identifyWith": { "nameMatcher": "^https://example\\.com/script\\.js$" },
  "authoriseWith": {
    "hashes": [...],
    "authorisationInfo": {
      "description": "Analytics script",
      "authorised": true,
      "date": "2025-10-21T12:00:00.000Z"
    }
  }
}
```

### Validation Script

A validation script should be created to verify migrated inventories:

**Location**: `src/utils/inventory/validate-migration.ts` (already exists per package.json script)

**Purpose**: Load and validate all inventory files against new Zod schema

**Usage**: `npm run validate-inventory`

## Summary

The enhanced data model nests `authorisationInfo` within `authoriseWith`, creating a cohesive `AuthorizeWithConfig` structure. This improves data organization by grouping authorization logic (matcher) with authorization metadata (description, status, date) in a single entity.

**Key Changes**:
- New type: `AuthorizeWithConfig` wraps `Matcher` + `InventoryAuthorisationInfo`
- Updated: `InventoryScriptInfo.authoriseWith` and `InventoryHeaderInfo.authoriseWith` use `AuthorizeWithConfig`
- Updated: `RawInventoryScriptInfo` and `RawInventoryHeaderInfo` use `RawAuthorizeWithConfig`
- Updated: All conversion functions handle nested structure
- Updated: Comparison services access nested `authorisationInfo`

**Benefits**:
- Improved data cohesion (authorization context self-contained)
- Clearer domain model (authorization includes both logic and metadata)
- Maintained type safety (TypeScript + Zod validation)
- Preserved security logic (matcher pipeline unchanged)
