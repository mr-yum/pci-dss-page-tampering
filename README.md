# PCI DSS Page Tampering

A PCI DSS compliance system implementing requirements 6.4.3 (Script Management) and 11.6.1 (Detection and Alerting) to prevent page tampering and e-skimming attacks on payment pages.

## Quick Start

### Basic Usage

Run with minimal required parameters:

```bash
npm start -- --repo https://github.com/org/inventory --git-token <YOUR_TOKEN>
```

This runs both inventory and detection workflows against all configured targets using default branches.

### Common Usage Examples

**Run all workflows with Slack alerts:**

```bash
npm start -- \
  --repo https://github.com/org/inventory \
  --git-token <YOUR_TOKEN> \
  --slack-token <YOUR_SLACK_TOKEN>
```

If you have your tokens in .env.secrets (see below for setup):

```bash
source .env.secrets
SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT
npm start -- \
  --repo https://github.com/org/inventory \
  --git-token $SLACK_OAUTH_TOKEN \
  --slack-token $INVENTORY_REPO_PAT
```

**Run inventory only for a specific target:**

```bash
npm start -- \
  --mode inventory \
  --target 1.0 \
  --repo https://github.com/org/inventory \
  --git-token <YOUR_TOKEN>
```

**Run detection only against production:**

```bash
npm start -- \
  --mode detection \
  --repo https://github.com/org/inventory \
  --git-token <YOUR_TOKEN> \
  --slack-token <YOUR_SLACK_TOKEN>
```

**Use custom branches for inventory and detection:**

```bash
npm start -- \
  --repo https://github.com/org/inventory \
  --git-token <YOUR_TOKEN> \
  --inventory-branch updates/scripts \
  --detection-branch main
```

**Local testing with file:// protocol:**

```bash
npm start -- \
  --repo file:///path/to/local/inventory \
  --git-token dummy
```

## CLI Parameters

### Required Parameters

| Parameter             | Description                                   | Example                            |
| --------------------- | --------------------------------------------- | ---------------------------------- |
| `--repo <url>`        | Inventory repository URL (HTTPS or file://)   | `https://github.com/org/inventory` |
| `--git-token <token>` | Git authentication token (required for HTTPS) | `${{ secrets.GITHUB_TOKEN }}`      |

### Optional Parameters

| Parameter                   | Description                                         | Default           |
| --------------------------- | --------------------------------------------------- | ----------------- |
| `--mode <mode>`             | Execution mode: `inventory`, `detection`, or `all`  | `all`             |
| `--target <name>`           | Process specific target (e.g., "1.0")               | all targets       |
| `--slack-token <token>`     | Slack token for alerts (logs to console if omitted) | -                 |
| `--inventory-branch <name>` | Branch for inventory operations                     | `updates/scripts` |
| `--detection-branch <name>` | Branch for detection operations                     | `main`            |
| `--help`                    | Display help message and exit                       | -                 |

## Branch Usage

The system uses different branches for different purposes:

### Inventory Branch (`--inventory-branch`)

- **Purpose**: Updates baseline inventory with newly discovered scripts/headers
- **Default**: `updates/scripts`
- **Behavior**: Reads from and pushes changes to this branch
- **Use case**: Staging/development environment monitoring to update approved resource list

### Detection Branch (`--detection-branch`)

- **Purpose**: Read-only comparison against stable inventory
- **Default**: `main`
- **Behavior**: Reads from this branch, never pushes changes
- **Use case**: Production monitoring against approved baselines

### Recommended Branch Strategy

1. **Inventory workflow** → `updates/scripts` branch
   - Runs against staging/inventory URLs
   - Adds new scripts/headers as they're discovered
   - Creates alerts for resources needing manual authorization

2. **Detection workflow** → `main` branch
   - Runs against production/detection URLs
   - Compares against stable, reviewed inventory
   - Alerts on any unauthorized changes

3. **Review process**:
   - Review changes in `updates/scripts` branch
   - Add authorization metadata for legitimate resources
   - Merge to `main` after approval
   - Detection workflow now recognizes these resources as authorized

### Example: Separate Review Workflow

```bash
# Step 1: Run inventory to discover new resources
npm start -- \
  --mode inventory \
  --inventory-branch updates/scripts \
  --repo https://github.com/org/inventory \
  --git-token <TOKEN>

# Step 2: Review and approve changes in updates/scripts branch
# (Manual review via pull request or direct commits)

# Step 3: Run detection against approved baseline
npm start -- \
  --mode detection \
  --detection-branch main \
  --repo https://github.com/org/inventory \
  --git-token <TOKEN> \
  --slack-token <SLACK_TOKEN>
```

## GitHub Actions Setup

For GitHub Actions, pass secrets via CLI parameters:

```yaml
- name: Run PCI DSS monitoring
  run: |
    npm start -- \
      --repo https://github.com/${{ github.repository }}-inventory \
      --git-token ${{ secrets.INVENTORY_REPO_PAT }} \
      --slack-token ${{ secrets.SLACK_TOKEN }} \
      --inventory-branch updates/scripts \
      --detection-branch main
```

## Local Testing with GitHub Actions

Requires `.env.secrets` file:

```
# .env.secrets
INVENTORY_REPO_PAT=<PAT secret>
NPMRC_RO_FILE=<copy all of .npmrc content, remember to include newlines>
```

Run locally:

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
