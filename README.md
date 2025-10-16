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
