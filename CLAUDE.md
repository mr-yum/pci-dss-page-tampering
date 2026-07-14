# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a PCI DSS compliance system implementing **requirements 6.4.3 (Script Management)** and **11.6.1 (Detection and Alerting)** to prevent page tampering and e-skimming attacks on payment pages. The system provides:

### PCI DSS Compliance Goals

- **6.4.3 Script Management**: Maintain authorized inventory of all payment page scripts with justification and integrity verification
- **11.6.1 Detection and Alerting**: Continuous monitoring and alerting for unauthorized script/header modifications

### System Components

- **Inventory Service**: Updates baseline inventory of approved scripts and headers, alerts on new discoveries
- **Detection Service**: Monitors live applications against inventory, alerts on violations without modifying inventory
- **Dual Workflows**: Each target has both inventory and detection URLs for comprehensive coverage
- **Git-based Storage**: Inventories stored in separate Git repository for audit trail and version control

### Monitored Resources

- **External scripts** loaded from remote URLs with hash verification
- **Inline scripts** dynamically added during page execution
- **Security-impacting HTTP headers** (CSP, security headers)
- **Puppeteer workflows** simulating real user payment flows

## CLI Usage

The system is configured entirely via command-line parameters. No environment variables are used for execution configuration.

### Basic Syntax

```bash
npm start -- [OPTIONS]
```

### Required Parameters

| Parameter             | Description                                                            | Example                            |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `--repo <url>`        | Inventory repository URL (HTTPS or file://)                            | `https://github.com/org/inventory` |
| `--git-token <token>` | Git authentication token (required for HTTPS; optional for `validate`) | `${{ secrets.GITHUB_TOKEN }}`      |

### Optional Parameters

| Parameter                   | Description                                                    | Default             |
| --------------------------- | -------------------------------------------------------------- | ------------------- |
| `--mode <mode>`             | Execution mode: `inventory`, `detection`, `all`, or `validate` | `all`               |
| `--target <name>`           | Process specific target (e.g., "1.0")                          | all targets         |
| `--slack-token <token>`     | Slack token for alerts (logs to console if omitted)            | -                   |
| `--inventory-branch <name>` | Branch for inventory operations                                | `inventory-updates` |
| `--detection-branch <name>` | Branch for detection operations                                | `main`              |
| `--help`                    | Display help message and exit                                  | -                   |

### Usage Examples

```bash
# Run full workflow (inventory + detection) for all targets
npm start -- --repo https://github.com/org/inventory --git-token $TOKEN

# Run inventory only for a specific target
npm start -- --mode inventory --target 1.0 --repo https://github.com/org/inventory --git-token $TOKEN

# Run detection with Slack alerts
npm start -- --mode detection --repo https://github.com/org/inventory --git-token $TOKEN --slack-token $SLACK_TOKEN

# Run detection with custom branches
npm start -- --mode detection --detection-branch release/v2.0 --repo https://github.com/org/inventory --git-token $TOKEN

# Local testing with file protocol (no authentication needed)
npm start -- --repo file:///path/to/local/inventory --git-token dummy

# CI validation of the inventory repo (no token needed for file://)
npm start -- --mode validate --repo file://$PWD --inventory-branch $GITHUB_HEAD_REF
```

### Exit Codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | Success (including --help)                       |
| 1    | Validation error (invalid arguments)             |
| 2    | Execution error (Git, network, workflow failure) |

### Execution Modes

- **`inventory`**: Updates baseline inventory, pushes changes to Git
- **`detection`**: Read-only comparison against inventory, sends alerts
- **`all`**: Runs inventory first, then detection (default)
- **`validate`**: Runs full deserialization (Zod schema + `createMatcher()` + workflow file resolution) against the inventory repo and exits. No Puppeteer, no alerting, no push. Use as a CI pre-merge check in the script-inventory repository.

For detailed implementation documentation, see `specs/008-refactor-the-code/quickstart.md`.

## Commands

### Development

- `npm run start -- [OPTIONS]` - Run with CLI parameters (see CLI Usage above)
- `npm run develop` - Build in watch mode for development
- `npm run build:js` - Build TypeScript to JavaScript

### Testing

- `npm run test:unit` - Run unit tests
- `npm run test:integration` - Run integration tests
- `npm run test:integration:watch` - Watch integration tests
- `npm run test:smoke` - Run smoke tests in Docker

### Code Quality

- `npm run check:formatting` - Check code formatting with Prettier
- `npm run fix:formatting` - Auto-fix formatting issues
- `npm run check:linting` - Run ESLint checks
- `npm run fix:linting` - Auto-fix linting issues
- `npm run check:typing` - Run TypeScript type checking

### Before commit

- `npm run precommit` - All of the above testing and quality checks (run this to validate work is complete)
- `/coderabbit:review --base main` - Use CodeRabbit to review the change code vs main branch

### Setup

- `npm run setup` - Initialize project with Husky hooks

### Local Testing with GitHub Actions

```bash
# Requires .env.secrets file with INVENTORY_REPO_PAT and NPMRC_RO_FILE
act push --container-architecture linux/amd64 --secret-file .env.secrets
```

## Architecture

### Core Services

1. **DetectionService** (`src/services/detection.ts`) - Main orchestrator that:
   - Launches Puppeteer browser sessions
   - Executes workflow steps defined in `src/workflows/`
   - Captures scripts and headers during page navigation
   - Returns detection summaries for comparison

2. **ComparisonServices** - Compare detected resources against inventory using matcher pipeline:
   - `ScriptComparisonService` (`src/services/comparison/script.ts`) - Uses modular matcher system for flexible script identification and authorization
   - `HeaderComparisonService` (`src/services/comparison/header.ts`) - Uses matcher system for header identification (case-insensitive names) and authorization (case-sensitive values)

3. **InventoryService** (`src/services/inventory.ts`) - Manages resource inventories stored in Git:
   - Processes typed comparison results (ComparisonResultType[]) directly for inventory updates
   - Generic update handler for both scripts and headers using discriminated union switch
   - Single-pass processing eliminating legacy type conversions
   - Idempotent updates prevent duplicate hashes/matchers; pending entries (`authorised: false`) already covering a script are never re-appended on later runs
   - New scripts are identified by exact name (URL / inline id) — except inline scripts carrying the shared `inline_script/id_not_found` fallback, which get a provenance-based matcher instead: `andMatcher` of the initiator host (`hostMatcher`) and an anchored 64-char content snippet (`contentMatcher`, both ends anchored when the whole body fits the window). Two exceptions: content-only matching when the initiator URL is missing/unparseable, and the exact-name matcher (degenerate) for whitespace-only content — never a universal matcher
   - Array syntax conversion preserves original authorization metadata

4. **AlertService** (`src/services/alert/slack.ts`) - Sends Slack notifications for detected changes

### Data Flow

1. **Inventory Workflow**:
   - Executes against staging/inventory targets
   - Comparison services return typed results (ComparisonResultType[])
   - InventoryService processes results directly in single pass
   - Updates baseline inventory with newly discovered scripts/headers
   - Alerts on unidentified resources (requires manual authorization)
   - Pushes changes to Git repository
   - Opens a pull request from `--inventory-branch` into `--detection-branch`
     (GitHub HTTPS repos only) so the inventory repo's `--mode validate` CI
     check runs and humans can review. PR creation failure fails the run;
     the `--git-token` must have `pull_requests: write` permission.

2. **Detection Workflow**:
   - Executes against production/detection targets
   - Comparison services return typed results (ComparisonResultType[])
   - Compares findings against existing inventory (read-only)
   - Alerts on uninventoried or hash-mismatched resources
   - No inventory modifications

3. **Script Comparison Flow** (Matcher Pipeline):
   - **Identification**: Iterate inventory entries in order, test `identifyWith` matcher against detected script
   - **First-Match-Wins**: Return first inventory entry where `identifyWith.identify()` returns true
   - **Authorization**: If identified, test `authoriseWith.matcher` against script content
   - **Result**: Return typed comparison result (UnknownScriptFound, KnownScriptWithUnauthorisedContentFound, or AuthorizedScriptFound)
   - **Fail-Secure**: Null/empty content triggers UnknownScriptFound (cannot be safely matched)
   - **Metadata Access**: Authorization metadata available via `authoriseWith.authorisationInfo` for alert context

4. **Alert Categories**:
   - `new_inventory_script_identified`: New script found during inventory (needs authorization)
   - `uninventoried_script_detected`: Unknown script found during detection
   - `mismatched_script_detected`: Known script with changed hash (potential tampering)

### Key Types

- **Target** (`src/types/target.ts`) - Defines URLs and workflows for monitoring
- **ScriptInfo** (`src/types/script.ts`) - Represents detected scripts with hash validation
- **DetectionSummary** (`src/types/detection.ts`) - Results from a detection run
- **Inventory** (`src/types/inventory/`) - Zod-validated inventory structures with:
  - `scripts[]`: Array of authorized scripts with `identifyWith` and `authoriseWith` configurations
  - `headers[]`: Array of authorized headers with `identifyWith` and `authoriseWith` configurations
  - `alerts{}`: Configuration for different violation alert destinations
  - `target`: Dual URLs for inventory and detection workflows

#### Authorization Structure (Enhanced 2025-10)

Each inventory entry (scripts and headers) uses a nested authorization structure:

- `identifyWith`: Matcher for identifying the resource (NameMatcher/HeaderNameMatcher/ContentMatcher/HashMatcher/HostMatcher/UrlMatcher/OrMatcher/AndMatcher)
- `authoriseWith`: Matcher configuration with authorization metadata:
  - Can be a single matcher (NameMatcher, ContentMatcher, HashMatcher, HostMatcher, UrlMatcher, OrMatcher, AndMatcher)
  - Can be an array of matchers (syntactic sugar for OrMatcher)
  - Must include `authorisationInfo` with description, authorization status, and date
  - Composite matchers (OrMatcher, AndMatcher) can have nested `authorisationInfo` at each level

**Simple Matcher Example**:

```json
{
  "identifyWith": { "nameMatcher": "^https://example\\.com/script\\.js$" },
  "authoriseWith": {
    "hashes": [{ "timestamp": "2025-10-21T12:00:00.000Z", "hash": { "value": "abc123..." } }],
    "authorisationInfo": {
      "description": "Analytics script for conversion tracking",
      "authorised": true,
      "date": "2025-10-21T12:00:00.000Z"
    }
  }
}
```

**Composite Matcher Example (AND logic for CSP)**:

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

**Array Syntax Example (OR logic for multiple versions)**:

```json
{
  "identifyWith": { "nameMatcher": "^https://cdn\\.example\\.com/analytics\\.js$" },
  "authoriseWith": [
    {
      "hashes": [{ "timestamp": "2025-10-01T00:00:00.000Z", "hash": { "value": "abc123..." } }],
      "authorisationInfo": { "description": "Version 1.0.0", "authorised": true, "date": "2025-10-01T00:00:00.000Z" }
    },
    {
      "hashes": [{ "timestamp": "2025-10-15T00:00:00.000Z", "hash": { "value": "def456..." } }],
      "authorisationInfo": { "description": "Version 1.1.0", "authorised": true, "date": "2025-10-15T00:00:00.000Z" }
    }
  ]
}
```

This structure ensures authorization logic (matcher) and metadata are cohesively linked.

#### Matcher System (Refactored 2025-10)

- **Matcher Interface** (`src/types/matcher/matcher.interface.ts`) - Strategy pattern for script and header matching with `identify()` and `authorize()` methods. Every `Matchable` field carries what its name says, for every resource type: `name` is the script URL / inline id / header name; `content` is the actual content (external script response body, inline script source, or header value — never the URL as a stand-in); optional `hash` is the SHA-256 of that content; optional `url` is the single source of truth for provenance, populated for response headers (URL of the emitting response), external scripts (the script's own URL), and inline scripts (initiator URL captured at insertion time by the page-attribution shim, falling back to `location.href` for parser-inserted scripts).
- **NameMatcher** (`src/types/matcher/name-matcher.ts`) - Matches scripts by URL using regex patterns (case-sensitive, for external scripts with dynamic parameters)
- **HeaderNameMatcher** (`src/types/matcher/header-name-matcher.ts`) - Matches headers by name using regex patterns (case-insensitive per RFC 7230, for HTTP header identification)
- **ContentMatcher** (`src/types/matcher/content-matcher.ts`) - Matches by content using regex patterns (case-sensitive, against actual content: external script bodies, inline script source, or header values — never the URL; use NameMatcher/UrlMatcher/HostMatcher for URL-based matching)
- **HashMatcher** (`src/types/matcher/hash-matcher.ts`) - Matches scripts by SHA-256 hash (scripts only, for strict integrity verification)
- **HostMatcher** (`src/types/matcher/host-matcher.ts`) - Derives the host portion of `Matchable.url` on the fly and regex-matches against it. Use when the inventory cares about origin but not path (e.g. _"any CSP from `_.meandu.app`"*). Fails-secure when `url` is missing or unparseable.
- **UrlMatcher** (`src/types/matcher/url-matcher.ts`) - Regex-matches the full `Matchable.url` (host + path + query). Use when path precision matters (e.g. _"only `https://m.stripe.network/out-_.js`, not arbitrary paths"*). Fails-secure when `url` is missing.
- **OrMatcher** (`src/types/matcher/or-matcher.ts`) - Composite matcher implementing OR logic (authorizes if ANY child succeeds, first-match-wins)
- **AndMatcher** (`src/types/matcher/and-matcher.ts`) - Composite matcher implementing AND logic (authorizes only if ALL children succeed)

**Important Distinction**: `NameMatcher` and `HeaderNameMatcher` are distinct implementations with different matching semantics:

- **NameMatcher** (for scripts): Case-sensitive URL/name matching (e.g., "https://Example.com" ≠ "https://example.com")
- **HeaderNameMatcher** (for headers): Case-insensitive name matching per RFC 7230 (e.g., "Content-Type" = "content-type")
- Both implement the same `Matcher` interface but with domain-appropriate behaviors

**Composite Matcher Nesting Recommendations**:

- **Tested Performance**: Up to 10 nesting levels without significant degradation
- **Typical Use Cases**: 2-4 nesting levels (e.g., CSP policies with multiple directive requirements)
- **No Hard Limit**: Deeper nesting is supported but may impact performance
- **Fail-Secure**: Empty composite matcher arrays are rejected at schema validation and constructor level
- **Metadata Paths**: Authorization metadata is collected from root to leaf for full audit trail

#### Comparison Result Types (Enhanced 2025-10 with Metadata Paths)

**Script Comparison Results:**

- **UnknownScriptFound** (`src/types/comparison/unknown-script-found.ts`) - Script not in inventory or has null/empty content
- **KnownScriptWithUnauthorisedContentFound** (`src/types/comparison/known-script-unauthorised-content-found.ts`) - Script identified but authorization failed (includes matcher details, failure reason, and metadataPath for composite matchers)
- **AuthorizedScriptFound** (`src/types/comparison/authorized-script-found.ts`) - Script both identified and authorized (compliant, no alert; includes metadataPath for composite matchers)

**Header Comparison Results:**

- **UnknownHeaderFound** (`src/types/comparison/unknown-header-found.ts`) - Header not in inventory
- **KnownHeaderUnauthorisedContentFound** (`src/types/comparison/known-header-unauthorised-content-found.ts`) - Header identified but authorization failed (includes matcher details, failure reason, and metadataPath for composite matchers)
- **AuthorizedHeaderFound** (`src/types/comparison/authorized-header-found.ts`) - Header both identified and authorized (compliant, no alert; includes metadataPath for composite matchers)

**Metadata Path**: For composite matchers (OrMatcher/AndMatcher), comparison results include a `metadataPath` array containing authorization metadata from root to leaf. This provides complete audit trail context for nested authorization decisions:

```typescript
{
  authorized: true,
  metadataPath: [
    { description: "Accept either production OR staging policy", authorised: true, date: "2025-10-24..." },
    { description: "Production policy with HTTPS", authorised: true, date: "2025-10-24..." },
    { description: "default-src https: required", authorised: true, date: "2025-10-24..." }
  ]
}
```

These typed results provide complete context to alert handlers without additional queries.

### Workflows

Workflows are defined as step-by-step instructions for Puppeteer in `src/workflows/`:

- Each step includes element selectors and actions (click, input, navigate)
- Steps are converted to PuppeteerLocatorActions for execution
- Support for popup handling and complex user flows

### Module Organization

- `src/handlers/` - Response handlers for scripts and headers
- `src/interfaces/` - TypeScript interfaces for services
- `src/repositories/` - Data access layer for inventories
- `src/stores/` - Storage implementations (Git, in-memory)
- `src/utils/` - Utility functions for hashing, parsing, and workflow conversion

## Environment Requirements

- Node.js >= 24
- NPM >= 10 (Yarn/PNPM not supported)
- Chrome dependencies for Puppeteer (see GitHub Actions workflow)

## Configuration

**CLI Parameters Only**: The system no longer uses environment variables for runtime configuration. All configuration is provided via CLI parameters (see CLI Usage section above).

**For GitHub Actions**: Pass secrets via CLI parameters:

```yaml
run: |
  npm start -- \
    --repo https://github.com/org/inventory \
    --git-token ${{ secrets.INVENTORY_REPO_PAT }} \
    --slack-token ${{ secrets.SLACK_TOKEN }}
```

## Scheduled Execution

The system runs on CRON schedules:

- **Daily execution** at 12:00 PM UTC via GitHub Actions
- **Inventory workflow** runs first to update baselines
- **Detection workflow** follows to monitor against updated inventory
- Consider staggering schedules to avoid stale inventory data during detection

## Build System

- **Module system**: native ESM (`"type": "module"`). Relative imports must
  carry explicit `.js` extensions (`./foo.js`, `./bar/index.js`); SWC emits ESM
  to `dist/` and the app runs via `tsx`. Config/utility files that stay
  CommonJS use the `.cjs` extension (`eslint.config.cjs`, `jest.config.cjs`,
  `scripts/migrate-inventory-schema.cjs`).
- **TypeScript compilation**: SWC via `@swc/cli` (config in `.swcrc`)
- **Linting**: ESLint flat config (`eslint.config.cjs`)
- **Formatting**: Prettier (config in `package.json`)
- **Testing**: Jest 30 with `@swc/jest` transform (`jest.config.cjs`); a
  `moduleNameMapper` strips the `.js` extension so tests resolve `.ts` sources
- **Type checking**: `tsc --noEmit` directly

## Behaviours

- **Never merge PRs without human review**: Do not merge any pull request that has not been reviewed and approved by a human. `main` branch protection requires a code-owner approval — do not bypass it. Specifically, never use admin/override merges (e.g. `gh pr merge --admin`) or otherwise circumvent required reviews and status checks. You may prepare a PR so it is ready to merge (fix CI, resolve conflicts, push), but a human must perform or explicitly authorize the final merge.
- **Commit messages**: Please use conventional commits and keep them concise. Tell us what value was created in the commit, not a catalog of changes.
- **Code review on commit**: Before creating a commit, run `/coderabbit:review --base main` and address its findings (or explain why a finding is intentional) as part of the same change. Treat CodeRabbit as a required review step alongside `npm run precommit` — precommit verifies correctness, CodeRabbit catches design/quality issues a static check won't.
- **CodeRabbit PR reviews are asynchronous**: passing the pre-commit CLI review is not the end of the CodeRabbit step. After opening a PR or pushing new commits to one, CodeRabbit posts inline review comments on the PR several minutes later — check for them before considering the work done (`gh api repos/<org>/<repo>/pulls/<n>/comments`, filtering `in_reply_to_id == null` for top-level findings; comments created after your last push are new). Address or rebut every finding and reply on its thread with the fix commit. New pushes trigger fresh reviews, so re-check after each push until a review round comes back clean.
- **2nd code review on commit**: Before creating a commit, run `/review` and address its findings (or explain why a finding is intentional) as part of the same change. Treat this as a required review step alongside `npm run precommit` — precommit verifies correctness, Review catches design/quality issues a static check won't.
- **Update README.md**: Ensure that you consider any updates to user facing documentation as part of any changes.
