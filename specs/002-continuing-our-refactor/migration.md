# Header Inventory Migration Guide

**Feature**: Header Comparison and Alert Refactor
**Branch**: `002-continuing-our-refactor`
**Date**: 2025-10-17

## Overview

This guide explains how to migrate existing header inventory entries from the legacy `nameMatcher`/`contentMatcher` RegExp structure to the new matcher-based `identifyWith`/`authoriseWith` structure.

## Background

**Previous Structure** (Legacy):

```json
{
  "nameMatcher": "^content-type$",
  "contentMatcher": "^application/json$",
  "authorisationInfo": {
    "description": "Content-Type header",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

**New Structure** (Matcher-based):

```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-type$"
  },
  "authoriseWith": {
    "contentMatcher": "^application/json$"
  },
  "authorisationInfo": {
    "description": "Content-Type header",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

## Why This Migration?

1. **Consistency**: Headers now use the same matcher architecture as scripts
2. **Flexibility**: Supports multiple matcher types (headerNameMatcher, contentMatcher, future extensions)
3. **Type Safety**: Zod schema validation ensures correctness
4. **Maintainability**: Single pattern for all resource matching (scripts and headers)

## Migration Steps

### Manual Migration

For each header entry in your inventory JSON files:

1. **Locate** the header entry with `nameMatcher` and `contentMatcher` fields
2. **Transform** the entry structure:
   - Wrap `nameMatcher` value in `identifyWith: { headerNameMatcher: "..." }`
   - Wrap `contentMatcher` value in `authoriseWith: { contentMatcher: "..." }`
   - Keep `authorisationInfo` unchanged

3. **Validate** using the Zod schema (automatic on inventory load)

### Example Migrations

#### Example 1: Content-Type Header

**Before**:

```json
{
  "nameMatcher": "^content-type$",
  "contentMatcher": "^(application/json|text/html)$",
  "authorisationInfo": {
    "description": "Allowed content types for API responses",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

**After**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-type$"
  },
  "authoriseWith": {
    "contentMatcher": "^(application/json|text/html)$"
  },
  "authorisationInfo": {
    "description": "Allowed content types for API responses",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

#### Example 2: X-Frame-Options Header

**Before**:

```json
{
  "nameMatcher": "^x-frame-options$",
  "contentMatcher": "^(DENY|SAMEORIGIN)$",
  "authorisationInfo": {
    "description": "Prevents clickjacking attacks",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

**After**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^x-frame-options$"
  },
  "authoriseWith": {
    "contentMatcher": "^(DENY|SAMEORIGIN)$"
  },
  "authorisationInfo": {
    "description": "Prevents clickjacking attacks",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

#### Example 3: Content-Security-Policy Header

**Before**:

```json
{
  "nameMatcher": "^content-security-policy$",
  "contentMatcher": "^default-src 'self'; script-src 'self' https://trusted.cdn.com",
  "authorisationInfo": {
    "description": "CSP for payment page",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

**After**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-security-policy$"
  },
  "authoriseWith": {
    "contentMatcher": "^default-src 'self'; script-src 'self' https://trusted.cdn.com"
  },
  "authorisationInfo": {
    "description": "CSP for payment page",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

#### Example 4: Wildcard Header Matching

**Before**:

```json
{
  "nameMatcher": "^x-custom-.*$",
  "contentMatcher": "^.*$",
  "authorisationInfo": {
    "description": "Custom application headers (any value allowed)",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

**After**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^x-custom-.*$"
  },
  "authoriseWith": {
    "contentMatcher": "^.*$"
  },
  "authorisationInfo": {
    "description": "Custom application headers (any value allowed)",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

## Important Notes

### Case Sensitivity

- **Header Names (identifyWith)**: Use `headerNameMatcher` for case-insensitive matching per RFC 7230
  - `"Content-Type"`, `"content-type"`, and `"CONTENT-TYPE"` all match pattern `^content-type$`
  - Always write patterns in **lowercase**

- **Header Values (authoriseWith)**: Use `contentMatcher` for case-sensitive matching
  - `"DENY"` does NOT match pattern `^deny$`
  - Pattern case must match the expected value case exactly

### Pattern Writing

**Best Practice**: Write `headerNameMatcher` patterns in lowercase

```json
// GOOD
{
  "identifyWith": {
    "headerNameMatcher": "^content-type$"
  }
}

// BAD (works but inconsistent with RFC 7230)
{
  "identifyWith": {
    "headerNameMatcher": "^Content-Type$"
  }
}
```

### Validation

The new Zod schema validates:

- Regex syntax is valid (compilation check)
- Required fields are present (`identifyWith`, `authoriseWith`, `authorisationInfo`)
- Matcher configurations match the MatcherConfigSchema

**Invalid Example** (will fail validation):

```json
{
  "identifyWith": {
    "headerNameMatcher": "^invalid[regex" // Invalid regex - unclosed bracket
  },
  "authoriseWith": {
    "contentMatcher": "^test$"
  },
  "authorisationInfo": {
    "description": "Test",
    "authorised": true,
    "date": "2024-01-01"
  }
}
```

Error: `Invalid regex in headerNameMatcher: "^invalid[regex". Error: Unterminated character class. Ensure all brackets are closed and escape sequences are valid.`

## Automated Migration Script

For repositories with many header entries, use the optional migration script:

```bash
# From repository root
node scripts/migrate-header-inventory.ts <inventory-file.json>
```

**Note**: This script is optional and should be created only if you have existing inventories to migrate (T068).

## Verification

After migration:

1. **Syntax Check**: Run `npm run check:typing` to verify TypeScript compilation
2. **Schema Validation**: Load the inventory - Zod will validate automatically
3. **Integration Test**: Run `npm run test:integration` to verify headers are matched correctly
4. **Smoke Test**: Run `npm run test:smoke` to ensure end-to-end flow works

## Rollback

If you need to rollback:

1. Revert to the previous commit before migration
2. The old `HeaderComparisonService` code is preserved in git history
3. Use `git revert` or `git reset` as appropriate

## Support

- **Specification**: See `specs/002-continuing-our-refactor/spec.md` for requirements
- **Data Model**: See `specs/002-continuing-our-refactor/data-model.md` for schema details
- **Type Definitions**: See `src/types/inventory/header-entry.ts` for TypeScript types

## Summary

| Aspect               | Legacy                      | New (Matcher-based)                               |
| -------------------- | --------------------------- | ------------------------------------------------- |
| Identification Field | `nameMatcher: "pattern"`    | `identifyWith: { headerNameMatcher: "pattern" }`  |
| Authorization Field  | `contentMatcher: "pattern"` | `authoriseWith: { contentMatcher: "pattern" }`    |
| Name Matching        | Case-insensitive (implicit) | Case-insensitive (explicit via HeaderNameMatcher) |
| Value Matching       | Case-sensitive (implicit)   | Case-sensitive (explicit via ContentMatcher)      |
| Matcher Types        | RegExp only                 | headerNameMatcher, contentMatcher (extensible)    |
| Schema Validation    | Basic                       | Comprehensive (Zod with regex validation)         |

## Next Steps

After migration:

1. **Test thoroughly** - Verify all header entries match correctly
2. **Update documentation** - Document any custom header patterns
3. **Monitor alerts** - Check that header violations trigger appropriate alerts
4. **Review patterns** - Consider if any patterns should be refined with the new matcher flexibility

## Migration Checklist

- [ ] Back up existing inventory files
- [ ] Migrate `nameMatcher` → `identifyWith: { headerNameMatcher: ... }`
- [ ] Migrate `contentMatcher` → `authoriseWith: { contentMatcher: ... }`
- [ ] Verify all patterns are lowercase for headerNameMatcher
- [ ] Run `npm run check:typing` (should pass)
- [ ] Load inventory (Zod validation should pass)
- [ ] Run `npm run test:integration` (should pass)
- [ ] Run `npm run test:smoke` (should pass)
- [ ] Commit migrated inventory files
- [ ] Push to Git repository
- [ ] Monitor next scheduled detection run for issues

---

**Migration Date**: ******\_******
**Migrated By**: ******\_******
**Verification Status**: ******\_******
