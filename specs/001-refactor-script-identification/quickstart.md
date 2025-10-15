# Quickstart: Migrating to New Inventory Schema

**Date**: 2025-10-15
**Feature**: Script Identification and Authorisation Refactor
**Branch**: 001-refactor-script-identification

## Overview

This guide provides step-by-step instructions for migrating existing inventory JSON files from the old schema (without `identifyWith`/`authoriseWith`) to the new schema.

**IMPORTANT**: The new system **rejects** the old schema format. Manual migration is **required** before deployment (per clarification Q4).

---

## Schema Changes Summary

### Old Schema (No Longer Supported)

```json
{
  "scripts": [
    {
      "matcher": {
        "nameMatcher": "^https://example.com/script.js$"
      },
      "hashes": [
        {
          "timestamp": "2025-01-01T00:00:00.000Z",
          "hash": { "value": "abc123..." }
        }
      ],
      "authorisationInfo": {
        "description": "Example script",
        "authorised": true,
        "date": "2025-01-01T00:00:00.000Z"
      }
    }
  ]
}
```

**Issues**:
- `matcher` field was used for identification only
- `hashes` field was used for authorization, but not always present
- No clear separation between identification and authorization strategies

### New Schema (Required)

```json
{
  "scripts": [
    {
      "identifyWith": {
        "nameMatcher": "^https://example.com/script.js$"
      },
      "authoriseWith": {
        "hashes": [
          {
            "timestamp": "2025-01-01T00:00:00.000Z",
            "hash": { "value": "abc123..." }
          }
        ]
      },
      "authorisationInfo": {
        "description": "Example script",
        "authorised": true,
        "date": "2025-01-01T00:00:00.000Z"
      }
    }
  ]
}
```

**Benefits**:
- Clear separation: `identifyWith` for matching, `authoriseWith` for validation
- Flexible: Can use different matcher types for each phase
- Extensible: Same matcher logic for external and inline scripts

---

## Migration Steps

### Step 1: Backup Current Inventory

```bash
cd /path/to/script-inventory-repo
git checkout main
git pull
cp inventories/your-target.json inventories/your-target.json.backup
```

### Step 2: Identify Matcher Types

For each script entry in the old inventory, determine:

1. **Identification Strategy**: How is this script recognized?
   - External script with static URL → `nameMatcher` with exact pattern
   - External script with dynamic URL → `nameMatcher` with wildcard pattern
   - Inline script → `contentMatcher` with identifying code snippet

2. **Authorization Strategy**: How is this script's content validated?
   - Strict hash verification → `hashes` array
   - Flexible content pattern → `contentMatcher` with regex
   - Allow any content (rare) → `contentMatcher: ".*"`

### Step 3: Convert Each Entry

#### Example 1: External Script with Hash Verification

**Old**:
```json
{
  "matcher": {
    "nameMatcher": "^https:\\/\\/hcaptcha\\.com\\/1\\/api\\.js\\?.*$"
  },
  "hashes": [
    { "timestamp": "2025-08-26T05:58:41.265Z", "hash": { "value": "2d708..." } }
  ],
  "authorisationInfo": { ... }
}
```

**New**:
```json
{
  "identifyWith": {
    "nameMatcher": "^https:\\/\\/hcaptcha\\.com\\/1\\/api\\.js\\?.*$"
  },
  "authoriseWith": {
    "hashes": [
      { "timestamp": "2025-08-26T05:58:41.265Z", "hash": { "value": "2d708..." } }
    ]
  },
  "authorisationInfo": { ... }
}
```

**Rationale**: Name identifies the script, hashes verify content integrity.

---

#### Example 2: Inline Script (Content-Based)

**Old**:
```json
{
  "matcher": {
    "contentMatcher": "https:\\/\\/connect\\.facebook\\.net\\/en_US\\/fbevents\\.js"
  },
  "hashes": [
    { "timestamp": "2025-09-11T00:00:00.000Z", "hash": { "value": "e43fcd..." } }
  ],
  "authorisationInfo": { ... }
}
```

**New**:
```json
{
  "identifyWith": {
    "contentMatcher": "https:\\/\\/connect\\.facebook\\.net\\/en_US\\/fbevents\\.js"
  },
  "authoriseWith": {
    "hashes": [
      { "timestamp": "2025-09-11T00:00:00.000Z", "hash": { "value": "e43fcd..." } }
    ]
  },
  "authorisationInfo": { ... }
}
```

**Rationale**: Inline scripts are identified by content snippet, authorized by hash.

---

#### Example 3: Same Matcher for Both (Allowed)

**Old**:
```json
{
  "matcher": {
    "contentMatcher": "a.src='\\/cdn-cgi\\/challenge-platform\\/scripts\\/jsd\\/main.js'"
  },
  "authorisationInfo": { ... }
}
```

**New**:
```json
{
  "identifyWith": {
    "contentMatcher": "a.src='\\/cdn-cgi\\/challenge-platform\\/scripts\\/jsd\\/main.js'"
  },
  "authoriseWith": {
    "contentMatcher": "a.src='\\/cdn-cgi\\/challenge-platform\\/scripts\\/jsd\\/main.js'"
  },
  "authorisationInfo": { ... }
}
```

**Rationale**: Using the same matcher for both is valid (per clarification Q5). This script is both identified and authorized by its content pattern.

---

#### Example 4: Flexible Authorization

**Old**:
```json
{
  "matcher": {
    "nameMatcher": "^https:\\/\\/www\\.recaptcha\\.net\\/recaptcha\\/enterprise\\/webworker\\.js\\?.*$"
  },
  "authorisationInfo": { ... }
}
```

(No hashes in old schema - content was not strictly validated)

**New**:
```json
{
  "identifyWith": {
    "nameMatcher": "^https:\\/\\/www\\.recaptcha\\.net\\/recaptcha\\/enterprise\\/webworker\\.js\\?.*$"
  },
  "authoriseWith": {
    "contentMatcher": ".*"
  },
  "authorisationInfo": { ... }
}
```

**Rationale**: If no hashes were present in old schema, use `contentMatcher: ".*"` to allow any content (maintains previous behavior).

---

### Step 4: Validate New Schema

Use the following Node.js script to validate your migrated inventory:

```bash
# In your project directory
cat > validate-inventory.js << 'EOF'
const fs = require('fs');
const { z } = require('zod');

// Define Zod schema (simplified)
const MatcherConfigSchema = z.union([
  z.object({ nameMatcher: z.string().min(1) }),
  z.object({ contentMatcher: z.string().min(1) }),
  z.object({ hashes: z.array(z.object({
    timestamp: z.string(),
    hash: z.object({ value: z.string() })
  })).min(1) })
]).superRefine((val, ctx) => {
  // Validate regex patterns
  if ('nameMatcher' in val) {
    try { new RegExp(val.nameMatcher); }
    catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid regex in nameMatcher: "${val.nameMatcher}". Error: ${e.message}`
      });
    }
  }
  if ('contentMatcher' in val) {
    try { new RegExp(val.contentMatcher); }
    catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid regex in contentMatcher: "${val.contentMatcher}". Error: ${e.message}`
      });
    }
  }
});

const ScriptInventoryEntrySchema = z.object({
  identifyWith: MatcherConfigSchema,
  authoriseWith: MatcherConfigSchema,
  authorisationInfo: z.object({
    description: z.string(),
    authorised: z.boolean(),
    date: z.string()
  })
});

const InventorySchema = z.object({
  scripts: z.array(ScriptInventoryEntrySchema)
});

// Validate
const inventoryPath = process.argv[2];
if (!inventoryPath) {
  console.error('Usage: node validate-inventory.js <path-to-inventory.json>');
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
try {
  InventorySchema.parse(inventory);
  console.log('✅ Inventory is valid!');
} catch (e) {
  console.error('❌ Inventory validation failed:');
  console.error(e.errors);
  process.exit(1);
}
EOF

node validate-inventory.js inventories/your-target.json
```

**Expected Output**:
```
✅ Inventory is valid!
```

**Common Validation Errors**:

1. **Missing `identifyWith` or `authoriseWith`**:
   ```
   Required at "identifyWith"
   ```
   → Add the missing field to each script entry

2. **Invalid regex pattern**:
   ```
   Invalid regex in nameMatcher: "^https://[abc". Error: Unterminated character class
   ```
   → Fix the regex pattern (e.g., close the bracket: `^https://[abc]`)

3. **Empty hashes array**:
   ```
   Array must contain at least 1 element(s)
   ```
   → Add at least one hash or change authorization strategy to `contentMatcher`

---

### Step 5: Test Against Staging

Before deploying to production:

1. **Update staging inventory** with migrated schema
2. **Run inventory workflow** against staging target
3. **Verify no alerts** for known good scripts
4. **Verify alerts** for intentionally modified test scripts

```bash
# In your script-inventory repo
git checkout -b migrate-to-new-schema
cp inventories/your-target.json.backup inventories/your-target.json
# Apply migration manually or with script
git add inventories/your-target.json
git commit -m "Migrate your-target inventory to new identifyWith/authoriseWith schema"
git push origin migrate-to-new-schema
```

Then trigger inventory workflow (manually or via schedule) and monitor Slack alerts.

---

### Step 6: Deploy to Production

Once staging tests pass:

1. **Merge migration PR** in script-inventory repo
2. **Deploy refactored code** to production
3. **Monitor alerts** for first 24 hours
4. **Verify Git audit trail** still functioning (check commits in inventory repo)

---

## Migration Checklist

- [ ] Backup current inventory files
- [ ] For each script entry:
  - [ ] Identify identification strategy (usually `nameMatcher`)
  - [ ] Identify authorization strategy (usually `hashes` or `contentMatcher`)
  - [ ] Create `identifyWith` object
  - [ ] Create `authoriseWith` object
- [ ] Validate migrated inventory with Zod schema
- [ ] Test against staging target
- [ ] Review staging alerts (should match previous behavior)
- [ ] Merge migration PR
- [ ] Deploy refactored code
- [ ] Monitor production alerts for 24 hours

---

## Common Patterns

### Pattern 1: External Script with Dynamic URL + Hash Verification

```json
{
  "identifyWith": { "nameMatcher": "^https://cdn.example.com/.*\\.js$" },
  "authoriseWith": { "hashes": [...] }
}
```

**Use Case**: CDN scripts with versioned URLs, strict integrity verification.

---

### Pattern 2: Inline Script + Hash Verification

```json
{
  "identifyWith": { "contentMatcher": "__NEXT_DATA__" },
  "authoriseWith": { "hashes": [...] }
}
```

**Use Case**: Framework-injected scripts identified by unique code snippet.

---

### Pattern 3: Third-Party Script + Flexible Authorization

```json
{
  "identifyWith": { "nameMatcher": "^https://www.googletagmanager.com/.*$" },
  "authoriseWith": { "contentMatcher": ".*" }
}
```

**Use Case**: Frequently-updated third-party scripts where hash tracking is impractical.

⚠️ **Security Note**: Use flexible authorization (`contentMatcher: ".*"`) sparingly. Hash verification preferred for PCI DSS compliance.

---

### Pattern 4: Same Content Pattern for Identify + Authorize

```json
{
  "identifyWith": { "contentMatcher": "fbq\\('init'" },
  "authoriseWith": { "contentMatcher": "fbq\\('init'" }
}
```

**Use Case**: Inline scripts where presence of code snippet is sufficient authorization.

---

## Troubleshooting

### Error: "Invalid regex in nameMatcher"

**Cause**: Regex pattern has syntax error (unclosed bracket, invalid escape sequence, etc.)

**Solution**: Validate regex in Node.js REPL or online regex tester:
```javascript
new RegExp("^https://example[abc");  // Throws: Unterminated character class
new RegExp("^https://example[abc]"); // OK
```

---

### Error: "Required at identifyWith"

**Cause**: Old schema format detected (missing `identifyWith` field)

**Solution**: Add `identifyWith` object to script entry following migration examples above.

---

### Staging alerts show unknown scripts that should be authorized

**Cause**: Identification pattern doesn't match detected script name/content

**Solution**:
1. Check detected script name in alert
2. Test identification pattern against script name:
   ```javascript
   const pattern = /^https:\/\/example\.com\/script\.js\?.*$/;
   const scriptName = "https://example.com/script.js?v=123";
   console.log(pattern.test(scriptName)); // Should be true
   ```
3. Adjust pattern if needed (escape special characters, check wildcards)

---

### Staging alerts show unauthorized content for authorized scripts

**Cause**: Authorization pattern/hashes don't match detected script content

**Solution**:
1. Check detected script hash in alert
2. Compare against `authoriseWith.hashes` array
3. If hash mismatch is expected (script updated), add new hash to array
4. If unexpected, investigate potential tampering or CDN cache issue

---

## Reference: Example from refactor-plan.md

See `refactor-plan.md` lines 46-132 for complete example inventory demonstrating all matcher combinations:
- reCAPTCHA: `nameMatcher` (identify) + `contentMatcher: ".*"` (authorize)
- hCaptcha: `nameMatcher` (identify) + `hashes` (authorize)
- Facebook Pixel: `contentMatcher` (identify) + `hashes` (authorize)
- Cloudflare: `contentMatcher` (identify) + `contentMatcher` (authorize, same pattern)

---

## Need Help?

- **Schema validation errors**: Run `node validate-inventory.js` and address each error
- **Regex syntax questions**: See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
- **Pattern design questions**: Review `data-model.md` entity definitions and use cases
- **Migration questions**: Consult `research.md` for design rationale

---

**Next Steps**: After successful migration, proceed to `/speckit.tasks` to generate implementation tasks.
