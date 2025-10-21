# Quickstart: Schema Enhancement Implementation

**Feature**: Embed Authorization Info in Authorization Entity
**Branch**: 004-enhance-the-schema
**Date**: 2025-10-21

## Overview

This guide provides a quickstart for implementing the nested authorization schema enhancement. Follow these steps to update the inventory structure to nest `authorisationInfo` within `authoriseWith`.

## Prerequisites

- Node.js >= 22
- NPM >= 10
- Git repository access for inventory files
- Development environment set up (`npm run setup` completed)

## Implementation Phases

### Phase 1: Type Definitions (30 minutes)

**Goal**: Update TypeScript type definitions with zero runtime impact.

#### Step 1.1: Create AuthorizeWithConfig Type

**File**: `src/types/inventory/model.ts`

**Action**: Add new composite type definition after `InventoryAuthorisationInfo`:

```typescript
export type AuthorizeWithConfig = {
  matcher: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}
```

**Verification**: TypeScript compiles without errors (no code uses new type yet).

---

#### Step 1.2: Update InventoryScriptInfo Type

**File**: `src/types/inventory/model.ts`

**Action**: Update type definition (lines 25-29):

```typescript
// BEFORE:
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}

// AFTER:
export type InventoryScriptInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig
}
```

**Expected**: TypeScript compilation errors in files accessing `InventoryScriptInfo` (intentional).

---

#### Step 1.3: Update InventoryHeaderInfo Type

**File**: `src/types/inventory/model.ts`

**Action**: Update type definition (lines 41-45):

```typescript
// BEFORE:
export type InventoryHeaderInfo = {
  identifyWith: Matcher
  authoriseWith: Matcher
  authorisationInfo: InventoryAuthorisationInfo
}

// AFTER:
export type InventoryHeaderInfo = {
  identifyWith: Matcher
  authoriseWith: AuthorizeWithConfig
}
```

**Expected**: More TypeScript compilation errors (intentional).

---

#### Step 1.4: Create RawAuthorizeWithConfig Type

**File**: `src/types/inventory/raw.ts`

**Action**: Add new type definition after imports:

```typescript
export type RawAuthorizeWithConfig = RawMatcherConfig & {
  authorisationInfo: {
    description: string
    authorised: boolean
    date: string  // ISO 8601 format
  }
}
```

**Note**: Intersection type - matcher config fields and authorisationInfo are siblings.

**Verification**: TypeScript compiles this file without errors.

---

#### Step 1.5: Update RawInventoryScriptInfo Type

**File**: `src/types/inventory/raw.ts`

**Action**: Update type definition (lines 12-15):

```typescript
// BEFORE:
export type RawInventoryScriptInfo = Omit<InventoryScriptInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
}

// AFTER:
export type RawInventoryScriptInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig
}
```

**Rationale**: Omit pattern no longer needed since `InventoryScriptInfo` has no extra fields.

---

#### Step 1.6: Update RawInventoryHeaderInfo Type

**File**: `src/types/inventory/raw.ts`

**Action**: Update type definition (lines 25-28):

```typescript
// BEFORE:
export type RawInventoryHeaderInfo = Omit<InventoryHeaderInfo, 'identifyWith' | 'authoriseWith'> & {
  identifyWith: RawMatcherConfig
  authoriseWith: RawMatcherConfig
}

// AFTER:
export type RawInventoryHeaderInfo = {
  identifyWith: RawMatcherConfig
  authoriseWith: RawAuthorizeWithConfig
}
```

---

#### Step 1.7: Run Type Check

**Command**: `npm run check:typing`

**Expected**: Compilation errors in:
- `src/utils/script.ts` (conversion functions)
- `src/utils/inventory.ts` (conversion functions)
- `src/services/comparison/script.ts` (access patterns)
- `src/services/comparison/header.ts` (access patterns)

**Action**: Note the error locations for Phase 3 and Phase 4 updates.

---

### Phase 2: Schema Validation (45 minutes)

**Goal**: Update Zod schemas to validate nested structure.

#### Step 2.1: Create RawAuthorizeWithConfigSchema

**File**: `src/types/inventory/zod.ts`

**Action**: Add new schema after `InventoryAuthorisationInfoSchema`:

```typescript
const InventoryAuthorisationInfoRawSchema = z.object({
  description: z.string().min(1),
  authorised: z.boolean(),
  date: z.string().datetime()
})

const RawAuthorizeWithConfigSchema = z.intersection(
  RawMatcherConfigSchema,
  z.object({
    authorisationInfo: InventoryAuthorisationInfoRawSchema
  })
)
```

**Note**: Intersection schema combines matcher config with authorisationInfo. Create `InventoryAuthorisationInfoRawSchema` if it doesn't exist.

---

#### Step 2.2: Update RawInventoryScriptInfoSchema

**File**: `src/types/inventory/zod.ts`

**Action**: Update schema definition:

```typescript
// BEFORE:
const RawInventoryScriptInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawMatcherConfigSchema,
  authorisationInfo: InventoryAuthorisationInfoRawSchema
})

// AFTER:
const RawInventoryScriptInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema
})
```

---

#### Step 2.3: Update RawInventoryHeaderInfoSchema

**File**: `src/types/inventory/zod.ts`

**Action**: Update schema definition:

```typescript
// BEFORE:
const RawInventoryHeaderInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawMatcherConfigSchema,
  authorisationInfo: InventoryAuthorisationInfoRawSchema
})

// AFTER:
const RawInventoryHeaderInfoSchema = z.object({
  identifyWith: RawMatcherConfigSchema,
  authoriseWith: RawAuthorizeWithConfigSchema
})
```

---

#### Step 2.4: Write Schema Validation Tests

**File**: `src/types/inventory/zod.test.ts`

**Action**: Add test cases for nested structure validation:

```typescript
describe('RawAuthorizeWithConfigSchema', () => {
  it('should validate correct nested structure', () => {
    const valid = {
      nameMatcher: '^test$',
      authorisationInfo: {
        description: 'Test script',
        authorised: true,
        date: '2025-10-21T12:00:00.000Z'
      }
    }
    expect(() => RawAuthorizeWithConfigSchema.parse(valid)).not.toThrow()
  })

  it('should fail when authorisationInfo is missing', () => {
    const invalid = {
      nameMatcher: '^test$'
      // authorisationInfo missing
    }
    expect(() => RawAuthorizeWithConfigSchema.parse(invalid)).toThrow()
  })

  it('should fail when matcher field is missing', () => {
    const invalid = {
      authorisationInfo: {
        description: 'Test script',
        authorised: true,
        date: '2025-10-21T12:00:00.000Z'
      }
      // No nameMatcher/contentMatcher/hashes/headerNameMatcher
    }
    expect(() => RawAuthorizeWithConfigSchema.parse(invalid)).toThrow()
  })

  it('should fail when description is empty', () => {
    const invalid = {
      nameMatcher: '^test$',
      authorisationInfo: {
        description: '',  // Empty string
        authorised: true,
        date: '2025-10-21T12:00:00.000Z'
      }
    }
    expect(() => RawAuthorizeWithConfigSchema.parse(invalid)).toThrow()
  })

  it('should fail when date is invalid format', () => {
    const invalid = {
      nameMatcher: '^test$',
      authorisationInfo: {
        description: 'Test script',
        authorised: true,
        date: 'not-a-valid-date'
      }
    }
    expect(() => RawAuthorizeWithConfigSchema.parse(invalid)).toThrow()
  })
})
```

**Command**: `npm run test:unit -- zod.test.ts`

**Expected**: All validation tests pass.

---

### Phase 3: Conversion Functions (60 minutes)

**Goal**: Update utility functions to handle nested structure.

#### Step 3.1: Update scriptInfoToInventoryScriptInfo

**File**: `src/utils/script.ts`

**Action**: Update function (lines 16-28):

```typescript
// BEFORE:
return {
  identifyWith: createMatcher({ nameMatcher: escapedPattern }),
  authoriseWith: createMatcher({ hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)] }),
  authorisationInfo: {
    description: 'NO_DESCRIPTION',
    authorised: false,
    date: date,
  },
}

// AFTER:
return {
  identifyWith: createMatcher({ nameMatcher: escapedPattern }),
  authoriseWith: {
    matcher: createMatcher({ hashes: [scriptHashToInventoryHashInfo(scriptInfo, date)] }),
    authorisationInfo: {
      description: 'NO_DESCRIPTION',
      authorised: false,
      date: date,
    }
  }
}
```

---

#### Step 3.2: Update rawInventoryScriptInfoToInventoryScriptInfo

**File**: `src/utils/script.ts`

**Action**: Update function (lines 54-59):

```typescript
// BEFORE:
return {
  identifyWith: createMatcher(rawInventoryScriptInfo.identifyWith),
  authoriseWith: createMatcher(rawInventoryScriptInfo.authoriseWith),
  authorisationInfo: rawInventoryScriptInfo.authorisationInfo,
}

// AFTER:
// Destructure to separate matcher config from authorisationInfo
const { authorisationInfo, ...matcherConfig } = rawInventoryScriptInfo.authoriseWith

return {
  identifyWith: createMatcher(rawInventoryScriptInfo.identifyWith),
  authoriseWith: {
    matcher: createMatcher(matcherConfig),  // matcherConfig contains nameMatcher/contentMatcher/hashes
    authorisationInfo: {
      description: authorisationInfo.description,
      authorised: authorisationInfo.authorised,
      date: new Date(authorisationInfo.date)
    }
  }
}
```

---

#### Step 3.3: Update inventoryScriptInfoToRawInventoryScriptInfo

**File**: `src/utils/script.ts`

**Action**: Update function (lines 89-93):

```typescript
// BEFORE:
return {
  identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
  authoriseWith: matcherToConfig(inventoryScriptInfo.authoriseWith),
  authorisationInfo: inventoryScriptInfo.authorisationInfo,
}

// AFTER:
// Convert matcher and spread alongside authorisationInfo
const matcherConfig = matcherToConfig(inventoryScriptInfo.authoriseWith.matcher)

return {
  identifyWith: matcherToConfig(inventoryScriptInfo.identifyWith),
  authoriseWith: {
    ...matcherConfig,  // Spreads nameMatcher/contentMatcher/hashes as sibling fields
    authorisationInfo: {
      description: inventoryScriptInfo.authoriseWith.authorisationInfo.description,
      authorised: inventoryScriptInfo.authoriseWith.authorisationInfo.authorised,
      date: inventoryScriptInfo.authoriseWith.authorisationInfo.date.toISOString()
    }
  }
}
```

---

#### Step 3.4: Update rawInventoryHeaderInfoToInventoryHeaderInfo

**File**: `src/utils/inventory.ts`

**Action**: Update function (lines 44-49) - same pattern as script conversion.

---

#### Step 3.5: Update inventoryHeaderInfoToRawInventoryHeaderInfo

**File**: `src/utils/inventory.ts`

**Action**: Update function (lines 82-85) - same pattern as script conversion.

---

#### Step 3.6: Write Conversion Function Tests

**File**: `test/unit/utils/script.test.ts` (create if doesn't exist)

**Action**: Add round-trip tests:

```typescript
describe('Script conversion functions', () => {
  describe('round-trip serialization', () => {
    it('should preserve nested structure', () => {
      const original: InventoryScriptInfo = {
        identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/script\\.js$' }),
        authoriseWith: {
          matcher: createMatcher({ hashes: [{ timestamp: new Date(), hash: 'sha256-abc123' }] }),
          authorisationInfo: {
            description: 'Analytics script',
            authorised: true,
            date: new Date('2025-10-21T12:00:00.000Z')
          }
        }
      }

      const raw = inventoryScriptInfoToRawInventoryScriptInfo(original)
      const roundTrip = rawInventoryScriptInfoToInventoryScriptInfo(raw)

      expect(roundTrip.authoriseWith.authorisationInfo.description).toBe('Analytics script')
      expect(roundTrip.authoriseWith.authorisationInfo.authorised).toBe(true)
      expect(roundTrip.authoriseWith.authorisationInfo.date.toISOString()).toBe('2025-10-21T12:00:00.000Z')
    })
  })
})
```

**Command**: `npm run test:unit -- script.test.ts`

**Expected**: All round-trip tests pass.

---

### Phase 4: Service Integration (45 minutes)

**Goal**: Update comparison services to access nested authorization info.

#### Step 4.1: Update ScriptComparisonService

**File**: `src/services/comparison/script.ts`

**Action**: Find all occurrences of `authoriseWith` and `authorisationInfo` access:

```typescript
// BEFORE:
const isAuthorized = inventoryEntry.authoriseWith.authorize(scriptInfo)
const authInfo = inventoryEntry.authorisationInfo

// AFTER:
const isAuthorized = inventoryEntry.authoriseWith.matcher.authorize(scriptInfo)
const authInfo = inventoryEntry.authoriseWith.authorisationInfo
```

**Verification**: Use Find & Replace to update all access patterns.

---

#### Step 4.2: Update HeaderComparisonService

**File**: `src/services/comparison/header.ts`

**Action**: Same pattern as ScriptComparisonService.

---

#### Step 4.3: Write Service Integration Tests

**File**: `test/unit/services/comparison/script.test.ts`

**Action**: Update existing tests to use new structure:

```typescript
describe('ScriptComparisonService', () => {
  it('should access authorization info from nested location', () => {
    const inventoryEntry: InventoryScriptInfo = {
      identifyWith: createMatcher({ nameMatcher: '^https://example\\.com/script\\.js$' }),
      authoriseWith: {
        matcher: createMatcher({ hashes: [{ timestamp: new Date(), hash: 'sha256-abc123' }] }),
        authorisationInfo: {
          description: 'Analytics script',
          authorised: true,
          date: new Date()
        }
      }
    }

    const result = service.compare(scriptInfo, [inventoryEntry])

    expect(result).toBeInstanceOf(AuthorizedScriptFound)
    expect(result.authorisationInfo.description).toBe('Analytics script')
  })
})
```

**Command**: `npm run test:unit -- comparison`

**Expected**: All comparison service tests pass.

---

### Phase 5: End-to-End Validation (30 minutes)

**Goal**: Validate entire implementation with full test suite.

#### Step 5.1: Run All Tests

**Commands**:
```bash
npm run check:typing        # TypeScript compilation
npm run check:linting       # ESLint
npm run check:formatting    # Prettier
npm run test:unit           # All unit tests
```

**Expected**: All checks pass with zero errors.

---

#### Step 5.2: Create Sample Inventory File

**File**: `test-inventory.json` (temporary file)

**Content**:
```json
{
  "target": {
    "inventory": { "type": "INVENTORY", "url": "https://test.example.com", "workflow": "test-workflow" },
    "detection": { "type": "DETECTION", "url": "https://test.example.com", "workflow": "test-workflow" }
  },
  "alerts": {
    "inventory": {
      "newScriptIdentified": { "destination": "test-webhook" },
      "newHeaderIdentified": { "destination": "test-webhook" }
    },
    "detection": {
      "newScriptDetected": { "destination": "test-webhook" },
      "scriptMismatchDetected": { "destination": "test-webhook" },
      "newHeaderDetected": { "destination": "test-webhook" }
    }
  },
  "scripts": [
    {
      "identifyWith": { "nameMatcher": "^https://example\\.com/script\\.js$" },
      "authoriseWith": {
        "hashes": [{ "timestamp": "2025-10-21T12:00:00.000Z", "hash": "sha256-abc123" }],
        "authorisationInfo": {
          "description": "Analytics script for conversion tracking",
          "authorised": true,
          "date": "2025-10-21T12:00:00.000Z"
        }
      }
    }
  ],
  "headers": []
}
```

---

#### Step 5.3: Validate Sample Inventory

**Command**: `npm run validate-inventory test-inventory.json`

**Expected**: Validation passes with no errors.

---

#### Step 5.4: Clean Up

**Action**: Delete temporary test file:
```bash
rm test-inventory.json
```

---

## Migration Guide

### Migrating Existing Inventory Files

#### Step M.1: Backup Current Inventories

**Command**:
```bash
cd /path/to/script-inventory
git checkout -b pre-schema-migration
git push origin pre-schema-migration
```

---

#### Step M.2: Create Migration Script (Optional)

If many inventory files exist, create a migration script:

**File**: `scripts/migrate-inventory-schema.js`

**Content**:
```javascript
const fs = require('fs');

function migrateInventory(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Migrate scripts
  if (data.scripts) {
    data.scripts = data.scripts.map(script => ({
      identifyWith: script.identifyWith,
      authoriseWith: {
        ...script.authoriseWith,  // Spread matcher config (nameMatcher/contentMatcher/hashes)
        authorisationInfo: script.authorisationInfo
      }
    }));
  }

  // Migrate headers
  if (data.headers) {
    data.headers = data.headers.map(header => ({
      identifyWith: header.identifyWith,
      authoriseWith: {
        ...header.authoriseWith,  // Spread matcher config (headerNameMatcher/contentMatcher)
        authorisationInfo: header.authorisationInfo
      }
    }));
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Usage: node scripts/migrate-inventory-schema.js inventory.json
migrateInventory(process.argv[2]);
```

---

#### Step M.3: Run Migration

**Command**:
```bash
node scripts/migrate-inventory-schema.js /path/to/inventory.json
```

**Or manually**: Edit each inventory file to nest `authorisationInfo` within `authoriseWith`.

---

#### Step M.4: Validate Migrated Files

**Command**:
```bash
npm run validate-inventory /path/to/inventory.json
```

**Expected**: Validation passes for all migrated files.

---

#### Step M.5: Commit Migration

**Commands**:
```bash
cd /path/to/script-inventory
git add .
git commit -m "Migrate inventory schema to nested authorization structure

- Nest authorisationInfo within authoriseWith for all entries
- Required for schema enhancement feature (004-enhance-the-schema)
- See: pci-dss-page-tampering/specs/004-enhance-the-schema/spec.md"
git push origin main
```

---

## Deployment Checklist

- [ ] All unit tests pass (`npm run test:unit`)
- [ ] All integration tests pass (`npm run test:integration`)
- [ ] TypeScript compilation succeeds (`npm run check:typing`)
- [ ] Linting passes (`npm run check:linting`)
- [ ] Formatting passes (`npm run check:formatting`)
- [ ] All inventory files migrated to new format
- [ ] Migrated inventories validated (`npm run validate-inventory`)
- [ ] Migration committed to Git with descriptive message
- [ ] Code changes committed to feature branch
- [ ] Pull request created with constitution compliance check
- [ ] Code review completed
- [ ] Merge to main branch
- [ ] Deploy to production environment
- [ ] Monitor alerts for 24 hours post-deployment

## Rollback Plan

If issues are detected post-deployment:

1. **Code Rollback**:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Inventory Rollback**:
   ```bash
   cd /path/to/script-inventory
   git checkout pre-schema-migration
   git push origin main --force  # Use with caution
   ```

3. **Verification**:
   - Run detection workflow
   - Verify alerts are generated correctly
   - Monitor for errors in logs

## Troubleshooting

### Issue: TypeScript Compilation Errors After Type Updates

**Symptom**: Errors like "Property 'authorisationInfo' does not exist on type 'Matcher'"

**Solution**: Ensure all access patterns updated to use nested structure:
- `entry.authoriseWith` → `entry.authoriseWith.matcher`
- `entry.authorisationInfo` → `entry.authoriseWith.authorisationInfo`

---

### Issue: Zod Validation Fails on Migrated Files

**Symptom**: "Required field missing: authorisationInfo"

**Solution**: Check JSON structure - `authorisationInfo` must be nested inside `authoriseWith` alongside matcher config:
```json
{
  "authoriseWith": {
    "hashes": [...],  // or nameMatcher/contentMatcher/headerNameMatcher
    "authorisationInfo": { ... }
  }
}
```

---

### Issue: Round-Trip Tests Fail

**Symptom**: Data lost or changed after serialization → deserialization

**Solution**: Verify date conversion:
- Serialization: `date.toISOString()`
- Deserialization: `new Date(dateString)`

---

## Summary

This quickstart provides a step-by-step implementation guide for the schema enhancement. Follow phases in order, validate at each step, and use the migration guide for existing inventory files.

**Estimated Total Time**: 3-4 hours (implementation) + 1-2 hours (migration)

**Key Files Modified**:
- `src/types/inventory/model.ts` (type definitions)
- `src/types/inventory/raw.ts` (raw types)
- `src/types/inventory/zod.ts` (validation schemas)
- `src/utils/script.ts` (conversion functions)
- `src/utils/inventory.ts` (conversion functions)
- `src/services/comparison/script.ts` (access patterns)
- `src/services/comparison/header.ts` (access patterns)
- Test files (comprehensive coverage)

**Next Step**: Run `/speckit.tasks` to generate implementation tasks.
