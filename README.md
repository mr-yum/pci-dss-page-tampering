# PCI DSS Page Tampering

A PCI DSS compliance system implementing requirements 6.4.3 (Script Management) and 11.6.1 (Detection and Alerting) to prevent page tampering and e-skimming attacks on payment pages.

Note: This repository is largely agent developed.

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
npm start -- \
  --repo $INVENTORY_REPO_URL \
  --git-token $INVENTORY_REPO_PAT \
  --slack-token $SLACK_OAUTH_TOKEN \
  --git-user-name $GIT_USER_NAME \
  --git-user-email $GIT_USER_EMAIL
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
  --inventory-branch inventory-updates \
  --detection-branch main
```

**Local testing with file:// protocol:**

```bash
npm start -- \
  --repo file:///path/to/local/inventory \
  --git-token dummy
```

## Workflows

The system runs one of four modes via `--mode`:

- **`inventory`** — visits staging/inventory URLs, discovers scripts and headers, pushes updates to the `inventory-updates` branch of the inventory repo, and opens a PR for review. Alerts on resources that need manual authorization.
- **`detection`** — visits production/detection URLs, compares what's loaded against the approved inventory on `main`, and alerts on anything unauthorized. Read-only against the inventory repo.
- **`all`** (default) — runs `inventory`, then `detection`.
- **`validate`** — runs as a CI check inside the inventory repo. Fully deserializes every `targets/*.json` (Zod schema, `createMatcher()`, workflow resolution) so malformed inventory cannot merge. No browser, no alerts, no push.

The intended day-to-day cycle:

1. Inventory mode (against staging) discovers new scripts/headers, pushes them to `inventory-updates`, and opens a PR.
2. A human reviews the PR, adds authorization metadata for legitimate resources, and merges to `main`.
3. Detection mode (against production) reads from `main` and alerts on anything unauthorized.

See [Branch Usage](#branch-usage) for the branch model and [CI Validation for the Inventory Repo](#ci-validation-for-the-inventory-repo) for the CI wiring.

## CLI Parameters

### Required Parameters

| Parameter             | Description                                                                                              | Example                            |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `--repo <url>`        | Inventory repository URL (HTTPS or file://)                                                              | `https://github.com/org/inventory` |
| `--git-token <token>` | Git authentication token (required for HTTPS; optional only for `--mode validate` with a `file://` repo) | `${{ secrets.GITHUB_TOKEN }}`      |

### Optional Parameters

| Parameter                   | Description                                                    | Default                      |
| --------------------------- | -------------------------------------------------------------- | ---------------------------- |
| `--mode <mode>`             | Execution mode: `inventory`, `detection`, `all`, or `validate` | `all`                        |
| `--target <name>`           | Process specific target (e.g., "1.0")                          | all targets                  |
| `--slack-token <token>`     | Slack token for alerts (logs to console if omitted)            | -                            |
| `--inventory-branch <name>` | Branch for inventory operations                                | `inventory-updates`          |
| `--detection-branch <name>` | Branch for detection operations                                | `main`                       |
| `--git-user-name <name>`    | Git committer name for inventory updates                       | `PCI DSS Page Tampering Bot` |
| `--git-user-email <email>`  | Git committer email for inventory updates                      | `noreply@example.com`        |
| `--help`                    | Display help message and exit                                  | -                            |

## Branch Usage

The system uses different branches for different purposes:

### Inventory Branch (`--inventory-branch`)

- **Purpose**: Updates baseline inventory with newly discovered scripts/headers
- **Default**: `inventory-updates`
- **Behavior**: Reads from and pushes changes to this branch
- **Use case**: Staging/development environment monitoring to update approved resource list

### Detection Branch (`--detection-branch`)

- **Purpose**: Read-only comparison against stable inventory
- **Default**: `main`
- **Behavior**: Reads from this branch, never pushes changes
- **Use case**: Production monitoring against approved baselines

### Recommended Branch Strategy

1. **Inventory workflow** → `inventory-updates` branch
   - Runs against staging/inventory URLs
   - Adds new scripts/headers as they're discovered
   - Creates alerts for resources needing manual authorization

2. **Detection workflow** → `main` branch
   - Runs against production/detection URLs
   - Compares against stable, reviewed inventory
   - Alerts on any unauthorized changes

3. **Review process**:
   - Review changes in `inventory-updates` branch
   - Add authorization metadata for legitimate resources
   - Merge to `main` after approval
   - Detection workflow now recognises these resources as authorized

### Example: Separate Review Workflow

```bash
# Step 1: Run inventory to discover new resources
npm start -- \
  --mode inventory \
  --inventory-branch inventory-updates \
  --repo https://github.com/org/inventory \
  --git-token <TOKEN>

# Step 2: Review and approve changes in inventory-updates branch
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
      --inventory-branch inventory-updates \
      --detection-branch main \
      --git-user-name 'PCI DSS Bot' \
      --git-user-email 'pci-bot@example.com'
```

### Bundled Workflows

Three GitHub Actions workflows ship with this repo under [.github/workflows/](.github/workflows/):

#### [ci.yml](.github/workflows/ci.yml) — Continuous Integration

Runs on every push to `main`, every pull request, and on manual dispatch. Installs dependencies, audits them at `--audit-level=high`, then runs linting, type checking, unit tests, and integration tests on Node 24. This is the gate that protects `main`.

#### [inventory-and-detection.yml](.github/workflows/inventory-and-detection.yml) — Scheduled monitoring

The production runner. Triggers:

- **Scheduled**: daily at 12:00 UTC (overnight in AU). Runs `--mode all` against every target.
- **`workflow_dispatch`**: manual run with optional `mode` (`all` / `inventory` / `detection`) and `target` inputs — useful for ad-hoc inventory sweeps or re-running detection after a fix.
- **Push to `main`**: runs after merges so newly-approved inventory takes effect immediately.

Requires repo secrets `INVENTORY_REPO_PAT` and `SLACK_OAUTH_TOKEN`, and repo variables `INVENTORY_REPO_URL`, `GIT_USER_NAME`, `GIT_USER_EMAIL`. Installs Chrome system dependencies for Puppeteer before invoking `npm start`.

#### [auto-merge-renovate.yml](.github/workflows/auto-merge-renovate.yml) — Renovate auto-merge

Listens for completed CI runs (via `workflow_run`) and, when the run was triggered by a `renovate[bot]` PR and succeeded, approves and squash-merges the PR. Gating on `workflow_run` (rather than `pull_request`) ensures CI has actually passed before merging — the previous `pull_request` setup let broken lockfiles land on `main`.

For wiring `--mode validate` into the **inventory repo's** CI (a separate repo), see [CI Validation for the Inventory Repo](#ci-validation-for-the-inventory-repo) below.

## CI Validation for the Inventory Repo

The `validate` mode is designed to run as a pre-merge CI check in the script-inventory repository. It exercises the same code paths the runtime tool uses to load inventory files, so anything that passes CI will also load in production.

### What validate mode does

1. Clones the inventory repo (supports `file://` for the CI's local checkout) and switches to the requested branch.
2. Reads every `targets/*.json` file.
3. Parses each file with `RawInventorySchema` (catches bad regex patterns, missing fields, malformed hashes, unsupported matcher shapes).
4. Runs `createMatcher()` on every `identifyWith` and `authoriseWith` tree (catches any matcher construction failures that slip past schema).
5. Resolves every `workflow` reference via `WorkflowDefinitionSchema` (catches dangling workflow files and malformed workflow definitions).
6. Exits 0 on success, or non-zero with a contextual error message on failure.

It does **not** launch Puppeteer, hit the monitored URLs, send alerts, or push any changes.

### Local invocation

Against a local checkout of the inventory repo:

```bash
npm start -- --mode validate --repo file://$PWD
```

`--git-token` is not required when `--repo` is a `file://` URL in validate mode.

### Exit codes

| Code | Meaning                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | All inventory files fully deserialize                                                                                                      |
| 1    | CLI argument validation error (malformed `--repo`, missing `--git-token` for HTTPS, etc.)                                                  |
| 2    | Inventory or execution error (schema failure in an inventory file, invalid regex, malformed matcher, missing workflow file, clone failure) |

For inventory-file validation failures, exit-2 messages name the offending file — e.g. `Validation failed for inventory file '1.0.json': Invalid regex in nameMatcher at "scripts.0.identifyWith.nameMatcher"`. Pre-read failures (clone failures, branch checkout errors) surface the underlying git error without a file qualifier.

### GitHub Actions wiring (for the script-inventory repo)

Check out this tool alongside the inventory repo and run validate mode against the inventory's working tree. Pass `GITHUB_HEAD_REF` as `--inventory-branch` so the validation runs against the PR branch rather than the default branch.

```yaml
jobs:
  validate-inventory:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout inventory repo
        uses: actions/checkout@v4
        with:
          path: inventory
          fetch-depth: 0

      - name: Checkout validation tool
        uses: actions/checkout@v4
        with:
          repository: mr-yum/pci-dss-page-tampering
          path: tool

      - name: Install tool dependencies
        working-directory: ./tool
        run: npm ci

      - name: Validate inventory
        working-directory: ./tool
        env:
          INVENTORY_BRANCH: ${{ github.head_ref || github.ref_name }}
        run: |
          npm start -- \
            --mode validate \
            --repo file://$GITHUB_WORKSPACE/inventory \
            --inventory-branch "$INVENTORY_BRANCH"
```

Notes:

- `fetch-depth: 0` on the inventory checkout ensures all branches are available so simple-git can clone from `file://` and switch to the PR branch.
- `github.head_ref` is only set on `pull_request` events; `github.ref_name` covers direct pushes. The example falls back between the two.
- If the inventory repo's CI needs to validate `main` rather than the PR branch, omit `--inventory-branch` (defaults to `inventory-updates`) or pass `main` explicitly.

## Local Testing with GitHub Actions

Requires `.env.secrets` file:

```
# .env.secrets
INVENTORY_REPO_PAT=<PAT secret>
```

Run locally:

```bash
act push --container-architecture linux/amd64 --secret-file .env.secrets
```

## Inventory Schema

Each inventory file (`targets/<name>.json`) lists the scripts and headers approved for a target. Each entry uses two matchers:

- `identifyWith` — picks out the script or header (e.g. by URL or header name)
- `authoriseWith` — describes what content/hash is acceptable, with `authorisationInfo` metadata

Matcher fields always operate on what their name says: `nameMatcher` on the script URL / inline id (`headerNameMatcher` on the header name), `contentMatcher` on the actual content (external script response body, inline script source, or header value — never the URL), `hashes` on the SHA-256 of that content, and `hostMatcher`/`urlMatcher` on the resource's provenance URL. To authorize a script by where it comes from, use `urlMatcher` or `hostMatcher`, not a URL-shaped `contentMatcher`.

### Inline Script Names

External scripts are named by their URL; inline scripts have no URL, so the system assigns them a stable `inline_script/...` name that inventory entries can match with `nameMatcher`:

- **`inline_script/<element-id>`** — used when the `<script>` element carries a DOM `id` attribute (e.g. a script tag your application renders as `<script id="facebookPixel">` is named `inline_script/facebookPixel`).
- **Convenience names for known tech types** — scripts that frameworks and edge vendors generate on _any_ site that uses them are recognised by their canonical snippet and given a shared, human-readable name. This keeps one inventory entry per technology instead of one per anonymous script:

  | Name                                   | Technology                                                                                     |
  | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | `inline_script/cloudflare-bot-fight`   | Cloudflare Bot Fight Mode challenge loader (injected by Cloudflare on any protected site)      |
  | `inline_script/nextjs-ssr`             | Next.js App Router flight-data scripts (`self.__next_f.push(...)` and its initialiser variant) |
  | `inline_script/react-server-component` | React streaming-SSR inline runtime (`$RC`/`$RS`/`$RB`/`$RV`/`$RT` bootstrap globals)           |
  | `inline_script/react-hydration-timing` | react-dom server renderer's paint-timing snippet (`requestAnimationFrame(...$RT=...)`)         |

  These names classify a **technology, never a site**: each recogniser is attributable byte-for-byte to the framework or vendor's own source code, so it holds for every site built on that stack. Application-specific inline scripts must never be added to this list — they belong in the target's inventory file, where the system identifies them by provenance instead (see below).

- **`inline_script/id_not_found`** — the shared fallback for anything unrecognised. Because many distinct scripts can carry this name at once, it can never identify a script; when the inventory workflow discovers one, it generates a content-based entry instead: an anchored snippet of the script body (`contentMatcher`, both ends anchored when the whole body fits the window), combined under an `andMatcher` with the initiator host (`hostMatcher`) whenever the initiator URL is available and parseable. The entry is ready for a human to review and authorise.

### Simple Matcher

```json
{
  "identifyWith": { "nameMatcher": "^https://cdn\\.example\\.com/analytics\\.js$" },
  "authoriseWith": {
    "hashes": [{ "timestamp": "2025-10-21T12:00:00.000Z", "hash": { "value": "abc..." } }],
    "authorisationInfo": {
      "description": "Analytics script for conversion tracking",
      "authorised": true,
      "date": "2025-10-21T12:00:00.000Z"
    }
  }
}
```

### Composite Matchers

For complex authorization policies, `authoriseWith` supports composite matchers:

- **AND Matcher**: authorize only if ALL children succeed (e.g. CSP with multiple required directives)
- **OR Matcher**: authorize if ANY child succeeds (e.g. accept production OR staging policy)
- **Array syntax**: syntactic sugar for OR matcher (multiple acceptable versions)

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

**Array syntax** (multiple script versions):

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

### HostMatcher / UrlMatcher (provenance)

Every detected resource carries a single `url` field that captures where it
came from — for response headers it's the URL of the response that emitted
the header, for external scripts it's the script's own URL, and for inline
scripts it's the URL of the script that initiated the insertion (captured
at insertion time via a `MutationObserver`-style shim, falling back to the
page's own URL for parser-inserted inline scripts).

`hostMatcher` derives the host portion of that URL and matches a regex
against it — use when the inventory only cares about origin. `urlMatcher`
matches the full URL — use when path precision matters.

**HostMatcher under AndMatcher** — restrict a CSP entry to a single origin:

```json
{
  "identifyWith": {
    "andMatcher": [{ "headerNameMatcher": "^content-security-policy$" }, { "hostMatcher": "^([^.]+\\.)*meandu\\.app$" }]
  },
  "authoriseWith": [
    {
      "contentMatcher": "^default-src 'self'$",
      "authorisationInfo": { "description": "First-party CSP baseline", "authorised": true, "date": "2026-05-19T00:00:00.000Z" }
    }
  ]
}
```

This entry matches a `content-security-policy` header **only** when its
response came from a `*.meandu.app` host. The same `default-src 'self'`
emitted by a third-party domain (e.g. Stripe) will not match this entry —
operators can decide whether to add a separate entry for it or treat it
as a violation.

**UrlMatcher** — restrict an external (or inline-via-initiator) script to
a specific URL pattern:

```json
{
  "identifyWith": { "urlMatcher": "^https://m\\.stripe\\.network/out-[0-9.]+\\.js$" },
  "authoriseWith": {
    "hashes": [{ "timestamp": "2026-05-19T00:00:00.000Z", "hash": { "value": "abc..." } }],
    "authorisationInfo": { "description": "Stripe outer-window utility", "authorised": true, "date": "2026-05-19T00:00:00.000Z" }
  }
}
```

Because inline scripts are also tagged with their initiator's URL, the
same `hostMatcher` / `urlMatcher` semantics apply to inline entries —
useful when a third-party loader injects inline `<script>` elements and
you want the inventory to refuse anything that's _not_ initiated by an
approved origin.

### Validating Inventory

To validate every inventory file in a local checkout of the inventory repo, use `--mode validate`:

```bash
npm start -- --mode validate --repo file://$PWD
```

Validate mode runs the full deserialization pipeline used at runtime — Zod schema parsing, `createMatcher()` construction for every `identifyWith`/`authoriseWith` tree, and workflow file resolution — so anything that parses here will also load at production execution time. See [CI Validation for the Inventory Repo](#ci-validation-for-the-inventory-repo) above for the GitHub Actions wiring.

### Common Validation Errors

| Error                  | Solution                                    |
| ---------------------- | ------------------------------------------- |
| Invalid regex pattern  | Test regex: `new RegExp("your-pattern")`    |
| Missing required field | Add both `identifyWith` and `authoriseWith` |
| Invalid SHA256 hash    | Ensure 64 lowercase hex characters          |
