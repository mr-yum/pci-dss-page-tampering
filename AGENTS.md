# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

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

The system is configured entirely via command-line parameters. No environment variables are used for execution configuration. (When running under GitHub Actions, the runner's standard `GITHUB_*` variables are read solely to annotate the auditor report with CI provenance and to append its job-summary digest — they never influence what the run does.)

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
| `--totp-seed <name>=<seed>` | Named base32 TOTP seed for `totp` workflow steps (repeatable)  | -                   |
| `--report-dir <path>`       | Directory for auditor report artefacts (HTML + JSON)           | - (no report)       |
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
- `branch-review` skill (`.claude/skills/branch-review/SKILL.md`) - Multi-agent review of the pending change (`staged` scope before a commit; the whole `origin/main...HEAD` branch before a PR). Replaces the old `/review` and `/code-review` steps

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
   - Launches Puppeteer browser sessions (isolated context per target run; the `HeadlessChrome` UA token is normalised to `Chrome` so the monitor sees what real users are served — bot mitigation blocks on the headless token, and cloaking attackers key on it)
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

5. **ReportService** (`src/services/report/`) - Produces the auditor report when `--report-dir` is set:
   - `ReportCollector` is fed once per target run from `main.ts`, after both comparisons and _before_ the inventory diff, so the report records the baseline the comparison actually ran against
   - Deliberately **not** an `IAlertService`: alerting is called twice per target with a partial view, fires after the diff, and drops `authorized_*` results — the very rows a census needs
   - Results are mapped to rows eagerly so the heavy comparison results (full script bodies, `Target`, matcher trees) can be freed
   - Emitted per pass from a `finally`, so a partially-failed run still produces evidence for the targets that succeeded; a write failure is logged and never fails the run
   - `--mode all` writes two documents (one per pass) joined by `run.correlationId`
   - Every authorised row carries `file:line` + JSON pointer provenance for the matcher that authorised it, resolved by `src/utils/provenance.ts` from the raw inventory text retained on `Inventory.source`
   - That same retained text is copied verbatim into `<report-dir>/<pass>/inventory/targets/*.json` and digested in `run.inventorySources`, so the cited line numbers stay resolvable after the branch moves. Per pass, not shared: under `--mode all` the passes read different branches
   - The Slack success notification links the **workflow run page**, not the artifact: the artifact uploads in a later workflow step and has no URL while the tool is still running. The run page lists it and renders the job-summary digest. Outside CI the written paths are shown instead (`ExecutionSummary.auditorReport`)

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

- `identifyWith`: Matcher for identifying the resource (NameMatcher/HeaderNameMatcher/ContentMatcher/HashMatcher/HostMatcher/UrlMatcher/CspDirectiveMatcher/OrMatcher/AndMatcher)
- `authoriseWith`: Matcher configuration with authorization metadata:
  - Can be a single matcher (NameMatcher, ContentMatcher, HashMatcher, HostMatcher, UrlMatcher, CspDirectiveMatcher, OrMatcher, AndMatcher)
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

- **Matcher Interface** (`src/types/matcher/matcher.interface.ts`) - Strategy pattern for script and header matching with `identify()` and `authorize()` methods. Every `Matchable` field carries what its name says, for every resource type: `name` is the script URL / inline id / header name; `content` is the actual content (external script response body, inline script source, or header value — never the URL as a stand-in); optional `hash` is the SHA-256 of that content; optional `url` is the single source of truth for provenance, populated for response headers (URL of the emitting response), external scripts (the script's own URL), and inline scripts (initiator URL captured at insertion time by the page-attribution shim, falling back to `location.href` for parser-inserted scripts); optional `workflowId` is the stable checkout-variation identifier assigned by orchestration.
- **NameMatcher** (`src/types/matcher/name-matcher.ts`) - Matches scripts by URL using regex patterns (case-sensitive, for external scripts with dynamic parameters)
- **HeaderNameMatcher** (`src/types/matcher/header-name-matcher.ts`) - Matches headers by name using regex patterns (case-insensitive per RFC 7230, for HTTP header identification)
- **ContentMatcher** (`src/types/matcher/content-matcher.ts`) - Matches by content using regex patterns (case-sensitive, against actual content: external script bodies, inline script source, or header values — never the URL; use NameMatcher/UrlMatcher/HostMatcher for URL-based matching)
- **HashMatcher** (`src/types/matcher/hash-matcher.ts`) - Matches scripts by SHA-256 hash (scripts only, for strict integrity verification). Hash identification works, but inventory entries should normally identify by stable name/content/provenance and use hashes for authorization; otherwise changed bytes are classified as an unknown script instead of known unauthorized content.
- **HostMatcher** (`src/types/matcher/host-matcher.ts`) - Derives the host portion of `Matchable.url` on the fly and regex-matches against it. Use when the inventory cares about origin but not path (e.g. "any CSP from `*.checkout.example`"). Fails-secure when `url` is missing or unparseable.
- **UrlMatcher** (`src/types/matcher/url-matcher.ts`) - Regex-matches the full `Matchable.url` (host + path + query). Use when path precision matters (e.g. _"only `https://payments.example.com/sdk/client-v1.js`, not arbitrary paths"_). Fails-secure when `url` is missing.
- **WorkflowMatcher** (`src/types/matcher/workflow-matcher.ts`) - Regex-matches `Matchable.workflowId` so a shared inventory entry can apply to one or more checkout variations. Fails secure when `workflowId` is missing or empty.
- **CspDirectiveMatcher** (`src/types/matcher/csp-directive-matcher.ts`) - Matches one Content-Security-Policy directive by its **set** of source expressions rather than the literal header text. Ordering is tolerated; any difference in membership — added _or_ removed — is flagged, and the reason names which sources moved and in which direction. Removals are deliberately not tolerated: some CSP sources only suppress others while present, so dropping the nonce from `script-src 'self' 'unsafe-inline' 'nonce-…'` makes `'unsafe-inline'` live, dropping `'strict-dynamic'` makes a scheme-source match every origin, and a bare `require-trusted-types-for` is enforcement off. Use for CSP directives instead of an anchored `contentMatcher`, which mints a fresh near-duplicate alternative on every reorder. `'nonce-*'` is the only wildcard and stands for exactly one per-response nonce; host wildcards are not expanded (`https://*.example.com` and `https://a.example.com` are different assertions); directive names are case-insensitive per the CSP spec. Emitted for newly discovered `content-security-policy` values by `newHeaderValueMatcherConfig` (`src/utils/header.ts`), which `ScriptInventoryService` uses on all three header-writing paths. A whole-header `identifyWith` needs one `authoriseWith` alternative per directive, since identification is first-match-wins.
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
- **MissingRequiredHeader** (`src/types/comparison/missing-required-header.ts`) - Header configured with `requiredOn` but absent from an in-scope response occurrence (potential control removal)

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

- Each step includes element selectors and actions (click, input, navigate, totp)
- `waitFor` selector types: `div` (class), `button`/`h2`/`h3`/`span` (visible text, substring match), `input` (name attribute), `href` (link suffix), `testid` (`data-testid` attribute — preferred when the target app exposes test ids), `aria` (`aria-label` attribute — for icon buttons with no visible text). Set a step's optional `frameUrl` regular expression to resolve and act inside a dynamically mounted child frame; anchor it to a trusted HTTPS origin and stable path.
- Target URLs may embed `{{date}}` / `{{date+Nd}}` placeholders (`src/utils/date-template.ts`), resolved to a UTC `YYYY-MM-DD` at navigation time — for booking-style targets whose availability requires a future date
- Steps are converted to PuppeteerLocatorActions for execution
- Support for popup handling and complex user flows
- Whole-workflow recovery is bounded and fail-secure: retry only recognised transient browser failures in a fresh context, discard observations from the failed attempt, and never replay after a side-effect boundary. A click with `waitForResponse` is a boundary automatically; add `retryBoundary: true` to any other step whose dispatch may have an irreversible or externally visible effect. Keep `maxAttempts` between 1 and 3.
- `totp` actions type an RFC 6238 one-time code (6 digits / 30s, `src/utils/totp.ts`) generated at step-execution time. The step carries only a `seedRef` name; the base32 seed is supplied at runtime via the repeatable `--totp-seed <name>=<seed>` parameter and must never be committed to the inventory repo, logged, or included in alerts. If fewer than 5 seconds remain in the current window, execution waits for the next window before generating the code.

### Module Organization

- `src/handlers/` - Response handlers for scripts and headers
- `src/interfaces/` - TypeScript interfaces for services
- `src/repositories/` - Data access layer for inventories
- `src/stores/` - Storage implementations (Git, in-memory)
- `src/services/report/` - Auditor report: collector, mapper, deterministic JSON, self-contained HTML renderer, GitHub step summary
- `src/utils/` - Utility functions for hashing, parsing, and workflow conversion. Notably `json-position.ts` (JSON pointer → line/column, dependency-free) and `provenance.ts` (comparison result → the inventory file, pointer and line that authorised it)

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

- **Keep public examples generic**: This is an open-source project. Never add organization-, customer-, venue-, or deployment-specific application details to source comments, documentation examples, tests, fixtures, sample workflows, or sample inventories. This includes real hostnames, URLs, venue/account identifiers, email addresses, internal repository names, and copied production policies. Use clearly fictional names and RFC-reserved domains such as `example.com`, `example.org`, and `.test`. Public payment-provider names and their documented public endpoints may be used when the behavior is genuinely provider-specific. Authoritative project ownership, licensing, repository, and security-reporting metadata are not examples; do not rewrite them without explicit maintainer direction.
- **Never merge PRs without human review**: Do not merge any pull request that has not been reviewed and approved by a human. `main` branch protection requires a code-owner approval — do not bypass it. Specifically, never use admin/override merges (e.g. `gh pr merge --admin`) or otherwise circumvent required reviews and status checks. You may prepare a PR so it is ready to merge (fix CI, resolve conflicts, push), but a human must perform or explicitly authorize the final merge.
- **Commit messages**: Please use conventional commits and keep them concise. Tell us what value was created in the commit, not a catalog of changes.
- **Code review on commit**: Before creating a commit, run `/coderabbit:review --base main` and address its findings (or explain why a finding is intentional) as part of the same change. Treat CodeRabbit as a required review step alongside `npm run precommit` — precommit verifies correctness, CodeRabbit catches design/quality issues a static check won't.
- **CodeRabbit PR reviews are asynchronous**: passing the pre-commit CLI review is not the end of the CodeRabbit step. After opening a PR or pushing new commits to one, CodeRabbit posts inline review comments on the PR **5–15+ minutes later** — check for them before considering the work done (`gh api repos/<org>/<repo>/pulls/<n>/comments`, filtering `in_reply_to_id == null` for top-level findings; comments created after your last push are new). Silence shortly after a push means the review hasn't run yet, not that it found nothing. **The canonical per-round completion marker is the `Actionable comments posted: N` line in the latest `coderabbitai[bot]` entry of `/pulls/<n>/reviews`** — verified against this repo, 2026-08-07:

```bash
gh api repos/<org>/<repo>/pulls/<n>/reviews --jq '[.[] | select(.user.login|test("coderabbit"))] | last | {submitted_at, marker: (.body | split("\n")[0])}'
```

Do **not** grep the summary issue-comment for that phrase: CodeRabbit now renders a "Review Change Stack" walkthrough there instead, so the phrase never appears and a watcher keyed on it waits forever. The summary comment is still edited in place per round, so its `updated_at` is a usable _change_ signal — but the verdict itself lives in the review object. While a round is running, the summary comment contains `review in progress`. Counting new inline comments is still unreliable on its own: a clean round adds none. Poll with a persistent Monitor keyed on that marker rather than a fixed-window loop that gives up — CodeRabbit is frequently slow (10+ min, occasionally ~50 min), and rounds that land after a fixed window are silently missed. Compare timestamps in a single timezone (its `Z`, not a local `+NN:00` offset). Address or rebut every finding and reply on its thread with the fix commit. On repos with auto-review enabled, every new push triggers a fresh review round automatically; re-check after each push until a round comes back clean.

- **Do not merge a PR before its CodeRabbit round has returned**: merging while a review is still in flight strands the findings on a merged PR and forces a follow-up PR for every fix. Only mark a PR ready to merge once the latest push's round has landed and come back clean (or every finding has been addressed/rebutted on-thread).
- **Repos with auto-review disabled** (e.g. the script-inventory repo): CodeRabbit posts a "Review skipped" notice instead of reviewing, and pushes never trigger rounds automatically. Comment `@coderabbitai review` on the PR to trigger a round — after every push, since nothing runs on its own — then wait for it like any other round.
- **Always link PRs, issues, and CI runs every time they are mentioned**: every reference in a chat response, PR description, or comment must carry its own clickable full URL (or an auto-linking `owner/repo#N` form) in that same message. Repeat the link on later mentions instead of relying on an earlier message or nearby context; never use a bare number that makes the reader scroll or search for the link.
- **2nd code review on commit**: Before creating a commit, run the vendored `branch-review` skill (`.claude/skills/branch-review/SKILL.md`) over the pending change — the `staged` scope for a commit, the whole branch before opening a PR — and address its findings (or explain why a finding is intentional) as part of the same change. Treat this as a required review step alongside `npm run precommit` — precommit verifies correctness, branch-review's multi-agent pass catches defects and design issues a static check won't. It replaces the old `/review` and pre-PR `/code-review` steps, which Claude cannot invoke (`/code-review` remains available for humans to run as an extra independent engine).
- **Update README.md**: Ensure that you consider any updates to user facing documentation as part of any changes.
- **Inline-script classifiers are tech-generic only**: matchers in `src/utils/script/inline.ts` classify a technology (framework/vendor-emitted snippets), never a site. Only add one when the snippet is attributable to the framework or vendor's own source or documentation — cite the evidence in the matcher's comment. Anything application-specific belongs in the target's inventory entry (the inventory workflow generates an anchored content-snippet matcher for unrecognised inline scripts, combined with the initiator host when the initiator URL is available).
