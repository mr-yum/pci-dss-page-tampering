# Quick Start: Command-Line Driven Execution

**Feature**: Command-Line Driven Execution Model
**For**: Developers implementing or using the CLI refactor
**Last Updated**: 2025-11-12

## Overview

This guide helps you quickly understand and use the new command-line interface for the PCI DSS Page Tampering Detection system. After this refactor, all execution is controlled via CLI parameters instead of environment variables or hardcoded configuration.

## Prerequisites

- Node.js >= 22
- npm >= 10
- Git repository access (GitHub, GitLab, or local file://)
- Git authentication token (for HTTPS repositories)

## Installation

```bash
# Clone repository
git clone https://github.com/your-org/pci-dss-page-tampering
cd pci-dss-page-tampering

# Install dependencies
npm install

# Build TypeScript
npm run build:js

# Verify installation
npm start -- --help
```

## Basic Usage

### Display Help

```bash
npm start -- --help
```

Output includes:

- All available parameters
- Required vs. optional flags
- Default values
- Usage examples
- Exit code meanings

### Run Full Workflow (Inventory + Detection)

```bash
npm start -- \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN
```

This runs `--mode all` (default):

1. Executes inventory workflow (updates baseline)
2. Pushes changes to `updates/scripts` branch
3. Executes detection workflow (monitors against baseline)
4. Pulls baseline from `main` branch
5. Sends alerts if violations found

### Run Inventory Only

```bash
npm start -- \
  --mode inventory \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN
```

Use cases:

- CI/CD pipeline validation during deployment
- Updating baseline after authorized script changes
- Feature branch testing with `--inventory-branch`

### Run Detection Only

```bash
npm start -- \
  --mode detection \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN \
  --slack-token $SLACK_TOKEN
```

Use cases:

- On-demand production monitoring
- Testing detection logic without modifying inventory
- Monitoring specific targets with `--target`

### Process Specific Target

```bash
npm start -- \
  --mode inventory \
  --target 1.0 \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN
```

Processes only target "1.0", skips all other targets in repository.

## Advanced Usage

### Custom Branch Testing

```bash
# Test inventory on feature branch
npm start -- \
  --mode inventory \
  --inventory-branch feature/new-scripts \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN

# Monitor against release branch
npm start -- \
  --mode detection \
  --detection-branch release/v2.0 \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN \
  --slack-token $SLACK_TOKEN
```

### Local Testing (File Protocol)

```bash
npm start -- \
  --repo file:///Users/dev/test-inventory \
  --git-token dummy
```

Requirements:

- Local directory must have same structure as GitHub repository
- Must contain `targets/` and `workflows/` directories
- Git token required (use "dummy" for file:// repos)

### Console Alerts (No Slack)

```bash
npm start -- \
  --repo https://github.com/your-org/inventory \
  --git-token $GITHUB_TOKEN
  # Omit --slack-token
```

Alerts are logged to console instead of Slack. Useful for:

- Local development
- CI/CD pipelines with different alerting
- Testing detection logic

## Parameter Reference

| Parameter            | Required | Default         | Description                                   |
| -------------------- | -------- | --------------- | --------------------------------------------- |
| `--repo <url>`       | Yes      | -               | Inventory repository URL (HTTPS or file://)   |
| `--git-token <tok>`  | Yes      | -               | Git authentication token                      |
| `--mode <mode>`      | No       | all             | Execution mode: inventory \| detection \| all |
| `--target <name>`    | No       | all targets     | Process specific target (e.g., "1.0")         |
| `--slack-token <t>`  | No       | console logs    | Slack OAuth token for alerts                  |
| `--inventory-branch` | No       | updates/scripts | Branch for inventory operations               |
| `--detection-branch` | No       | main            | Branch for detection operations               |
| `--help`             | No       | false           | Display help and exit                         |

## Exit Codes

| Code | Meaning          | Example Scenarios                                 |
| ---- | ---------------- | ------------------------------------------------- |
| 0    | Success          | Workflows completed, help displayed               |
| 1    | Validation Error | Missing --repo, invalid URL, unknown --mode value |
| 2    | Execution Error  | Git clone failed, target not found, network error |

## CI/CD Integration

### GitHub Actions Example

```yaml
name: PCI DSS Inventory Check

on:
  push:
    branches: [main, staging]

jobs:
  inventory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm install
      - run: npm run build:js

      - name: Run inventory check
        run: |
          npm start -- \
            --mode inventory \
            --target 1.0 \
            --repo https://github.com/${{ github.repository_owner }}/inventory \
            --git-token ${{ secrets.INVENTORY_PAT }} \
            --slack-token ${{ secrets.SLACK_TOKEN }}

      - name: Check exit code
        if: failure()
        run: echo "Inventory check failed - unauthorized scripts detected"
```

### GitLab CI Example

```yaml
inventory-check:
  image: node:22
  script:
    - npm install
    - npm run build:js
    - |
      npm start -- \
        --mode inventory \
        --repo https://gitlab.com/${CI_PROJECT_NAMESPACE}/inventory \
        --git-token ${INVENTORY_PAT} \
        --slack-token ${SLACK_TOKEN}
  only:
    - main
    - staging
  allow_failure: false # Fail pipeline on exit code 1 or 2
```

## Common Workflows

### Scheduled Monitoring (Cron)

```bash
#!/bin/bash
# daily-monitoring.sh - Run via cron at 12:00 PM UTC

set -e  # Exit on error

npm start -- \
  --repo https://github.com/org/inventory \
  --git-token "$GITHUB_TOKEN" \
  --slack-token "$SLACK_TOKEN"

# Exit code 0 = success
# Exit code 1/2 = failure (alerts already sent)
```

Cron entry:

```cron
0 12 * * * /path/to/daily-monitoring.sh >> /var/log/pci-monitoring.log 2>&1
```

### Deployment Pipeline Validation

```bash
#!/bin/bash
# validate-deployment.sh - Run before promoting to production

TARGET_NAME="1.0"  # From deployment config
INVENTORY_BRANCH="staging"  # Match deployment environment

npm start -- \
  --mode inventory \
  --target "$TARGET_NAME" \
  --inventory-branch "$INVENTORY_BRANCH" \
  --repo https://github.com/org/inventory \
  --git-token "$GITHUB_TOKEN"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Deployment validation passed - no unauthorized scripts"
  exit 0
else
  echo "❌ Deployment validation failed - check logs"
  exit $EXIT_CODE
fi
```

### Feature Branch Testing

```bash
#!/bin/bash
# test-feature-branch.sh - Test inventory changes on feature branch

FEATURE_BRANCH="feature/add-analytics-script"

npm start -- \
  --mode inventory \
  --inventory-branch "$FEATURE_BRANCH" \
  --repo https://github.com/org/inventory \
  --git-token "$GITHUB_TOKEN"

echo "Review changes at: https://github.com/org/inventory/tree/$FEATURE_BRANCH"
```

## Troubleshooting

### Error: "Repository must be a valid URL"

**Cause**: Invalid `--repo` format

**Solution**: Ensure URL starts with `https://` or `file://`

```bash
# ❌ Wrong
--repo github.com/org/inventory

# ✅ Correct
--repo https://github.com/org/inventory
--repo file:///Users/dev/inventory
```

### Error: "Git clone failed: authentication failed"

**Cause**: Invalid or expired `--git-token`

**Solution**: Verify token has correct permissions:

- GitHub: `repo` scope (read/write access)
- GitLab: `api` or `read_repository` + `write_repository` scopes

```bash
# Test token manually
git clone https://x-access-token:$TOKEN@github.com/org/inventory test-clone
```

### Error: "Target 'X' not found in inventory repository"

**Cause**: Specified `--target` doesn't exist in `targets/` directory

**Solution**: List available targets:

```bash
# Clone repository manually
git clone https://github.com/org/inventory temp-inventory
ls temp-inventory/targets/
# Output: 1.0.json  2.0.json

# Use correct target name (without .json)
--target 1.0  # ✅ Correct
--target 1.0.json  # ❌ Wrong
```

### Error: "Branch 'X' does not exist in repository"

**Cause**: Invalid `--inventory-branch` or `--detection-branch`

**Solution**: Verify branch exists:

```bash
git ls-remote --heads https://github.com/org/inventory
# Look for refs/heads/your-branch-name
```

### Exit Code 2 (Execution Failure)

**Debugging Steps**:

1. Check Git access: `git clone https://... test`
2. Verify network connectivity
3. Check branch names exist
4. Review logs for specific error messages

## Migration from Environment Variables

**Before** (old approach):

```bash
# .env file
INVENTORY_REPO_PAT=ghp_abc123
SLACK_OAUTH_TOKEN=xoxb-456
GIT_UPDATED_SCRIPTS_BRANCH_NAME=updates/scripts
GIT_DETECTION_SCRIPTS_BRANCH_NAME=main

# Run
npm start
```

**After** (new approach):

```bash
# CLI parameters (no .env file needed)
npm start -- \
  --repo https://github.com/org/inventory \
  --git-token ghp_abc123 \
  --slack-token xoxb-456 \
  --inventory-branch updates/scripts \
  --detection-branch main
```

**Benefits**:

- ✅ No hardcoded repository URL (works for any organization)
- ✅ Explicit configuration (no hidden environment state)
- ✅ Per-execution control (different repos/branches per run)
- ✅ CI/CD friendly (parameters from secrets)

## Security Best Practices

### Token Handling

**✅ DO**:

```bash
# CI/CD: Use secrets
--git-token ${{ secrets.GITHUB_TOKEN }}

# Local: Use environment variable
export GITHUB_TOKEN="ghp_..."
npm start -- --repo ... --git-token "$GITHUB_TOKEN"

# Prompt for sensitive tokens
read -s GITHUB_TOKEN
npm start -- --repo ... --git-token "$GITHUB_TOKEN"
```

**❌ DON'T**:

```bash
# Never hardcode tokens in scripts
--git-token ghp_abc123xyz  # ❌ Token visible in process list

# Never commit tokens to Git
git add .env  # ❌ If .env contains tokens
```

### Repository Access

- Use read-only tokens for `--mode detection` (least privilege)
- Use read-write tokens for `--mode inventory` (requires push access)
- Rotate tokens regularly (90 days recommended)
- Audit token usage in Git logs

### Branch Protection

- Enable branch protection on `main` and `updates/scripts`
- Require pull request reviews for inventory changes
- Use `--inventory-branch feature/*` for testing before merging
- Never force-push to protected branches

## Performance Tips

### Single Target Execution

Process one target at a time for faster builds:

```bash
# Instead of processing all targets (45s)
npm start -- --repo ... --git-token ...

# Process specific target (15s)
npm start -- --target 1.0 --repo ... --git-token ...
```

### Local Repository Cache

Use local clone for repeated testing:

```bash
# Clone once
git clone https://github.com/org/inventory local-inventory

# Test multiple times (no network I/O)
npm start -- --repo file://$(pwd)/local-inventory --git-token dummy
```

### Parallel Target Processing

Run multiple targets in parallel (separate processes):

```bash
npm start -- --target 1.0 --repo ... --git-token ... &
npm start -- --target 2.0 --repo ... --git-token ... &
wait
```

## Development Workflow

### 1. Feature Development

```bash
# Create feature branch in inventory repo
cd /path/to/inventory-repo
git checkout -b feature/new-analytics

# Test changes
cd /path/to/pci-dss-page-tampering
npm start -- \
  --mode inventory \
  --inventory-branch feature/new-analytics \
  --repo file:///path/to/inventory-repo \
  --git-token dummy

# Review changes
cd /path/to/inventory-repo
git diff main feature/new-analytics
```

### 2. Integration Testing

```bash
# Run full workflow locally
npm start -- \
  --repo file:///path/to/inventory-repo \
  --git-token dummy

# Verify both inventory and detection run
# Check exit code: echo $?
```

### 3. Unit Testing

```bash
# Test CLI parsing
npm run test:unit -- src/cli/parser.test.ts

# Test configuration building
npm run test:unit -- src/cli/config.test.ts

# Test all CLI tests
npm run test:unit -- src/cli/
```

### 4. Code Quality

```bash
# Run full precommit check
npm run precommit

# Includes:
# - Formatting (Prettier)
# - Linting (ESLint)
# - Type checking (TypeScript)
# - Unit tests
# - Integration tests
```

## Additional Resources

- [Feature Specification](./spec.md) - User requirements and acceptance criteria
- [Implementation Plan](./plan.md) - Technical architecture and design decisions
- [Data Model](./data-model.md) - Type definitions and data structures
- [Research](./research.md) - Technology decisions and alternatives
- [CLI Args Schema](./contracts/cli-args.schema.json) - JSON Schema for parameters
- [Project Constitution](../../.specify/memory/constitution.md) - Development principles

## Support

**Issues**: Open GitHub issue with:

- CLI command used
- Full error message
- Exit code received
- Node.js version (`node --version`)

**Questions**: See [spec.md](./spec.md) for feature scope and acceptance scenarios
