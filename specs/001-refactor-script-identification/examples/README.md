# Example Inventory Files

This directory contains example inventory files demonstrating the schema migration from the old format to the new `identifyWith`/`authoriseWith` format.

## Files

### `new-schema-valid.json`

✅ **Valid** - Demonstrates the correct new schema format with various matcher combinations:

1. **hCaptcha** - `nameMatcher` (identify) + `hashes` (authorize)
2. **Facebook Pixel** - `contentMatcher` (identify) + `hashes` (authorize)
3. **Google Tag Manager** - `nameMatcher` (identify) + `contentMatcher: ".*"` (flexible authorize)
4. **Cloudflare** - `contentMatcher` (identify) + `contentMatcher` (authorize, same pattern)

**Validation**:

```bash
npm run validate-inventory specs/001-refactor-script-identification/examples/new-schema-valid.json
# Expected: ✅ Inventory is valid!
```

---

### `old-schema-invalid.json`

❌ **Invalid** - Demonstrates the old schema format that is no longer supported:

- Uses `matcher` field instead of `identifyWith`
- Uses top-level `hashes` field instead of `authoriseWith.hashes`
- Will be rejected by the new schema validator

**Validation**:

```bash
npm run validate-inventory specs/001-refactor-script-identification/examples/old-schema-invalid.json
# Expected: ❌ Old schema detected: Found "matcher" field...
```

---

### `invalid-regex.json`

❌ **Invalid** - Demonstrates regex validation errors:

- Contains an invalid regex pattern with an unterminated character class: `^https://example[abc`
- Shows the detailed error message provided by the schema validator

**Validation**:

```bash
npm run validate-inventory specs/001-refactor-script-identification/examples/invalid-regex.json
# Expected: ❌ Invalid regex in nameMatcher: "^https://example[abc". Error: Unterminated character class...
```

---

## Using These Examples

### To validate your own inventory

```bash
npm run validate-inventory path/to/your-inventory.json
```

### To migrate from old schema to new schema

1. **Backup your inventory**: `cp inventory.json inventory.json.backup`
2. **Review the migration guide**: See `../quickstart.md` for step-by-step instructions
3. **Use `new-schema-valid.json` as a reference** for matcher combinations
4. **Validate after migration** using the validation script
5. **Test against staging** before deploying to production

---

## Common Matcher Patterns

### Pattern 1: External script with dynamic URL + strict hash verification

```json
{
  "identifyWith": { "nameMatcher": "^https://cdn.example.com/.*\\.js$" },
  "authoriseWith": { "hashes": [...] }
}
```

### Pattern 2: Inline script + hash verification

```json
{
  "identifyWith": { "contentMatcher": "__NEXT_DATA__" },
  "authoriseWith": { "hashes": [...] }
}
```

### Pattern 3: Third-party script + flexible authorization

```json
{
  "identifyWith": { "nameMatcher": "^https://www.googletagmanager.com/.*$" },
  "authoriseWith": { "contentMatcher": ".*" }
}
```

⚠️ Use flexible authorization sparingly - hash verification is preferred for PCI DSS compliance.

### Pattern 4: Same content pattern for both

```json
{
  "identifyWith": { "contentMatcher": "fbq\\('init'" },
  "authoriseWith": { "contentMatcher": "fbq\\('init'" }
}
```

---

## Validation Error Reference

### "Old schema detected"

- **Cause**: Inventory uses `matcher` field or top-level `hashes`
- **Solution**: Migrate to `identifyWith`/`authoriseWith` format (see `../quickstart.md`)

### "Invalid regex in nameMatcher/contentMatcher"

- **Cause**: Regex pattern has syntax error
- **Solution**: Test regex in Node.js REPL: `new RegExp("your-pattern")`

### "Required at identifyWith/authoriseWith"

- **Cause**: Missing required field
- **Solution**: Add both `identifyWith` and `authoriseWith` to each script entry

### "Invalid SHA256 hash format"

- **Cause**: Hash value is not exactly 64 lowercase hex characters
- **Solution**: Ensure hash is valid SHA256 (use `sha256sum` or script detection output)

---

## Related Documentation

- **Migration Guide**: `../quickstart.md` - Step-by-step migration instructions
- **Data Model**: `../data-model.md` - Entity definitions and relationships
- **Technical Plan**: `../plan.md` - Architecture and design decisions
- **Research**: `../research.md` - Design rationale and alternatives considered
