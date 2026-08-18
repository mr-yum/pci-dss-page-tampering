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

### Multiple checkout workflows

One inventory file can run several checkout variations while keeping a single
authorised `scripts` and `headers` list. Configure each variation as a named
staging/production pair under `target.workflows`. The following snippet is the
value of `target`, not a complete inventory file:

```json
{
  "workflows": [
    {
      "id": "workflow-a",
      "inventory": { "type": "inventory", "url": "https://staging.example.com/workflow-a", "workflow": "workflow-a-staging.json" },
      "detection": { "type": "detection", "url": "https://www.example.com/workflow-a", "workflow": "workflow-a-production.json" }
    },
    {
      "id": "workflow-b",
      "inventory": { "type": "inventory", "url": "https://staging.example.com/workflow-b", "workflow": "workflow-b-staging.json" },
      "detection": { "type": "detection", "url": "https://www.example.com/workflow-b", "workflow": "workflow-b-production.json" }
    }
  ]
}
```

Inventory mode runs every `inventory` member and combines all observations
before calculating one update. Detection mode runs every matching `detection`
member against that same reviewed inventory. Variations in one inventory execute
serially so they do not contend for the same application or payment-provider
resources. Inventory files also run serially because their hosted payment
frames share one browser process. The legacy `target.inventory` /
`target.detection` form remains valid and is treated as workflow `default`.

Use `workflowMatcher` anywhere another matcher can be used. It matches the
stable workflow `id`, so entries can be shared or scoped as narrowly as needed:

```json
{
  "identifyWith": {
    "andMatcher": [{ "workflowMatcher": "^workflow-b$" }, { "hostMatcher": "^payments\\.example\\.com$" }]
  },
  "authoriseWith": {
    "contentMatcher": "^approved content$",
    "authorisationInfo": {
      "description": "Workflow B resource",
      "authorised": true,
      "date": "2026-07-28T00:00:00.000Z"
    }
  }
}
```

Omit `workflowMatcher` when an entry should apply to every variation. Newly
discovered resources are generated with an exact workflow matcher so approving
one variation cannot silently approve another.

### Scoping an entry to one pass

A workflow id names a checkout _variation_, and a variation owns both an
inventory target and a detection target — so `workflowMatcher` is live during
both passes. It cannot, on its own, authorise something for staging without
also trusting it in production.

`targetTypeMatcher` matches the pass that observed the resource, `inventory` or
`detection`. Combine the two when an origin belongs to one environment only:

```json
{
  "identifyWith": {
    "andMatcher": [{ "targetTypeMatcher": "^inventory$" }, { "nameMatcher": "^https://sandbox\\.provider\\.example/.+$" }]
  },
  "authoriseWith": {
    "urlMatcher": "^https://sandbox\\.provider\\.example/",
    "authorisationInfo": {
      "description": "Provider sandbox SDK, loaded by the staging checkout only",
      "authorised": true,
      "date": "2026-08-18T00:00:00.000Z"
    }
  }
}
```

The `identifyWith` decides _when the entry applies_; the `authoriseWith` is what
grants trust. Scoped this way, the entry matches the provider's sandbox origin
only while the inventory pass runs against staging. On the detection pass the
same origin matches nothing, so it comes back as an unknown script and alerts —
which is the point: a staging-only origin never earns trust on the production
payment page. `targetTypeMatcher` fails secure when the target type is
missing.

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
| `--totp-seed <name>=<seed>` | Named base32 TOTP seed for `totp` workflow steps (repeatable)  | -                            |
| `--report-dir <path>`       | Directory for [auditor report](#auditor-report) artefacts      | - (no report written)        |
| `--help`                    | Display help message and exit                                  | -                            |

### TOTP Verification in Workflows

Workflows that must pass a one-time-password challenge (e.g. logging in to a payment flow behind MFA) can use a step action of type `totp`. It behaves like an `input` action, except the value is an RFC 6238 TOTP code (6 digits, 30-second window, HMAC-SHA1 — Google Authenticator-compatible) generated at the moment the step executes:

```json
{
  "description": "Enter one-time code",
  "waitFor": [{ "type": "input", "identifier": "otp" }],
  "action": { "type": "totp", "seedRef": "checkout-user" }
}
```

The workflow file carries only `seedRef` — a name. The seed itself is a durable credential and must **never** be committed to the inventory repository; supply it at runtime from a secret store:

```bash
npm start -- \
  --repo https://github.com/org/inventory \
  --git-token $TOKEN \
  --totp-seed checkout-user=$CHECKOUT_TOTP_SEED
```

`--totp-seed` is repeatable for multiple seeds. Seed values are validated as base32 at startup and never logged (startup logging prints seed names only). If a workflow references a seed name that wasn't provided, the target fails before any page navigation with an error naming the missing seed(s).

In the bundled GitHub Actions workflow, seeds are discovered by naming convention rather than hardcoded: every `<NAME>_TOTP_SEED` repository secret is passed as `--totp-seed <name>=<value>`, with the name derived from the prefix (`MY_TARGET_TOTP_SEED` → `my-target`). Adding a TOTP-protected target requires only a new secret — no workflow changes. When a step fires with less than 5 seconds left in the current TOTP window, the run waits for the next window so the code cannot expire mid-submission.

> **Note**: Automating TOTP means the second factor lives alongside the first in the same secrets store, which weakens what MFA provides for that account. Use a dedicated, least-privileged synthetic-monitoring account.

### Initial Workflow Timeout

Initial navigation, the first step's delay and selector wait, and any automatic
initial-page reloads share one five-minute deadline. Each navigation attempt is
limited to two minutes and receives no more than the time remaining in that
shared budget. If the first actionable element cannot be prepared in time, the
target fails with `Timed out preparing initial workflow content`; later steps
use their normal workflow or explicitly configured response timeout.

### Recovering a Transient Workflow Attempt

Workflows opt in to whole-workflow recovery by setting `retry.maxAttempts`
above one. Legacy workflows and definitions that omit the retry policy run
once, so missing boundary metadata can never enable unsafe replay. A retry
creates a new browser context and discards every script, header, cookie, and
storage value captured by the failed attempt. Only transient browser failures
such as timeouts, detached frames/contexts, and selected network resets are
retried. Configuration and trust failures still fail immediately.

Retries are allowed only before the workflow crosses a side-effect boundary.
A `click` with `waitForResponse` is a boundary automatically, because a failure
after dispatch cannot prove whether the remote operation occurred. Mark any
other potentially irreversible action explicitly on the step:

```json
{
  "description": "Confirm the external operation",
  "retryBoundary": true,
  "waitFor": [{ "type": "button", "identifier": "Confirm" }],
  "action": { "type": "click" }
}
```

The boundary is crossed immediately before action dispatch; a timeout while
waiting for its selector remains retryable. Nested popup steps use the same
rule. The workflow-level policy is optional:

```json
{
  "retry": { "maxAttempts": 3, "backoffMs": 2000 },
  "steps": []
}
```

`maxAttempts` includes the first attempt and is bounded to 1–3. `backoffMs` is
bounded to 0–30000 ms and receives a linear multiplier before later attempts.
Before opting in, audit every externally visible action and mark its boundary.

### Interacting with Embedded Payment Frames

Payment providers commonly isolate card fields in cross-origin iframes. Add a
`frameUrl` regular expression to a workflow step to run its `waitFor` selector
and action inside the first matching frame. Without `frameUrl`, the step runs
against the top-level page as usual:

```json
{
  "description": "Enter the test card number",
  "frameUrl": "^https://payments\\.example\\.com/card-frame",
  "waitFor": [{ "type": "input", "identifier": "cardnumber" }],
  "action": { "type": "input", "value": "<provider test card>" }
}
```

Not every hosted card form gives its inputs a `name`. Where the provider
identifies fields by `id` instead, use the `id` selector type:

```json
{
  "description": "Enter the test card number",
  "frameUrl": "^https://payments\\.example\\.com/assets/checkout\\.",
  "waitFor": [{ "type": "id", "identifier": "credit_card_number" }],
  "action": { "type": "input", "value": "<provider test card>" }
}
```

Anchor frame matchers to a trusted HTTPS origin and the narrowest stable path.
The frame is resolved when the step executes, so dynamically mounted payment
frames are supported. The same mechanism works in nested `clickPopup` steps.

For a later step whose pre-action target occasionally fails to mount, set
`"reloadOnMissingTarget": true` on its action. This option requires an anchored
trusted `frameUrl`, preventing a redirected top-level page from receiving the
configured input. The monitor waits 30 seconds, navigates once to the current
HTTPS URL using GET, then resolves the trusted frame target again using the
normal workflow timeout. This recovery neither resubmits a POST that produced
the page nor replays the step's action; use it only when a GET of the current
route safely reconstructs the required state.

### Waiting for a Click Response

When a click starts asynchronous validation without a stable completion screen,
set `waitForResponse` to the expected response URL. The response listener is
registered before the click, uses the page's normal workflow timeout, and waits
for the matching response body to complete. The option is click-only and can be
combined with `waitForNavigation` when both signals are required:

```json
{
  "description": "Submit payment details",
  "waitFor": [{ "type": "button", "identifier": "Submit" }],
  "action": {
    "type": "click",
    "waitForResponse": "^https://api\\.payments\\.example/v1/validate(?:\\?.*)?$",
    "waitForResponseTimeout": 240000,
    "waitForResponseMethod": "POST",
    "waitForResponseStatuses": [200, 402],
    "waitForResponseBody": "\"code\"\\s*:\\s*\"card_declined\"",
    "postActionDelay": 2500
  }
}
```

The matcher must start with an anchored, exact HTTPS origin; keep its path as
narrow and as late in the operation as the integration permits. A preliminary
tokenization response is usually too early when the workflow needs to observe
subsequent authentication or validation resources. Optional
`waitForResponseTimeout` sets a bounded 1–300000 ms override for unusually slow
provider validation; otherwise the page's normal workflow timeout applies.
`waitForResponseMethod`, `waitForResponseStatuses`, and
`waitForResponseBody` optionally constrain the completion signal so blocked,
failed, or semantically different responses cannot satisfy a successful
workflow accidentally. The body option is a regular expression tested against
the completed response bytes decoded as UTF-8. `postActionDelay` adds a bounded
1–300000 ms settling window after all action completion signals, before the
monitor performs its next script scan.

### Date Placeholders in Target URLs

Booking-style targets often need a future date in the URL — a hardcoded date goes stale, and "today" runs out of availability late in the day. Target URLs may embed `{{date}}` or `{{date+Nd}}` placeholders, resolved to a UTC `YYYY-MM-DD` at navigation time:

```json
{
  "url": "https://staging.guest.example.com/venue?view=times&partySize=2&date={{date+2d}}"
}
```

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
   - Reuses the update branch only while its pull request remains open; a
     branch with no open pull request is restarted from the current detection
     branch (`main` by default), and a replacement push is protected by
     `--force-with-lease`

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

## Auditor Report

Alerts describe exceptions. The auditor report describes **everything**: a full census of every script and header observed during a run, each mapped to the inventory matcher that authorised it — down to the file, JSON pointer and line number — together with the justification recorded against it.

Pass `--report-dir <path>` to produce one. Without the flag, no report is written and the run behaves exactly as before.

```bash
npm start -- \
  --mode detection \
  --repo https://github.com/org/inventory \
  --git-token <TOKEN> \
  --report-dir ./reports
```

### What an assessor gets

| Requirement                       | The question they ask                                    | Where the report answers it                                                            |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **6.4.3** inventory of scripts    | "Is every script on the payment page in your inventory?" | The full census — every row, including `status: "unknown"`                             |
| **6.4.3** written justification   | "Why is this script here?"                               | `authorisation.effective.description` and the full `authorisation.metadataPath` chain  |
| **6.4.3** authorisation           | "Who approved it, and when?"                             | `authorisation.effective.authorised` / `.date`, plus `inventoryEntry.raw` as committed |
| **6.4.3** integrity assurance     | "How do you know it has not changed?"                    | `observed.hash` and the authorising matcher (hash, anchored content, or provenance)    |
| **11.6.1** detection and alerting | "Show me the mechanism ran, and what it found."          | `run` (mode, inventory commit, time window, status) and every non-`authorised` row     |
| Both                              | "Where is this written down?"                            | `inventoryEntry.provenance` — `targets/2.0.json:184` plus the exact JSON pointer       |

The provenance is specific, not approximate: for an entry authorised by one of several hashes it points at `/scripts/7/authoriseWith/hashes/2`, the hash that actually matched — not the entry as a whole.

### Output layout

```text
<report-dir>/index.html                            links both passes
<report-dir>/inventory/report.{json,html}
<report-dir>/inventory/inventory/targets/*.json    the inventory that pass read
<report-dir>/detection/report.{json,html}
<report-dir>/detection/inventory/targets/*.json
```

The HTML page is self-contained — no network access, no fonts, no images — so it opens from a downloaded CI artefact on a machine with no connectivity. It supports filtering by type and status, free-text search and a "findings only" view, and remains complete with JavaScript disabled (so print-to-PDF captures everything). The JSON is the canonical machine-readable form.

One status filter starts **off**: **Not observed** — inventory entries that nothing on the page matched, either stale inventory or a resource that stopped loading. They are 6.4.3 hygiene signal rather than part of the census, so they are hidden until asked for. They are always present in the markup (and so in a JS-disabled read and in `unmatchedInventoryEntries` in the JSON); the filter only hides them. Being inventory entries rather than observations, they are exempt from the **Type** filter — an entry for a script may match an external or an inline one, so it belongs to neither bucket.

### The inventory travels with the report

Each pass ships a verbatim copy of the inventory files it read, under `<pass>/inventory/`. These are the exact bytes the provenance line numbers were computed against, so a reference like `targets/2.0.json:184` still resolves months later, when the branch has long since moved on — the artefact is self-contained evidence rather than a pointer at a moving target.

`run.inventorySources` lists each copy with its `sha256` and byte count, so an auditor can verify the copy was not altered after the fact, and can compare it against the commit named in `run.inventoryRef`:

```bash
jq -r '.run.inventorySources[] | "\(.sha256)  \(.copiedTo)"' detection/report.json | (cd detection && shasum -a 256 -c)
```

Each pass carries its own copy on purpose: under `--mode all` the two passes read different branches, so one shared copy would misrepresent at least one of them.

The tool always writes these copies when `--report-dir` is set. A publishing step may still strip them — this repository's own workflow does, see [In CI](#in-ci) — so "self-contained" describes what the tool emits, not necessarily what a given artefact carries.

> **Where you host the run matters.** These copies are the inventory repository's own bytes. If the workflow runs in a repository more widely readable than the inventory it monitors — a public repository monitoring a private inventory, say — the artefact publishes that inventory to everyone who can read the run. Host the run in the inventory repository itself, or exclude `**/inventory/**` from the upload as this repository's own workflow does.

<!-- markdownlint MD028: this comment keeps the two blockquotes distinct. -->

> **The copy is verbatim, and so is exempt from the redaction described below.** That is not an oversight — redacting it would change the byte count, break the `sha256` check against the committed file, and shift every line number the report cites, which is the whole point of shipping it. The redaction policy applies to what was _observed on the page_; the inventory is your own committed configuration, and the artefact reproduces it exactly as written. If a target URL in your inventory embeds a query token, expect to find it here. Treat the artefact as having the same sensitivity as the inventory repository itself, and scope who can download CI artefacts accordingly.

`--mode all` writes **two** reports, one per pass. The passes hit different URLs against different branches and evidence different requirements, and the inventory pass mutates the baseline mid-run — merged, a row's meaning would depend on which pass produced it. Both documents of a single invocation share a `run.correlationId`.

### What the report deliberately does not contain

- **Full script bodies.** `observed.hash` is the integrity anchor; `observed.contentExcerpt` is a 512-character excerpt for human recognition only. `contentLength` and `contentTruncated` are always present, so the truncation is itself auditable.
- **Query strings, fragments or credentials in URLs.** Removed before writing — from the script name, the `origin.url`, the content excerpt, and any URL embedded in a header value (a CSP `report-uri` commonly carries a per-request token). A signed URL or API key observed on the page cannot reach a CI artefact. The redacted form keeps a `[query-redacted]` marker, so an auditor can still see that a query was present.
- **Inventory files the run did not read.** The copy under `<pass>/inventory/` covers the targets that pass actually processed. Under `--target`, that is one file, not the whole repository — consistent with the partial-census labelling.
- **Raw control or bidirectional characters.** Replaced with a visible `⟨U+XXXX⟩` token, so a malicious excerpt cannot _render_ as something benign.

A run filtered with `--target` is labelled a **partial census** in both the document and the page banner; a run in which any target failed is marked `run.status: "partial"` with the failures named. A short census is never presented as a clean one.

### Diffing between runs

Report generation introduces no volatility of its own: rows are given a total order, and everything inherently run-specific is confined to the `run` and `generator` blocks. Two runs over identical observations produce byte-identical documents once those blocks are removed:

```bash
diff <(jq 'del(.run, .generator)' a/report.json) <(jq 'del(.run, .generator)' b/report.json)
```

Real payment pages do still change between runs, and the report reflects that faithfully rather than hiding it. Expect legitimate differences from per-response CSP nonces, third-party scripts whose bytes change between deploys, `blob:` URLs (the browser mints a fresh identifier each load), and signed or session-scoped URLs in header values. A difference in this diff means the page changed — which is exactly what the report exists to show.

### Compatibility

`schemaVersion` is semver. Additive optional fields bump the minor; removing a field, changing its type, or changing what a value means bumps the major. Consumers should gate on the major version and tolerate unknown fields.

### In CI

The bundled `inventory-and-detection.yml` workflow passes `--report-dir reports` and uploads the directory as an `auditor-report-<run-id>-<attempt>` artefact with `if: always()`, so the evidence survives a failed detection run — the run an assessor is most likely to ask about.

It deliberately excludes `**/inventory/**` from the upload, because this repository is public and the inventory it monitors is not. **That artefact is therefore not self-contained**: its `file:line` citations and the "Inventory as scanned" links have nothing to resolve against, and the `sha256` values in `run.inventorySources` can only be checked by someone who fetches the matching files from the inventory repository at the commit named in `run.inventoryRef`. A workflow hosted in the inventory repository uploads `reports/` whole and does not have this gap — which is why the scheduled run lives there. A digest of the findings is also appended to the GitHub Actions job summary.

The Slack success notification carries a **View run & download** button linking the workflow run page. That is deliberately the run page rather than the artifact itself: the artifact is uploaded by a workflow step that runs _after_ the tool exits, so it has no URL at the moment the notification is sent. The run page is the better destination regardless — the artefact is one click away, and the job-summary digest of findings renders on that same page. Outside CI the notification lists the written file paths instead.

> **Retention:** the workflow configures `retention-days: 90`. That is the ceiling for a public repository; private and internal repositories allow up to 400 days, and an organisation or enterprise policy may cap it lower still. Either way, PCI evidence retention is typically twelve months, so treat the artefact as a convenience copy, **not** the system of record. Archive it elsewhere if you need to satisfy a retention requirement.

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

#### [inventory-and-detection.yml](.github/workflows/inventory-and-detection.yml) — On-demand and post-merge monitoring

Triggers:

- **`workflow_dispatch`**: manual run with optional `mode` (`all` / `inventory` / `detection`) and `target` inputs — useful for ad-hoc inventory sweeps or re-running detection after a fix.
- **Push to `main`**: runs after merges so newly-approved inventory takes effect immediately.

There is **no schedule here.** The daily run moved to the inventory repository, because the auditor report's artefact carries that repository's files verbatim and this repository is public — see [In CI](#in-ci).

Both remaining triggers are still **full production runs** against the real inventory: `--mode all` writes to the inventory repository, opens a pull request there, and sends Slack alerts. They are not dry runs.

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

Hash matchers are valid in either block, but the usual inventory convention is
to identify a script by a stable name, content signature, or provenance and use
its hash for authorization. That way changed bytes remain associated with the
known script and produce a content-mismatch result. Use a hash in
`identifyWith` only when the exact byte-for-byte version is intentionally the
resource identity; a changed version will then be reported as unknown.

### Tracked response headers

The detector captures these headers:

| Header                      | Production capture scope                              | Canonicalisation                                                                        |
| --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | All responses (existing behaviour)                    | One observation per non-empty directive                                                 |
| `X-Frame-Options`           | Target-host document responses                        | Upper-case canonical token                                                              |
| `Strict-Transport-Security` | Target-host document responses, including redirects   | Case/order-normalised directives and numeric `max-age`                                  |
| `X-XSS-Protection`          | Target-host document responses                        | Normalised legacy policy; report URL credentials, query and fragment components removed |
| `X-Content-Type-Options`    | Target-host document, script and stylesheet responses | Lower-case canonical token                                                              |
| `Set-Cookie`                | All target-host responses, including redirects        | One redacted observation per cookie                                                     |

The same resource-type rules apply to a third-party response when an existing
inventory entry explicitly identifies that header and origin. Uninventoried
third-party security headers are excluded to avoid turning vendor response
churn into false-positive inventory growth.

`Set-Cookie` values and exact expiry timestamps are discarded before an
observation enters comparison, inventory, console output, Slack, or an AI
prompt. Inventory contains only the cookie name and security-relevant
attributes such as `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`,
`Partitioned`, `Max-Age`, whether `Expires` is future/expired/invalid, and
whether the value was empty. Distinct
`Set-Cookie` fields are split on Puppeteer's preserved newline separator,
never commas (`Expires` dates contain commas).

`X-XSS-Protection` is retained for change monitoring of legacy policy. New
inventories should normally authorise only `0`; CSP is the active XSS control.

### Required headers

An approved header entry can declare the response resource types on which it
must be present. This detects removal in addition to changed values:

```json
{
  "identifyWith": {
    "andMatcher": [{ "headerNameMatcher": "^strict-transport-security$" }, { "hostMatcher": "^pay\\.example\\.com$" }]
  },
  "authoriseWith": {
    "contentMatcher": "^max-age=31536000; includesubdomains$",
    "authorisationInfo": {
      "description": "One-year HSTS policy",
      "authorised": true,
      "date": "2026-07-28T00:00:00.000Z"
    }
  },
  "requiredOn": ["document"]
}
```

Required entries must contain one exact anchored `headerNameMatcher`. Their
identifiers may otherwise contain only `hostMatcher`, `urlMatcher`,
`workflowMatcher`, and `targetTypeMatcher` children
under `andMatcher`, because content-dependent matchers cannot be evaluated when
the header is absent. `requiredOn` values are validated against Puppeteer's
response resource types (for example `document`, `script`, and `stylesheet`),
so misspellings fail inventory validation instead of silently disabling the
check. `Set-Cookie` should not be blanket-required because many legitimate
responses do not issue a cookie.

Matcher fields always operate on what their name says: `nameMatcher` on the script URL / inline id (`headerNameMatcher` on the header name), `contentMatcher` on the actual content (external script response body, inline script source, or header value — never the URL), `hashes` on the SHA-256 of that content, `hostMatcher`/`urlMatcher` on the resource's provenance URL, and `workflowMatcher` on the configured workflow id. To authorize a script by where it comes from, use `urlMatcher` or `hostMatcher`, not a URL-shaped `contentMatcher`.

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

### CspDirectiveMatcher (Content-Security-Policy)

CSP header values are split per directive before matching, so each directive is authorised on its own. Authorising one with an anchored `contentMatcher` is brittle: the sources in a directive are an unordered set, so merely reordering them produces a semantically identical policy that nonetheless fails to match — and every reorder mints another authorised alternative, until real entries carry a dozen or more near-duplicates. (Dropping a source is a different matter: as the table below shows, a removal can genuinely widen a policy, which is why it is flagged rather than tolerated.)

`cspDirectiveMatcher` compares sets instead:

```json
{
  "identifyWith": {
    "andMatcher": [{ "headerNameMatcher": "^content-security-policy$" }, { "hostMatcher": "^checkout\\.example\\.com$" }]
  },
  "authoriseWith": [
    {
      "cspDirectiveMatcher": {
        "directive": "frame-src",
        "allow": ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://m.stripe.network"]
      },
      "authorisationInfo": {
        "description": "Payment provider frames on the checkout page",
        "authorised": true,
        "date": "2026-08-06T00:00:00.000Z"
      }
    },
    {
      "cspDirectiveMatcher": {
        "directive": "script-src",
        "allow": ["'self'", "'nonce-*'", "https://js.stripe.com"]
      },
      "authorisationInfo": {
        "description": "Nonce-gated scripts plus the Stripe SDK",
        "authorised": true,
        "date": "2026-08-06T00:00:00.000Z"
      }
    }
  ]
}
```

Note the **array**. `identifyWith` claims the whole header for that host, and identification is first-match-wins, so the entry needs one alternative per directive the page serves — a single-directive `authoriseWith` on a whole-header `identifyWith` would flag every other directive as unauthorised.

| Change to the observed policy | Result      | Why                                               |
| ----------------------------- | ----------- | ------------------------------------------------- |
| Sources reordered             | authorised  | A permutation is the same policy                  |
| A source added                | **flagged** | The reason names exactly which sources were added |
| A source removed              | **flagged** | Removals can _widen_ a policy — see below         |
| A different nonce value       | authorised  | `'nonce-*'` stands for one per-response nonce     |
| A second nonce added          | **flagged** | The placeholder is one-for-one, not a quantifier  |
| A different directive         | **flagged** | Wrong assertion entirely                          |

**Why removals are flagged.** "Fewer sources must be safer" is false for CSP, because some sources only suppress others while present:

| Approved                                       | Observed after a removal            | Effect                                                     |
| ---------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `script-src 'self' 'unsafe-inline' 'nonce-*'`  | `script-src 'self' 'unsafe-inline'` | `'unsafe-inline'` stops being ignored and becomes **live** |
| `script-src 'strict-dynamic' 'nonce-*' https:` | `script-src https:`                 | `https:` starts matching **every** HTTPS origin            |
| `require-trusted-types-for 'script'`           | `require-trusted-types-for`         | Trusted Types enforcement **off**                          |

Membership therefore has to match exactly, and every CSP change gets a human look. Ordering is the only thing safely tolerated.

Notes:

- `'nonce-*'` is the **only** wildcard. It stands for exactly one per-response nonce — a nonce is regenerated on every response, so pinning a value would fail on the next request. Two observed nonces against one `'nonce-*'` is a difference and is reported.
- Host wildcards are **not** expanded. `https://*.js.stripe.com` and `https://a.js.stripe.com` are different assertions, and a change between them is reported. The subject is the policy text, not the set of origins it resolves to.
- Directive names are matched case-insensitively, as CSP defines them; source expressions are case-sensitive.
- The inventory workflow emits this form automatically when it discovers a new `content-security-policy` value, collapsing the observed nonce to `'nonce-*'`. Other headers keep the exact-value `contentMatcher`, because for those the whole value is the assertion.

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
    "andMatcher": [{ "headerNameMatcher": "^content-security-policy$" }, { "hostMatcher": "^([^.]+\\.)*checkout\\.example$" }]
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
response came from a `*.checkout.example` host. The same `default-src 'self'`
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
