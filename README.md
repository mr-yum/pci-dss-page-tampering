# PCI DSS Page Tampering

Ensure you have a `.env.secrets` file:

```
# .env.secrets
INVENTORY_REPO_PAT=<PAT secret>
NPMRC_RO_FILE=<copy all of .npmrc content, remember to include newlines>
```

To run independently for testing:

```bash
source .env.secrets
SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT npm run start
```

If you want to use a different script inventory branch for inventory and updates:

```
source .env.secrets
GIT_UPDATED_SCRIPTS_BRANCH_NAME=<branch name for pushing script updates> SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT npm run start
```

If you also want a different branch for detection stage:

```
source .env.secrets
GIT_DETECTION_SCRIPTS_BRANCH_NAME=<branch name for detection stage> GIT_UPDATED_SCRIPTS_BRANCH_NAME=<branch name for pushing script updates> SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT npm run start
```

To run local GitHub Actions for testing:

```bash
act push --container-architecture linux/amd64 --secret-file .env.secrets
```

## Inventory Schema Migration

As of the refactoring in branch `001-refactor-script-identification`, the inventory schema has changed to support flexible script matching with separate identification and authorization strategies.

### What Changed

**Old Schema** (no longer supported):

```json
{
  "matcher": { "nameMatcher": "..." },
  "hashes": [...]
}
```

**New Schema** (required):

```json
{
  "identifyWith": { "nameMatcher": "..." },
  "authoriseWith": { "hashes": [...] }
}
```

### Migration Required

⚠️ **Important**: Existing inventory files must be manually migrated before deployment. The system will reject the old schema format.

### Migration Guide

See the complete migration guide with examples:

- **Step-by-step instructions**: [specs/001-refactor-script-identification/quickstart.md](specs/001-refactor-script-identification/quickstart.md)
- **Example inventory files**: [specs/001-refactor-script-identification/examples/](specs/001-refactor-script-identification/examples/)

### Validate Inventory

To validate an inventory file against the new schema:

```bash
npm run validate-inventory path/to/inventory.json
```

**Example**:

```bash
npm run validate-inventory specs/001-refactor-script-identification/examples/new-schema-valid.json
# Output: ✅ Inventory is valid!
```

### Common Validation Errors

| Error                  | Solution                                         |
| ---------------------- | ------------------------------------------------ |
| Old schema detected    | Migrate to `identifyWith`/`authoriseWith` format |
| Invalid regex pattern  | Test regex: `new RegExp("your-pattern")`         |
| Missing required field | Add both `identifyWith` and `authoriseWith`      |
| Invalid SHA256 hash    | Ensure 64 lowercase hex characters               |

### Benefits of New Schema

- **Flexibility**: Different matchers for identification vs authorization
- **Modularity**: Independent, testable matcher implementations
- **Clarity**: Explicit separation of concerns
- **Extensibility**: Easy to add new matcher types without changing core logic

For technical details, see [specs/001-refactor-script-identification/plan.md](specs/001-refactor-script-identification/plan.md)

## Composite Matchers (2025-10-24)

As of branch `005-enhance-the-schema`, the system supports **composite matchers** for expressing complex authorization policies.

### Composite Matcher Types

- **AND Matcher**: Authorize only if ALL children succeed (e.g., CSP with multiple required directives)
- **OR Matcher**: Authorize if ANY child succeeds (e.g., accept production OR staging policy)
- **Array Syntax**: Syntactic sugar for OR matcher (multiple acceptable versions)

### Examples

**AND Matcher** (CSP with multiple required directives):

```json
{
  "identifyWith": { "headerNameMatcher": "^content-security-policy$" },
  "authoriseWith": {
    "andMatcher": [{ "contentMatcher": "default-src\\s+https:" }, { "contentMatcher": "script-src\\s+https:" }, { "contentMatcher": "object-src\\s+'none'" }],
    "authorisationInfo": {
      "description": "CSP requiring all three critical directives",
      "authorised": true,
      "date": "2025-10-24T12:00:00.000Z"
    }
  }
}
```

**OR Matcher** (accept multiple acceptable policies):

```json
{
  "orMatcher": [{ "contentMatcher": "default-src\\s+https:.*script-src\\s+https:" }, { "contentMatcher": "default-src\\s+'self'.*script-src\\s+'self'" }, { "contentMatcher": "default-src\\s+'none'" }],
  "authorisationInfo": {
    "description": "Accept production, staging, or maintenance policies",
    "authorised": true,
    "date": "2025-10-24T12:00:00.000Z"
  }
}
```

**Array Syntax** (multiple script versions):

```json
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
    }
  ]
}
```

### Composite Matcher Migration

See the complete migration guide:

- **Migration Guide**: [specs/005-enhance-the-schema/MIGRATION.md](specs/005-enhance-the-schema/MIGRATION.md)
- **Examples**: [specs/005-enhance-the-schema/examples/](specs/005-enhance-the-schema/examples/)

### Backward Compatibility

✅ **100% backward compatible** - all existing simple matchers (nameMatcher, contentMatcher, hashes) continue to work without modification.
