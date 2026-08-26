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

The system is configured entirely via command-line parameters. No environment variables are used for execution configuration. (When running under GitHub Actions, the runner's standard `GITHUB_*` variables are read solely to annotate the auditor report with CI provenance and to append its job-summary digest — they never influence what the run does.) One deliberate carve-out: `--mode rum-compare` authenticates to AWS with ambient credentials/region from the environment (e.g. OIDC-assumed role in CI), never via CLI parameters — credentials do not belong on command lines.

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

| Parameter                   | Description                                                                                                      | Default             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| `--mode <mode>`             | Execution mode: `inventory`, `detection`, `all`, `validate`, or `rum-compare`                                    | `all`               |
| `--target <name>`           | Process specific target (e.g., "1.0")                                                                            | all targets         |
| `--slack-token <token>`     | Slack token for alerts (logs to console if omitted)                                                              | -                   |
| `--inventory-branch <name>` | Branch for inventory operations                                                                                  | `inventory-updates` |
| `--detection-branch <name>` | Branch for detection operations                                                                                  | `main`              |
| `--totp-seed <name>=<seed>` | Named base32 TOTP seed for `totp` workflow steps (repeatable)                                                    | -                   |
| `--rum-queue-url <url>`     | SQS queue URL (or `file://` dir for local testing) of novel RUM observations; required with `--mode rum-compare` | -                   |
| `--report-dir <path>`       | Directory for auditor report artefacts (HTML + JSON)                                                             | - (no report)       |
| `--help`                    | Display help message and exit                                                                                    | -                   |

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

# Compare queued real-user observations against the inventory
npm start -- --mode rum-compare --repo https://github.com/org/inventory --git-token $TOKEN --rum-queue-url https://sqs.ap-southeast-2.amazonaws.com/123456789012/rum-novel-observations --slack-token $SLACK_TOKEN

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
- **`rum-compare`**: Drains first-sighting observations reported from real user sessions and evaluates them against the inventory with the same matcher pipeline: detection-pass observations raise `rum_*` alerts; inventory-pass observations feed the candidate PR flow. Read-only except for candidate PRs; hourly scheduling lives in the inventory repository. Requires `--rum-queue-url`.

For detailed implementation documentation, see `specs/008-refactor-the-code/quickstart.md`.

## Commands

### Development

- `npm run start -- [OPTIONS]` - Run with CLI parameters (see CLI Usage above)
- `npm run develop` - Build in watch mode for development
- `npm run build:js` - Build TypeScript to JavaScript
- `npm run build:agent` - Bundle the browser RUM agent (esbuild IIFE → `dist/agent/agent.js`, SRI hash printed)
- `npm run build:collector` - Bundle and zip the ingest Lambda (→ `dist/collector/ingest.zip`)

### Testing

- `npm run test:unit` - Run unit tests (Jest projects `unit`, node, covering `src/` and `collector/src/`; and `unit-agent`, jsdom, covering `agent/src/`). Narrow a run with `-- --testPathPatterns <regex>`; `--selectProjects` cannot be narrowed this way because the script already sets it
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

### RUM surveillance (`--mode rum-compare`)

A second observation lane, independent of Puppeteer. The synthetic passes walk one scripted checkout per target; real users walk everything else — every route, every experiment arm, every error path — so this lane watches live sessions and feeds their findings into the same matcher pipeline. Four components joined by one wire contract:

1. **Browser agent** (`agent/`) - a dependency-free IIFE (`npm run build:agent` → `dist/agent/agent.js`, SRI printed) embedded **site-wide, not just on the payment page**: an injection that lands two soft navigations before checkout still belongs to the session that reaches it (FR-001). Attribution dictates its shape. `Node.prototype.appendChild`/`insertBefore` are patched (call through first, then observe) because at insertion time `document.currentScript` still names the inserting script, while inside a MutationObserver callback — a microtask running after the inserter finished — it is already null, so a pure-observer design cannot attribute at all. The MutationObserver (childList+subtree) and a buffered `PerformanceObserver` (`type: 'resource'`) are safety nets for what the patch cannot see (parser-inserted markup, `innerHTML`, fetches predating the agent); they capture unattributed and fall back to the document URL. A document-level `securitypolicyviolation` listener captures CSP violations. Observer callbacks only enqueue (`agent/src/capture.ts`); slicing, SHA-256 and dedupe are deferred to `requestIdleCallback` slots (`agent/src/fingerprint.ts`) — which is why an inline script travels as `{length, head, tail}` with 128-char **strict** prefix/suffix windows, and is not hashed at all above a 512 KB UTF-8 ceiling (`oversize: true` instead): a multi-megabyte bundle must never cost main-thread time on a payment page. Transmission is `navigator.sendBeacon` with a `text/plain` Blob (CORS-safelisted, so no preflight, and it survives page-hide), keepalive `fetch` as fallback, split into beacons of ≤ 24 observations / ≤ 32 KB. Each flush cycle appends exactly one agent-health observation carrying the agent's own p95 task time and drop count, so the monitor's overhead is measured rather than asserted. Configuration is one attribute — `data-collector` on the agent's own script tag (`agent/src/agent.ts`); without it the agent stays inert. The bundle imports the beacon schema with `import type` only, so Zod never reaches the page
2. **Collector** (`collector/`) - an ingest Lambda behind a Function URL (`collector/src/ingest.ts`, `npm run build:collector` → `dist/collector/ingest.zip`). The ordering is the security property: the edge shared secret is verified with a constant-time compare **before the body is read**, so an unauthenticated request never buys a parse; then the `Origin` header is matched against the configured `ORIGIN_TARGETS` map, and that mapping is the **sole authority** on which target and which pass (`inventory` / `detection`) an observation belongs to — a page cannot nominate its own target. Every path returns **204 with an empty body**, auth failure and unmapped origin and schema rejection alike: a public endpoint must not be an oracle for what it accepts. Accepted beacons are archived **verbatim** to Firehose (stamped with target and receipt time, never rewritten) so the archive stays admissible evidence; each observation is then keyed for novelty in DynamoDB as `target#identity#initiatorHost` with a 90-day TTL. The SPA route is deliberately excluded from the key (a known script on a new route is not a new script) and the initiator host is deliberately included (a known script injected by a new origin is a supply-chain signal). Only **first sightings** reach SQS — repeat observations bump `last_seen`/`sessions` and stop there, which is what keeps a million sessions a day from becoming a million comparator messages. A second route, `POST /csp-reports`, accepts browser-native `report-uri` and Reporting API `report-to` payloads and maps them to synthetic `csp-violation` observations through the identical archive → novelty → enqueue pipeline
3. **Comparator** (`--mode rum-compare`, `src/rum/`) - drain → normalise → route. `drain.ts` reads through a queue adapter (`https://` SQS, or a `file://` directory for local development) under a strict delete discipline: a message is deleted only once routing succeeded, a schema-invalid body is dead-lettered without ever reaching the handler, and a handler throw leaves it for redelivery. `normalise.ts` binds an observation to a `Matchable` **without inventing content**: an external script gets `name`/`url` and `identificationOnly` (its body is opaque to a browser observer, so authorisation is not attempted), an inline script gets the client-computed hash plus _either_ full `content` (when the whole source fits one 128-char window) _or_ `contentEvidence` (`{length, head, tail}`) — never a `head…tail` reconstruction. That is what evidence-aware authorisation rests on: the same inventory entries judge RUM and synthetic observations, but each matcher decides on the evidence it actually holds, a window match authorises, and a window non-match fails secure because a match beyond the excerpt cannot be ruled out (see the Matcher System notes below). `route.ts` splits on the pass the collector stamped. The **detection lane** alerts — `rum_uninventoried_script_detected`, `rum_mismatched_script_detected`, `rum_csp_violation_reported` — each carrying prevalence (`first_seen`), the SPA route at first sighting, and the `inventoryRef` commit SHA the observation was judged against, so an alert states which baseline it disagreed with. CSP is **opt-in only**: it fires solely when `alerts.rum.cspViolationReported` is configured, with no fallback destination, because real-user CSP reports carry heavy browser-extension noise and a fallback would switch the category on for every existing inventory. The **inventory lane** never alerts and never authorises: unidentified observations become pending candidates (`authorised: false`) fed to the existing `InventoryService.diff` → push → PR flow. An inline observation that is identified but _unauthorised_ also becomes a candidate rather than a hash append — appending a hash to an authorised entry is de-facto authorisation, and a client-reported hash must never buy that
4. **Infrastructure** (`infra/`) - three Terraform modules: `collector-core` (Lambda + Function URL, Firehose → KMS-encrypted S3 archive, DynamoDB novelty table, SQS queue + DLQ, alarms, and the GitHub OIDC role the comparator assumes) plus `edge-cloudfront` and `edge-cloudflare`. Both edges authenticate to the origin by injecting an `x-collector-edge-key` shared secret rather than signing requests, for one hard reason: OAC/SigV4 signing of a POST requires the **client** to send `x-amz-content-sha256`, and `navigator.sendBeacon` cannot set headers — under OAC every beacon would be rejected at the Function URL. The collector runs with **no VPC** (no NAT, no ENI cold-start tax, nothing to misconfigure); the contract is enforced by `infra/tests/no-vpc-check.sh`, a source-level grep, because `terraform test` cannot assert the absence of a resource type across a plan. Alarms cover queue age (comparator drain stalled), ingest error rate and DLQ depth — and, the one that matters for 11.6.1, a **per-target beacon-volume anomaly alarm with missing data treated as breaching**, so an attacker who strips the agent to silence the monitor trips the alarm by the silence itself

The **beacon schema** (`src/types/beacon.ts`) is the three-way contract between producer (agent), validator (collector) and consumer (comparator), with fixtures in `test/fixtures/beacons/` imported by all three test suites so a breaking change fails at the seam rather than in production. Every string field is individually length-capped (URLs 2048, route 512, fingerprint windows 128, whole beacon 32 KB), which makes the schema _structurally_ incapable of carrying page content, cookies, form values or customer identifiers — the privacy guarantee is a shape, not a policy. Changes to it require security review.

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

- `identifyWith`: Matcher for identifying the resource (NameMatcher/HeaderNameMatcher/ContentMatcher/HashMatcher/HostMatcher/UrlMatcher/WorkflowMatcher/TargetTypeMatcher/CspDirectiveMatcher/OrMatcher/AndMatcher)
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
- **ContentMatcher** (`src/types/matcher/content-matcher.ts`) - Matches by content using regex patterns (case-sensitive, against actual content: external script bodies, inline script source, or header values — never the URL; use NameMatcher/UrlMatcher/HostMatcher for URL-based matching). Evidence-aware for real-user (RUM) inline observations whose full source never travels: a source that fits one 128-char fingerprint window evaluates as full content, while longer sources carry strict-prefix/suffix head/tail windows (`Matchable.contentEvidence`) against which only soundly evaluable patterns decide — a `^`-anchored pattern (no bare `$`) matching the head, or a `$`-anchored one (no bare `^`) matching the tail, is a sound accept; an anchored window non-match or an unanchored/whole-content pattern fails secure with an explicit bounded-excerpt reason (a match beyond the excerpt can never be ruled out)
- **HashMatcher** (`src/types/matcher/hash-matcher.ts`) - Matches scripts by SHA-256 hash (scripts only, for strict integrity verification). Its fail-secure gate is the **hash's** presence, not the content's: a missing or empty `Matchable.hash` denies with `hash is missing`, while null content is not pre-checked at all. Synthetic detections always carry both (and `compare()` pre-gates null content before any matcher runs), but a real-user inline observation legitimately arrives with a client-computed hash and no content, and gating on content would have made every such observation unauthorisable. Hash identification works, but inventory entries should normally identify by stable name/content/provenance and use hashes for authorization; otherwise changed bytes are classified as an unknown script instead of known unauthorized content.
- **HostMatcher** (`src/types/matcher/host-matcher.ts`) - Derives the host portion of `Matchable.url` on the fly and regex-matches against it. Use when the inventory cares about origin but not path (e.g. "any CSP from `*.checkout.example`"). Fails-secure when `url` is missing or unparseable.
- **UrlMatcher** (`src/types/matcher/url-matcher.ts`) - Regex-matches the full `Matchable.url` (host + path + query). Use when path precision matters (e.g. _"only `https://payments.example.com/sdk/client-v1.js`, not arbitrary paths"_). Fails-secure when `url` is missing.
- **InitiatorHostMatcher** (`src/types/matcher/initiator-host-matcher.ts`) - Derives the host of `Matchable.initiator` — the URL of whatever inserted or loaded the script — and regex-matches against it, so an entry can constrain WHO may load a script independently of the script's own URL: `andMatcher: [{ nameMatcher: "^https://cdn\\.example\\.net/sdk\\.js$" }, { initiatorHostMatcher: "^pay\\.example\\.com$" }]` alerts the moment the allow-listed SDK arrives via any other host. This is how the RUM novelty key's initiator dimension becomes an alert: the key re-queues a known script re-injected by a new source, and the inventory entry — never the collector — decides whether that matters, as loose or tight as the author wants. Evidence: RUM external and inline observations carry the initiator; synthetic inline scripts carry it from the page-attribution shim; synthetic external scripts carry it from the CDP request initiator (script-stack top frame, else the initiator/document URL — the same immediate-inserter semantics as the agent's `document.currentScript` capture). Fails secure when the initiator is missing or unparseable; headers never carry one, so it can never identify a header.
- **WorkflowMatcher** (`src/types/matcher/workflow-matcher.ts`) - Regex-matches `Matchable.workflowId` so a shared inventory entry can apply to one or more checkout variations. Fails secure when `workflowId` is missing or empty.
- **TargetTypeMatcher** (`src/types/matcher/target-type-matcher.ts`) - Regex-matches `Matchable.targetType` (`inventory` or `detection`), scoping an entry to one pass. `workflowMatcher` cannot do this: a workflow id names a checkout variation, and one variation owns both an inventory and a detection target, so it is live during both passes. Use it — normally inside an `andMatcher` — to authorise a staging-only origin without also trusting it on the production payment page, e.g. `andMatcher: [{ targetTypeMatcher: "^inventory$" }, { nameMatcher: "^https://sandbox\\.provider\\.example/.+$" }]`. Fails secure when the target type is missing or empty.
- **CspDirectiveMatcher** (`src/types/matcher/csp-directive-matcher.ts`) - Matches one Content-Security-Policy directive by its **set** of source expressions rather than the literal header text. Ordering is tolerated; any difference in membership — added _or_ removed — is flagged, and the reason names which sources moved and in which direction. Removals are deliberately not tolerated: some CSP sources only suppress others while present, so dropping the nonce from `script-src 'self' 'unsafe-inline' 'nonce-…'` makes `'unsafe-inline'` live, dropping `'strict-dynamic'` makes a scheme-source match every origin, and a bare `require-trusted-types-for` is enforcement off. Use for CSP directives instead of an anchored `contentMatcher`, which mints a fresh near-duplicate alternative on every reorder. `'nonce-*'` is the only wildcard and stands for exactly one per-response nonce; host wildcards are not expanded (`https://*.example.com` and `https://a.example.com` are different assertions); directive names are case-insensitive per the CSP spec. Emitted for newly discovered `content-security-policy` values by `newHeaderValueMatcherConfig` (`src/utils/header.ts`), which `ScriptInventoryService` uses on all three header-writing paths. A whole-header `identifyWith` needs one `authoriseWith` alternative per directive, since identification is first-match-wins.
- **OrMatcher** (`src/types/matcher/or-matcher.ts`) - Composite matcher implementing OR logic (authorizes if ANY child succeeds, first-match-wins). Pure delegation: the only thing it fails secure on itself is a missing resource (`Resource is missing`) — there is no composite content pre-gate, because each child already fails secure on the evidence _it_ needs, and a blanket content check would have denied hash-only real-user observations before the `hashMatcher` alternative could accept them
- **AndMatcher** (`src/types/matcher/and-matcher.ts`) - Composite matcher implementing AND logic (authorizes only if ALL children succeed). Same delegation contract as OrMatcher: missing resource denies, missing content does not

**Evidence-Aware Fail-Secure Principle**: every matcher fails secure on **its own** missing evidence and nothing else — `hostMatcher`/`urlMatcher` on a missing `url`, `hashMatcher` on a missing `hash`, `contentMatcher` on absent content or an excerpt its pattern cannot soundly decide, `workflowMatcher`/`targetTypeMatcher` on a missing identifier — while composites delegate. Real-user observations are legitimately partial (a hash with no body, anchored windows instead of content), so a matcher that pre-gated on evidence it does not consume would deny them wholesale instead of letting the evidence they _do_ carry decide. `src/types/matcher/matcher.interface.ts` carries the per-matcher table.

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

#### Authoring and Verifying Inventory Matchers

Two traps have each produced a matcher that looked correct, passed a hand-written check, and then never matched a single time in production — silently, for days, while the inventory lane papered over the gap. Both are worth knowing before writing an `authoriseWith` alternative:

- **`OrMatcher.authorize()` picks a child by `identify()`, not by trying each child's `authorize()`.** It takes the first child whose `identify()` returns true and authorises only that one (`src/types/matcher/or-matcher.ts`). So inside an `authoriseWith` array, an `andMatcher` alternative is skipped entirely when _any_ conjunct fails to **identify** — and the denial surfaces as the generic `No child matcher identified the resource`, which reads exactly like "this value isn't covered yet". When an alternative inexplicably never applies, test each conjunct's `identify()` in isolation before assuming the inventory is simply missing an entry.
- **A `urlMatcher` aimed at a _page_ must tolerate a query string and fragment** — end it `(?:[?#].*)?$`, never a bare `$`. Apps routinely reach a page through a redirect carrying something like `?return=…`, so a path-only end anchor can never match. (A matcher aimed at a script's own URL is different: those are exact, and a bare `$` is correct there.) This one is invisible in the auditor report, because `redactUrl()` renders `origin.url` as `origin + pathname` with query and fragment stripped — so a `Matchable` reassembled from report fields tests a URL shape production never emits.

Verify a new matcher by driving the real `createMatcher()` against content fetched from the live page, replicating `OrMatcher`'s identify-then-authorise selection, and include at least one URL carrying a query string. Never verify against a `Matchable` reconstructed from report fields alone. Assert the negatives too — the same body on another route, a lookalike host, a missing `url`, a prepended payload — since a matcher that authorises everything also "passes".

When reasoning about a run, three auditor-report fields have non-obvious semantics:

- `targets[].unmatchedInventoryEntries` lists entries that matched nothing in that pass. This is the evidence for retiring a stale entry — confirm it across every pass the entry is live for, and check the traffic isn't simply landing on a different target file.
- `observed.contentExcerpt` is a truncated prefix (`CONTENT_EXCERPT_LIMIT`, `src/services/report/mapper.ts`), so replaying report rows through content or hash matchers produces false negatives.
- `origin.url` is redacted as described above.

**A symptom worth recognising:** appending a hash for a genuinely new release is the normal, intended path. What is not normal is an entry collecting a _fresh_ hash on _every_ run: that means it identifies a payload which differs per request, so no hash can ever authorise it and the list grows without bound while verifying nothing. The tell is unbounded growth with no corresponding deploy. Establish which of the two you are looking at before appending another hash — the fix for the second is a matcher that authorises on the stable part of the payload, not one more hash.

#### Comparison Result Types (Enhanced 2025-10 with Metadata Paths)

**Script Comparison Results:**

- **UnknownScriptFound** (`src/types/comparison/unknown-script-found.ts`) - Script not in inventory or has null/empty content
- **KnownScriptWithUnauthorisedContentFound** (`src/types/comparison/known-script-unauthorised-content-found.ts`) - Script identified but authorization failed (includes matcher details, failure reason, and metadataPath for composite matchers)
- **AuthorizedScriptFound** (`src/types/comparison/authorized-script-found.ts`) - Script both identified and authorized (compliant, no alert; includes metadataPath for composite matchers)
- **MissingRequiredScript** (`src/types/comparison/missing-required-script.ts`) - Script entry configured with `requiredOn` for the current pass (`inventory`/`detection`) but no detected script was identified by its `identifyWith` (potential control removal — e.g. the RUM monitoring agent stripped from a payment page). Presence only: integrity of a present script stays with ordinary hash authorisation. Synthetic passes only, judged against the entry itself rather than first-match-wins attribution. On the **detection** pass it alerts to `detection.missingScriptDetected`, falling back to `scriptMismatchDetected`; on the **inventory** pass it routes to `inventory.newScriptIdentified` instead. `requiredOn` only arms for **authorised** entries (`authorisationInfo.authorised === true`): a pending/unauthorised entry's `requiredOn` is inert, because a candidate is flipped to `authorised: true` only after human review, and until then its absence is not yet a control removal

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
- `waitFor` selector types: `div` (class), `button`/`h2`/`h3`/`span` (visible text, substring match), `input` (name attribute), `href` (link suffix), `testid` (`data-testid` attribute — preferred when the target app exposes test ids), `aria` (`aria-label` attribute — for icon buttons with no visible text), `id` (`id` attribute — for hosted payment iframes whose fields carry no `name`, e.g. Toast's `credit_card_number`). Set a step's optional `frameUrl` regular expression to resolve and act inside a dynamically mounted child frame; anchor it to a trusted HTTPS origin and stable path.
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
- `src/rum/` - The `rum-compare` lane: queue drain and adapters, observation → `Matchable` normalisation, routing to alerts or inventory candidates
- `agent/` - Browser RUM agent (its own `tsconfig.json`, jsdom Jest project `unit-agent`, esbuild IIFE bundle). Page-bundle code: no runtime dependencies, types only
- `collector/` - Ingest Lambda (`src/`) plus `dev-server.ts`, a local stand-in that runs the real handler in-process against the filesystem
- `infra/` - Terraform modules for the collector and its two edge options, with `terraform test` suites and the no-VPC source guard under `tests/`
- `docs/rum/` - Adopter-facing deployment guide (`IMPLEMENTATION.md`) and the scheduled canary runbook (`canary-workflow.md`)

## Environment Requirements

- Node.js >= 24
- NPM >= 10 (Yarn/PNPM not supported)
- Chrome dependencies for Puppeteer (see GitHub Actions workflow)

## Configuration

**CLI Parameters Only**: The system no longer uses environment variables for runtime configuration. All configuration is provided via CLI parameters (see CLI Usage section above). The one deliberate exception is AWS access in `--mode rum-compare`, which uses ambient AWS credentials/region (e.g. OIDC in CI) rather than CLI parameters.

**For GitHub Actions**: Pass secrets via CLI parameters:

```yaml
run: |
  npm start -- \
    --repo https://github.com/org/inventory \
    --git-token ${{ secrets.INVENTORY_REPO_PAT }} \
    --slack-token ${{ secrets.SLACK_TOKEN }}
```

## Scheduled Execution

The daily run is scheduled from the **inventory repository**, not from this one. The auditor report's artefact contains the inventory verbatim, and this repository is public, so a scheduled run here would publish a private inventory. This repository keeps `workflow_dispatch` and `push: main` — both still full production runs, not dry runs.

- **Daily execution** at 12:00 PM UTC, from the inventory repository's own workflow
- **Inventory pass** runs first to update baselines
- **Detection pass** follows to monitor against updated inventory
- Only one repository should hold the schedule: two would run concurrently against the same inventory, and two `--mode inventory` passes would each push `inventory-updates` and open a PR

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

- **Resolve CodeRabbit threads after the final reply round — replying is not closing.** CodeRabbit auto-resolves threads it sees fixed, but a thread answered with a decline/rebuttal (and occasionally a fixed one) stays unresolved forever. Once every thread is either fixed-with-commit or rebutted on-thread, comment `@coderabbitai resolve` on the PR: it resolves all remaining CodeRabbit threads within about a minute. Verify with GraphQL (`reviewThreads(first: 100) { nodes { isResolved } pageInfo { hasNextPage endCursor } }` on the pull request, following `hasNextPage`/`endCursor` — the connection caps at 100 nodes per page, and an unpaginated check can false-pass a large PR) rather than assuming; do this even on an already-merged PR so the review record closes cleanly. Never use it to bury an unanswered finding — every thread must carry its fix reference or rebuttal first.

- **Do not merge a PR before its CodeRabbit round has returned**: merging while a review is still in flight strands the findings on a merged PR and forces a follow-up PR for every fix. Only mark a PR ready to merge once the latest push's round has landed and come back clean (or every finding has been addressed/rebutted on-thread).
- **Repos with auto-review disabled** (e.g. the script-inventory repo): CodeRabbit posts a "Review skipped" notice instead of reviewing, and pushes never trigger rounds automatically. Comment `@coderabbitai review` on the PR to trigger a round — after every push, since nothing runs on its own — then wait for it like any other round.
- **Always link PRs, issues, and CI runs every time they are mentioned**: every reference in a chat response, PR description, or comment must carry its own clickable full URL (or an auto-linking `owner/repo#N` form) in that same message. Repeat the link on later mentions instead of relying on an earlier message or nearby context; never use a bare number that makes the reader scroll or search for the link.
- **2nd code review on commit**: Before creating a commit, run the vendored `branch-review` skill (`.claude/skills/branch-review/SKILL.md`) over the pending change — the `staged` scope for a commit, the whole branch before opening a PR — and address its findings (or explain why a finding is intentional) as part of the same change. Treat this as a required review step alongside `npm run precommit` — precommit verifies correctness, branch-review's multi-agent pass catches defects and design issues a static check won't. It replaces the old `/review` and pre-PR `/code-review` steps, which Claude cannot invoke (`/code-review` remains available for humans to run as an extra independent engine).
- **Record project learnings here, not in agent memory**: when you discover something non-obvious about this system — a trap, a subtle contract, a verification technique that actually works, a symptom and what it means — write it into this file (or the closest relevant doc) as part of the same change. Do not stash it in an agent's private memory: teammates and other agents cannot read it, nobody reviews it, and it silently goes stale as the code moves. Guidance in the repo is versioned, reviewed, and inherited by every future session. Keep what you add generic, per the public-examples rule above: describe the mechanism and the failure mode, never the deployment, hostnames, or venue details — deployment-specific facts belong in the private inventory repository instead.
- **Update README.md**: Ensure that you consider any updates to user facing documentation as part of any changes.
- **Inline-script classifiers are tech-generic only**: matchers in `src/utils/script/inline.ts` classify a technology (framework/vendor-emitted snippets), never a site. Only add one when the snippet is attributable to the framework or vendor's own source or documentation — cite the evidence in the matcher's comment. Anything application-specific belongs in the target's inventory entry (the inventory workflow generates an anchored content-snippet matcher for unrecognised inline scripts, combined with the initiator host when the initiator URL is available).
