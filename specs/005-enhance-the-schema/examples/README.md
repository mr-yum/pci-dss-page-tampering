# Composite Matcher Examples

This directory contains example inventory entries demonstrating composite matcher usage.

## Examples

### 1. AND Matcher: CSP with Multiple Required Directives

**File**: [and-matcher-csp.json](./and-matcher-csp.json)

**Use Case**: Content Security Policy header that MUST contain all three directives:

- `default-src https:` (baseline HTTPS enforcement)
- `script-src https:` (prevent inline scripts)
- `object-src 'none'` (block Flash/plugin exploits)

**Pattern**: `andMatcher` with three `contentMatcher` children, each with nested `authorisationInfo`

**Validation**: Run `npm run validate-inventory specs/005-enhance-the-schema/examples/and-matcher-csp.json`

---

### 2. OR Matcher: Alternative CSP Policies by Environment

**File**: [or-matcher-alternative-policies.json](./or-matcher-alternative-policies.json)

**Use Case**: Accept ANY of three valid CSP configurations:

- Strict HTTPS-only policy (production)
- Self-only policy (staging)
- Deny-all policy (maintenance mode)

**Pattern**: `orMatcher` with three `contentMatcher` alternatives, each with nested `authorisationInfo`

**Validation**: Run `npm run validate-inventory specs/005-enhance-the-schema/examples/or-matcher-alternative-policies.json`

---

### 3. Nested Composite: Complex Environment-Based Policy

**File**: [nested-composite-complex-policy.json](./nested-composite-complex-policy.json)

**Use Case**: Accept EITHER:

- Strict production policy (default-src https: AND script-src https: AND object-src 'none')
- Relaxed staging policy (default-src 'self' AND script-src 'self' 'unsafe-inline')

**Pattern**: `orMatcher` containing two `andMatcher` children (OR of ANDs)

**Logic Tree**:

```
OR
├── AND (Production)
│   ├── default-src https:
│   ├── script-src https:
│   └── object-src 'none'
└── AND (Staging)
    ├── default-src 'self'
    └── script-src 'self' 'unsafe-inline'
```

**Validation**: Run `npm run validate-inventory specs/005-enhance-the-schema/examples/nested-composite-complex-policy.json`

---

### 4. Array Syntax: Syntactic Sugar for OR

**File**: [array-syntax-or-alternative.json](./array-syntax-or-alternative.json)

**Use Case**: Accept ANY of three script versions:

- Version 1.0.0 (hash-based)
- Version 1.1.0 (hash-based)
- Development version (content-based fallback)

**Pattern**: `authoriseWith` as array (shorthand for `orMatcher`)

**Equivalence**: Array syntax is converted to `orMatcher` internally:

```json
"authoriseWith": [matcher1, matcher2, matcher3]
// Equivalent to:
"authoriseWith": {
  "matcher": {
    "orMatcher": [matcher1, matcher2, matcher3]
  },
  "authorisationInfo": { ... }
}
```

**Validation**: Run `npm run validate-inventory specs/005-enhance-the-schema/examples/array-syntax-or-alternative.json`

---

## Validation Commands

### Validate All Examples

```bash
npm run validate-inventory specs/005-enhance-the-schema/examples/and-matcher-csp.json
npm run validate-inventory specs/005-enhance-the-schema/examples/or-matcher-alternative-policies.json
npm run validate-inventory specs/005-enhance-the-schema/examples/nested-composite-complex-policy.json
npm run validate-inventory specs/005-enhance-the-schema/examples/array-syntax-or-alternative.json
```

### Expected Output

```
Validating inventory: specs/005-enhance-the-schema/examples/and-matcher-csp.json

✅ Inventory is valid!

The inventory conforms to the new identifyWith/authoriseWith schema.

Composite matcher features detected:
  ℹ️  Found andMatcher in headers.authoriseWith.matcher (multi-condition authorization)
```

---

## Integration with Existing System

These examples can be used as templates for real inventory entries:

1. Copy the relevant example to your inventory repository
2. Update the `target.inventory` and `target.detection` URLs
3. Update the `alerts` webhook URLs
4. Adjust the matcher patterns to match your actual headers/scripts
5. Update `authorisationInfo.description` to match your compliance requirements
6. Commit to your inventory repository

---

## Migration from Simple to Composite Matchers

See [MIGRATION.md](../MIGRATION.md) for guidance on migrating existing simple matchers to composite matchers.

---

## References

- **Feature Specification**: [spec.md](../spec.md)
- **Implementation Plan**: [plan.md](../plan.md)
- **Developer Guide**: [quickstart.md](../quickstart.md)
- **JSON Schema**: [contracts/composite-matcher-schema.json](../contracts/composite-matcher-schema.json)
