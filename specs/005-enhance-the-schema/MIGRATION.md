# Migration Guide: Simple to Composite Matchers

**Feature**: Composite Matchers with Nested Authorization
**Branch**: `005-enhance-the-schema`
**Date**: 2025-10-24

## Overview

This guide explains how to migrate existing simple matcher configurations to composite matchers when you need to express complex authorization policies.

## When to Use Composite Matchers

### Use Simple Matchers When:

- You have a single condition to check (e.g., "script must match this hash")
- Authorization is straightforward (content matches pattern OR hash matches value)
- You don't need alternative acceptable policies

### Use Composite Matchers When:

- You need ALL of multiple conditions to be met (AND logic)
- You want to accept ANY of several alternative policies (OR logic)
- You have complex multi-condition authorization rules (e.g., CSP with multiple required directives)

## Migration Patterns

### Pattern 1: Single Matcher (No Migration Needed)

**Current (Simple Matcher)**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-security-policy$"
  },
  "authoriseWith": {
    "contentMatcher": "default-src https:",
    "authorisationInfo": {
      "description": "CSP with HTTPS default source",
      "authorised": true,
      "date": "2025-10-24T00:00:00.000Z"
    }
  }
}
```

**Status**: ✅ **No migration needed** - simple matchers continue to work as-is.

---

### Pattern 2: Multiple Required Conditions → AND Matcher

**Before (Impossible with Simple Matchers)**:

```
You couldn't express "CSP must have ALL of these directives:
- default-src https:
- script-src https:
- object-src 'none'"
```

**After (AND Matcher)**:

```json
{
  "identifyWith": {
    "headerNameMatcher": "^content-security-policy$"
  },
  "authoriseWith": {
    "andMatcher": [
      {
        "contentMatcher": "default-src\\s+https:"
      },
      {
        "contentMatcher": "script-src\\s+https:"
      },
      {
        "contentMatcher": "object-src\\s+'none'"
      }
    ],
    "authorisationInfo": {
      "description": "CSP requiring all three critical directives",
      "authorised": true,
      "date": "2025-10-24T00:00:00.000Z"
    }
  }
}
```

**Example**: [and-matcher-csp.json](./examples/and-matcher-csp.json)

---

### Pattern 3: Alternative Acceptable Policies → OR Matcher

**Before (Possible but Verbose)**:

```json
{
  "contentMatcher": "(default-src https:.*script-src https:)|(default-src 'self'.*script-src 'self')|(default-src 'none')",
  "authorisationInfo": {
    "description": "Accept production, staging, or maintenance policies",
    "authorised": true,
    "date": "2025-10-24T00:00:00.000Z"
  }
}
```

**After (OR Matcher - More Readable)**:

```json
{
  "orMatcher": [
    {
      "contentMatcher": "default-src\\s+https:.*script-src\\s+https:"
    },
    {
      "contentMatcher": "default-src\\s+'self'.*script-src\\s+'self'"
    },
    {
      "contentMatcher": "default-src\\s+'none'"
    }
  ],
  "authorisationInfo": {
    "description": "Accept production, staging, or maintenance policies",
    "authorised": true,
    "date": "2025-10-24T00:00:00.000Z"
  }
}
```

**Example**: [or-matcher-alternative-policies.json](./examples/or-matcher-alternative-policies.json)

---

### Pattern 4: Multiple Script Versions → Array Syntax (Syntactic Sugar)

**Before (Multiple Inventory Entries)**:

```json
{
  "scripts": [
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\.example\\.com/analytics\\.js$" },
      "authoriseWith": {
        "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "abc..." } }],
        "authorisationInfo": { "description": "Version 1.0.0", "authorised": true, "date": "2025-10-01T00:00:00.000Z" }
      }
    },
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\.example\\.com/analytics\\.js$" },
      "authoriseWith": {
        "hashes": [{ "timestamp": "2025-10-15T00:00:00.000Z", "hash": { "value": "def..." } }],
        "authorisationInfo": { "description": "Version 1.1.0", "authorised": true, "date": "2025-10-15T00:00:00.000Z" }
      }
    }
  ]
}
```

**After (Single Entry with Array Syntax)**:

```json
{
  "scripts": [
    {
      "identifyWith": { "nameMatcher": "^https://cdn\\.example\\.com/analytics\\.js$" },
      "authoriseWith": [
        {
          "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "abc..." } }],
          "authorisationInfo": { "description": "Version 1.0.0", "authorised": true, "date": "2025-10-01T00:00:00.000Z" }
        },
        {
          "hashes": [{ "timestamp": "2025-10-15T00:00:00.000Z", "hash": { "value": "def..." } }],
          "authorisationInfo": { "description": "Version 1.1.0", "authorised": true, "date": "2025-10-15T00:00:00.000Z" }
        },
        {
          "contentMatcher": "function\\s+trackPageView",
          "authorisationInfo": { "description": "Development version", "authorised": true, "date": "2025-10-20T00:00:00.000Z" }
        }
      ]
    }
  ]
}
```

**Note**: Array syntax is automatically converted to `orMatcher` internally (first-match-wins semantics).

**Example**: [array-syntax-or-alternative.json](./examples/array-syntax-or-alternative.json)

---

### Pattern 5: Complex Nested Policies → OR of ANDs

**Use Case**: Accept EITHER (strict production policy) OR (relaxed staging policy)

```json
{
  "orMatcher": [
    {
      "andMatcher": [{ "contentMatcher": "default-src\\s+https:" }, { "contentMatcher": "script-src\\s+https:" }, { "contentMatcher": "object-src\\s+'none'" }]
    },
    {
      "andMatcher": [{ "contentMatcher": "default-src\\s+'self'" }, { "contentMatcher": "script-src\\s+'self'\\s+'unsafe-inline'" }]
    }
  ],
  "authorisationInfo": {
    "description": "Accept either strict production OR relaxed staging policy",
    "authorised": true,
    "date": "2025-10-24T00:00:00.000Z"
  }
}
```

**Logic Tree**:

```
OR (accept if ANY branch succeeds)
├── AND (strict production: ALL required)
│   ├── default-src https:
│   ├── script-src https:
│   └── object-src 'none'
└── AND (relaxed staging: ALL required)
    ├── default-src 'self'
    └── script-src 'self' 'unsafe-inline'
```

**Example**: [nested-composite-complex-policy.json](./examples/nested-composite-complex-policy.json)

---

## Backward Compatibility

### 100% Backward Compatible

All existing simple matcher configurations continue to work without modification:

- ✅ `nameMatcher` (scripts)
- ✅ `headerNameMatcher` (headers)
- ✅ `contentMatcher` (scripts and headers)
- ✅ `hashes` (scripts only)

### New Capabilities (Additive)

Composite matchers are **additive enhancements** - they don't replace existing functionality:

- ✅ `orMatcher` (new - alternative policies)
- ✅ `andMatcher` (new - multi-condition requirements)
- ✅ Array syntax (new - syntactic sugar for OR)

---

## Migration Checklist

### Before Migrating

1. **Identify the need**: Do you have a use case that simple matchers cannot express?
2. **Review examples**: Check [examples/](./examples/) for similar patterns
3. **Validate syntax**: Use `npm run validate-inventory <file>` to test your inventory

### Migration Steps

1. **Backup current inventory**: Commit existing inventory to Git before changes
2. **Update matcher config**: Replace simple matcher with composite matcher structure
3. **Validate locally**: Run `npm run validate-inventory <file>` to check syntax
4. **Test in staging**: Deploy to staging environment first
5. **Monitor alerts**: Verify authorization logic works as expected
6. **Commit changes**: Commit validated inventory with descriptive message

### After Migration

1. **Update documentation**: Document the authorization policy in `authorisationInfo.description`
2. **Review alerts**: Check Slack/alert destinations for expected behavior
3. **Monitor for false positives**: Ensure authorized resources are not incorrectly flagged

---

## Validation

### Validate Inventory File

```bash
npm run validate-inventory path/to/inventory.json
```

### Expected Output (Success)

```
Validating inventory: path/to/inventory.json

✅ Inventory is valid!

The inventory conforms to the new identifyWith/authoriseWith schema.

Composite matcher features detected:
  ℹ️  Found andMatcher in headers.authoriseWith (multi-condition authorization)
  ℹ️  Found orMatcher in scripts.authoriseWith (alternative authorization policies)
```

### Expected Output (Failure)

```
❌ Inventory validation failed:

  - Array must contain at least 1 element(s) at "headers.0.authoriseWith.andMatcher"

Suggestions:
  Migration guide: specs/005-enhance-the-schema/MIGRATION.md
  See examples: specs/005-enhance-the-schema/examples/
```

---

## Common Pitfalls

### 1. Empty Composite Matcher Arrays

**❌ Invalid** (fails validation):

```json
{
  "andMatcher": [],
  "authorisationInfo": {...}
}
```

**✅ Valid**:

```json
{
  "andMatcher": [
    {"contentMatcher": "pattern1"},
    {"contentMatcher": "pattern2"}
  ],
  "authorisationInfo": {...}
}
```

**Why**: Empty arrays cannot make authorization decisions (fail-secure behavior).

---

### 2. Missing authorisationInfo

**❌ Invalid** (fails validation):

```json
{
  "andMatcher": [{ "contentMatcher": "pattern1" }, { "contentMatcher": "pattern2" }]
  // Missing authorisationInfo!
}
```

**✅ Valid**:

```json
{
  "andMatcher": [{ "contentMatcher": "pattern1" }, { "contentMatcher": "pattern2" }],
  "authorisationInfo": {
    "description": "Both patterns required",
    "authorised": true,
    "date": "2025-10-24T00:00:00.000Z"
  }
}
```

**Why**: All matchers require authorization metadata for audit trail.

---

### 3. Confusing AND vs OR Semantics

**AND Matcher** (`andMatcher`):

- **All** children must succeed
- Short-circuit on first failure
- Use when: "Resource must have ALL of these properties"

**OR Matcher** (`orMatcher`):

- **Any** child can succeed (first-match-wins)
- Short-circuit on first success
- Use when: "Resource can match ANY of these alternatives"

---

## Performance Considerations

### Nesting Depth

- **Tested**: Up to 10 nesting levels without significant degradation
- **Typical**: 2-4 levels for most real-world policies
- **Recommendation**: Keep nesting as shallow as practical

### Evaluation Order

- **OR Matcher**: Stops at first successful match (first-match-wins)
- **AND Matcher**: Stops at first failure (short-circuit)
- **Optimization**: Place most likely matches first in OR matchers

---

## References

- **Feature Specification**: [spec.md](./spec.md)
- **Implementation Plan**: [plan.md](./plan.md)
- **Developer Guide**: [quickstart.md](./quickstart.md)
- **JSON Schema**: [contracts/composite-matcher-schema.json](./contracts/composite-matcher-schema.json)
- **Examples**: [examples/](./examples/)

---

## Support

For questions or issues:

1. **Validation errors**: Run `npm run validate-inventory <file>` and check error messages
2. **Examples**: Review [examples/](./examples/) directory for working patterns
3. **Documentation**: See [CLAUDE.md](../../CLAUDE.md) for system architecture

---

## Changelog

### 2025-10-24 (Phase 8)

- Initial migration guide created
- Added 5 migration patterns (simple → AND → OR → array → nested)
- Added validation instructions and common pitfalls
- Created example inventory files for each pattern
