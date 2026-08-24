# RUM collector: implementation guide

Deploy real-user script surveillance from this repository alone — no values or knowledge private to any one organisation. Nine steps, in true dependency order; each is copy-paste material with fictional (RFC-reserved) example values you replace with your own.

What you end up with: an edge-fronted collector receiving metadata-only beacons from real sessions on your payment pages, an hourly comparator in your inventory repository judging first sightings against the same inventory the synthetic monitor uses, `rum_*` alerts in your security channel, and a permanent canary proving the whole path. Budget one working day.

**What this is not**: real-user surveillance is a breadth tripwire. The daily synthetic Puppeteer run remains the authoritative PCI DSS 11.6.1 control, and nothing here authorises anything — authorisation only ever happens through a human-approved inventory change.

## Before you start

| You need                       | Why                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An AWS account                 | The collector is Lambda + Firehose/S3 + DynamoDB + SQS. No VPC is created (a versioned contract).                                                                                                                     |
| CloudFront **or** Cloudflare   | One edge module each; pick one.                                                                                                                                                                                       |
| Terraform >= 1.7               | The modules require >= 1.7; the shipped `infra/examples/*` roots and the `terraform test` suites require **>= 1.11** (they use `override_during = plan`). `aws ~> 6.0`; the Cloudflare edge adds `cloudflare ~> 5.0`. |
| An inventory repository        | Existing `targets/*.json` inventory, as used by `--mode inventory` / `--mode detection`.                                                                                                                              |
| A release tag of this repo     | One tag ships `agent-vX.Y.Z.js` + SRI, `ingest-vX.Y.Z.zip` + SHA-256, the inventory entry, and the modules.                                                                                                           |
| Ability to edit the page shell | One `<script>` tag in the SPA shell's `<head>`, and one CSP change.                                                                                                                                                   |

Steps 1–2 are infrastructure, 3–5 are page-and-inventory changes, 6–7 are operations, 8 verifies, 9 keeps it healthy. Do not reorder: the agent has nowhere to report before step 1, and its beacons are discarded before step 2.

---

## Step 1 — Deploy the modules

Take `collector-core` plus one edge module at a single release tag. Both are consumed by source ref; nothing is copied into your repository.

```hcl
# Pin core and edge to the SAME tag — the ingest zip, the agent artefact and
# the module inputs move together across releases.
module "collector_core" {
  source = "github.com/mr-yum/pci-dss-page-tampering//infra/collector-core?ref=v1.0.0"

  name_prefix    = "rum"
  github_repo    = "example-org/script-inventory" # repo whose workflow assumes the comparator role
  origin_targets = var.origin_targets             # step 2
  lambda_package = var.lambda_package             # released ingest zip (or a local build)

  edge_auth = {
    mode   = "shared_secret"
    secret = var.edge_shared_secret
  }
}

module "edge_cloudfront" {
  source = "github.com/mr-yum/pci-dss-page-tampering//infra/edge-cloudfront?ref=v1.0.0"

  name_prefix         = "rum"
  origin_function_url = module.collector_core.function_url
  edge_shared_secret  = var.edge_shared_secret

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1 # CloudFront-scoped WAFv2 web ACLs exist only in us-east-1
  }
}
```

For Cloudflare, swap the second module for `infra/edge-cloudflare` with `origin_function_url`, `zone_id`, `record_name`, `edge_shared_secret`. Complete, applyable versions of both compositions are in `infra/examples/cloudfront-stack` and `infra/examples/cloudflare-stack` — start from whichever matches your edge.

**Both edges use the shared-secret pattern** (`edge_auth.mode = "shared_secret"`, edge injects `x-collector-edge-key`, the Lambda compares it in constant time before reading the body) because CloudFront's Origin Access Control is unusable for beacon traffic: OAC-signed POSTs require the _client_ to send an `x-amz-content-sha256` payload hash, and `navigator.sendBeacon` cannot set request headers, so every beacon would be rejected at the Function URL. The consequence is that a leaked secret means edge bypass until it is rotated in core and edge together — treat it as a production credential and protect the Terraform state, which holds it despite `sensitive = true`. Core's `aws_iam` mode remains valid only for SigV4-capable, non-beacon callers.

Inputs you will usually want to override in a real estate, each of which defaults to creating its own resource so the examples stand alone: `kms_key_arn`, `alert_sns_topic_arn`, `github_oidc_provider_arn` (one per account), `tags`. Retention and behaviour knobs: `archive_retention_days` (365), `novelty_ttl_days` (90), `queue_age_alarm_hours` (3). Edge knobs: `waf_rate_limit` (300 req/5 min/IP) and `max_body_kb` (32, capped at 64 by the WAFv2 body-inspection tiers) on CloudFront; `rate_limit_rpm` (60/min/IP) on Cloudflare.

Outputs you will use later: `collector_endpoint` (edge), and `function_url`, `queue_url`, `gha_role_arn`, `sns_topic_arn`, `metric_namespace`, `archive_bucket` (core).

### The wrapper rule (internal estates)

If you wrap these modules in an internal platform module, **compose, never rewrite**. Fork-and-edit is how a reference implementation dies: the upstream stops being exercised by the people who own it. Every internal need — an existing KMS key, an existing OIDC provider, a mandated tagging scheme, a pre-existing SNS topic — is already an injectable input, and anything that is not becomes an upstream pull request adding the seam. That constraint is also what keeps the published modules honest for external adopters.

If your Cloudflare zone already owns rulesets in the `http_ratelimit` or `http_request_late_transform` phases, merge the module's rules into them rather than applying the module as-is — Cloudflare allows one entrypoint ruleset per phase per zone. The zone must be in **Full (Strict)** TLS mode so the origin leg is verified.

---

## Step 2 — Configure the origin map

`origin_targets` is the sole authority on environment identity. The page is never trusted to declare its own environment: the collector reads the request's `Origin` header, looks it up in this map, and stamps the observation with the resulting `target_id` and `target_type`.

```hcl
origin_targets = [
  {
    # Staging checkout — real QA/internal sessions feed the INVENTORY pass,
    # so novel scripts become pending candidate entries for human review.
    origin      = "https://checkout.staging.example.com"
    target_id   = "1.0"
    target_type = "inventory"
  },
  {
    # Production checkout — feeds the DETECTION pass: alerts only, never
    # inventory writes.
    origin      = "https://checkout.example.com"
    target_id   = "1.0"
    target_type = "detection"
  },
  {
    # Dedicated pipeline canary (step 8). Its own target id, so its expected
    # alerts route to the ops channel and the security channel stays clean.
    origin      = "https://canary.example.test"
    target_id   = "canary"
    target_type = "detection"
  },
]
```

Rules that bite:

- **`origin` is an exact `scheme+host[+port]`** string, matched literally. `https://checkout.example.com` and `https://www.checkout.example.com` are different origins; list every one your pages actually serve from.
- **`target_id` must equal an inventory target name** — the `targets/<id>.json` file in your inventory repository, the same id you pass to `--target`. A typo here produces observations the comparator cannot judge.
- **`target_type` is `inventory` or `detection`**, validated at plan time. Staging origins go to `inventory`, production origins to `detection`.
- **Unmapped origins are dropped and counted**, never stored and never evaluated: the request still answers `204` (the no-oracle contract) and increments the `rum_unmapped_origin` metric. If beacons seem to vanish, check this metric first.

The shipped examples also carry a `1.0-canary` entry illustrating a _deployment_ canary (a canary release of the same checkout, monitored as its own target). That is a different idea from the pipeline canary above; you may want both, but only the pipeline canary is required by step 8.

Each distinct `target_id` in this map gets its own beacon-volume anomaly alarm (step 7), so keep the map tight.

---

## Step 3 — Amend the pages' CSP `connect-src`

The agent reports with `navigator.sendBeacon`, which `connect-src` governs. Add the collector endpoint to every monitored page's policy:

```
connect-src 'self' https://collect.example.com;
report-uri https://collect.example.com/csp-reports;
report-to collector;
```

The modern Reporting API names its endpoints in a separate **response header** rather than inside the CSP; send it alongside the `report-to` directive above (the group name must match):

```
Reporting-Endpoints: collector="https://collect.example.com/csp-reports"
```

`report-uri`/`report-to`/`Reporting-Endpoints` are optional but recommended: they point the browser's own CSP violation reports at the collector's second route, so violations still reach the pipeline when the agent itself is blocked or absent. If you serve the agent from a different origin than the page (step 4), that origin also needs to be in `script-src`.

**CSP-report alerting is opt-in.** Pointing the browser at the collector only makes the reports _recorded_ (archived and keyed for novelty); the comparator raises a `rum_csp_violation_reported` alert **only** when the target's inventory configures `alerts.rum.cspViolationReported`. Leave it unset and CSP reports stay recorded-only with no alert — deliberately, because real-user CSP reports carry heavy browser-extension noise and there is no fallback destination for this category. Configure `alerts.rum.cspViolationReported` on the target once you are ready to triage that stream.

**This is an inventoried header change.** Your CSP is already an inventory entry, almost certainly authorised by a `cspDirectiveMatcher` per directive — so adding the collector to `connect-src` fails authorisation until the inventory entry's source set is amended in the same change. Do it as one pull request: the page's new policy and the inventory's new expectation, reviewed together. The system inventorying its own telemetry channel is the point, not an inconvenience — the channel that would carry evidence of tampering is itself a monitored control.

Ship the CSP change and merge its inventory PR **before** step 4. An agent embedded against a policy that blocks it reports nothing, and silence looks identical to health until step 7's alarms have a baseline.

---

## Step 4 — Embed the agent

Take `agent-v1.0.0.js` and the SRI string printed in the release notes of the tag you pinned in step 1. Serve it from your own origin or CDN — the integrity hash is what pins the bytes, not the host.

```html
<head>
  <script src="https://static.example.com/rum/agent-v1.0.0.js" integrity="sha384-REPLACE_WITH_THE_RELEASE_SRI" crossorigin="anonymous" data-collector="https://collect.example.com"></script>
  <!-- everything else: other scripts, tag managers, preloads -->
</head>
```

- `data-collector` is the agent's **only** embedding configuration (one released artefact serves every adopter without a rebuild). Its value is the `collector_endpoint` output from step 1; the beacon path is `/`. Without the attribute the agent stays inert.
- `integrity` requires `crossorigin="anonymous"` whenever the artefact is cross-origin.
- **No `async`, no `defer`, no `type="module"`.** Deferred execution still finds the endpoint (the agent falls back to querying for the `[data-collector]` tag when `document.currentScript` is null), but it forfeits coverage.

**Why first in `<head>`**: the agent's only attribution-capable capture path is a patch on `Node.prototype.appendChild`/`insertBefore`, which sees the inserting script and therefore the initiator host that novelty identity keys on. Anything inserted before the patch installs is caught only by the MutationObserver safety net or by `PerformanceObserver({ type: 'resource', buffered: true })` — both of which recover the _script_ but not _who injected it_. Observers before anything else means attribution for everything else.

**Why the shell, not the route bundle**: one agent instance per session, surviving History-API soft navigations, stamping each observation with the route active at capture. Embedding it per route gives you repeated initialisation, gaps on every route the bundle does not cover, and no coverage of the routes an attacker actually reaches. Site-wide, session-long, one instance.

---

## Step 5 — Inventory the agent itself

The agent runs inside the environment it monitors, so it must be pinned like any other script — and its _absence_ must alert, or an attacker simply deletes the tag. The release ships the entry ready-made as `inventory-entry-v1.0.0.json`; paste it into your target's `scripts[]` array:

```json
{
  "identifyWith": { "nameMatcher": "^https://static\\.example\\.com/REPLACE-ME/agent-v1\\.0\\.0\\.js$" },
  "authoriseWith": {
    "hashes": [{ "timestamp": "2026-08-20T00:00:00.000Z", "hash": { "value": "<SHA-256 of the released bundle>" } }],
    "authorisationInfo": {
      "description": "pci-dss-page-tampering RUM agent v1.0.0, sha256-pinned release bundle. REPLACE-ME: point nameMatcher at the URL you serve the agent from, verify the hash against the bundle you deployed, then set authorised to true.",
      "authorised": false,
      "date": "2026-08-20T00:00:00.000Z"
    }
  },
  "requiredOn": ["inventory", "detection"]
}
```

It ships **`authorised: false` on purpose**. Two edits make it live, and both belong to a human in the pull request: anchor `nameMatcher` to the URL you actually serve the agent from (step 4), and confirm `hashes[0].hash.value` against `agent-v1.0.0.js.sha256` for the bundle you deployed. Only then flip `authorised` to `true`. Nothing in this system authorises itself, least of all the thing doing the watching.

Two independent checks ride on one entry: hash authorisation alerts when the agent is present but its bytes changed; `requiredOn` alerts (`missing_required_script`) when the daily synthetic run finds nothing on the page matching `identifyWith` — routed to `missingScriptDetected` (falling back to `scriptMismatchDetected`) on the **detection** pass, and to `newScriptIdentified` on the **inventory** pass. Both passes are listed because the agent belongs on staging pages too — step 2 maps staging origins to the inventory pass. Note this entry ships `authorised: false`, and `requiredOn` **only arms once the entry is authorised**: until you flip `authorised` to `true` (below) its absence raises no alert — which is why the two edits are the step that turns the pin on. See the **Required scripts** section of `README.md` for the full semantics.

Note the two different digests the release publishes, and do not swap them: `integrity` in the HTML is the **SRI sha384** string from the release notes; `hashes[].hash.value` in the inventory is the **SHA-256** of the bundle, which is what the monitor computes over the response body.

---

## Step 6 — Schedule the comparator

The comparator drains the queue and judges first sightings against the canonical inventory. It runs **only** from the inventory repository, on its existing credential model — the same single-scheduler principle as the daily synthetic run. Two schedulers would drain the same queue concurrently and open duplicate candidate pull requests.

`.github/workflows/rum-compare.yml` in the inventory repository:

```yaml
name: rum-compare

on:
  schedule:
    - cron: '0 * * * *' # hourly, on the hour
  workflow_dispatch:

permissions:
  contents: read
  id-token: write # OIDC federation to the comparator role

concurrency:
  group: rum-compare
  cancel-in-progress: false # never cut a drain short; let the next cycle wait

jobs:
  compare:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the monitoring tool at a pinned release
        uses: actions/checkout@v4
        with:
          repository: mr-yum/pci-dss-page-tampering
          ref: v1.0.0 # same tag as the deployed modules

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: npm ci

      - name: Assume the comparator role
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.RUM_GHA_ROLE_ARN }} # collector-core output gha_role_arn
          aws-region: ap-southeast-2

      - name: Drain and compare
        run: |
          npm start -- --mode rum-compare \
            --repo https://github.com/example-org/script-inventory \
            --git-token ${{ secrets.INVENTORY_REPO_PAT }} \
            --rum-queue-url ${{ vars.RUM_QUEUE_URL }} \
            --slack-token ${{ secrets.SLACK_TOKEN }} \
            --report-dir report

      - uses: actions/upload-artifact@v4
        with:
          name: rum-compare-report
          path: report
```

Details that matter:

- **`id-token: write`** is what lets `aws-actions/configure-aws-credentials` federate into core's `gha_role_arn`. That role trusts `repo:<github_repo>:*` — the `github_repo` you set in step 1 — and grants exactly SQS consume on the novel-observations queue plus CloudWatch metric read, and metric write scoped to the `metric_namespace`. Nothing else.
- **Ambient AWS credentials are a deliberate carve-out** from this project's CLI-parameters-only rule: `rum-compare` is the one mode that reads credentials and region from the environment, because credentials do not belong on command lines. Everything else is still a parameter.
- **`--git-token` still does the Git work.** Inventory-pass observations open candidate pull requests, so the token needs `pull_requests: write`; the workflow's own `contents` permission is not what pushes.
- **Pin the tool by tag**, not `main`. The comparator, the deployed ingest Lambda, and the embedded agent share a beacon schema; a floating checkout drifts away from the collector you deployed.
- **`--report-dir`** is optional but strongly recommended: it writes `report/rum-compare/rum-summary.json` (processed / alerted / candidates / recorded / DLQ'd, and the inventory SHAs judged against), which is both your audit evidence and the assertion surface for step 8.
- Exit codes are unchanged: `0` on success including an empty queue, `1` on bad parameters, `2` on a Git/AWS/comparison failure. Messages bound for the DLQ do not fail the run — the DLQ alarm owns that signal.

Worst-case latency from observation to alert is roughly 60–90 minutes on this cadence, which is the accepted trade.

---

## Step 7 — Wire the alarms to Slack

`collector-core` creates an SNS topic and points every alarm at it, exposing `sns_topic_arn`. Either subscribe that topic to Slack (AWS Chatbot, or your own subscriber Lambda), or pass your existing topic as `alert_sns_topic_arn` and let it flow through the routing you already have.

```hcl
module "collector_core" {
  # ...
  alert_sns_topic_arn = aws_sns_topic.security_alarms.arn # inject your own, or omit to have one created
}
```

What arrives, with `<prefix>` = your `name_prefix`:

| Alarm                                | Fires when                                                                                 | Read it as                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `<prefix>-novel-observations-age`    | oldest queued observation older than `queue_age_alarm_hours` (default 3h)                  | **two missed hourly cycles** — the comparator is not draining. Check the workflow, then the role.      |
| `<prefix>-beacon-volume-<target_id>` | per-target `rum_beacons_accepted` outside its anomaly band, or missing (treated as breach) | **suppression tripwire** — the agent may have been removed, blocked by CSP, or the page shell changed. |
| `<prefix>-ingest-error-rate`         | Lambda error ratio elevated                                                                | collector-side fault; beacons are being lost.                                                          |
| `<prefix>-novel-observations-dlq`    | any message in the dead-letter queue                                                       | an observation failed evaluation three times — a poison message, or a comparator bug. Never ignore.    |
| `rum-canary-silent`                  | the canary heartbeat stops (step 8)                                                        | the whole path is down, _including the workflows not running at all_.                                  |

**Treat all of these as sev-2.** None is a page-in-the-night on its own, and none is a ticket for next sprint either. They all mean the same class of thing: the monitoring is degraded, so absence of alerts currently proves nothing. Volume anomaly in particular is the interlock that separates "no attack" from "no observation" — the one an attacker who owns the page would love you to ignore.

The volume alarm treats missing data as breaching by design, so it fires on total silence and not just on a dip.

---

## Step 8 — Verify end-to-end with the canary

The canary is the acceptance test for every step above, and then stays forever. It works by being ordinary: a dedicated canary target (step 2) receives a deliberately uninventoried marker script observation on a schedule; the expected `rum_uninventoried_script_detected` alert lands in the ops channel within one comparison cycle. There is **no suppression mechanism anywhere in the pipeline** — the security channel stays clean only because no payment-page target is ever involved.

### One-shot verification

Once steps 1–7 are applied, prove reachability and the pipeline by hand:

```bash
COLLECTOR_ENDPOINT=https://collect.example.com

MARKER="https://canary-marker.example.test/rum-canary-$(date +%s).js"
jq --arg url "$MARKER" \
   --arg sid "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
   --argjson ts "$(date +%s)000" \
   '.observations[0].url = $url | .session.id = $sid | .observations[0].ts = $ts' \
   test/fixtures/beacons/canary.json > /tmp/canary-beacon.json

curl --fail-with-body -sS -o /dev/null -X POST "$COLLECTOR_ENDPOINT/" \
  -H 'Origin: https://canary.example.test' \
  -H 'Content-Type: text/plain' \
  --data-binary @/tmp/canary-beacon.json
```

**Uniquify the marker URL on every post.** The novelty store deliberately dedupes repeats for `novelty_ttl_days` (90), so a second post of the same marker is _correctly_ not a first sighting and produces no alert. Uniquifying is not a bypass of the pipeline — it is what a genuinely novel script looks like.

The collector always answers `204` regardless of outcome (no oracle for probing the schema or the origin map), so the curl proves reachability only. The proof is downstream: run the comparator (or wait one cycle) and expect `rum_uninventoried_script_detected` for the canary target **in the ops channel**, and a non-zero count in `report/rum-compare/rum-summary.json` under `.alertedByCategory.rum_uninventoried_script_detected`.

If it does not arrive, walk back: `rum_unmapped_origin` non-zero means step 2; `rum_edge_auth_failure` means the shared secret differs between core and edge; queue depth without alerts means step 6.

### Make it permanent

Then schedule it. `docs/rum/canary-workflow.md` carries the full YAML — the hourly post at `30 * * * *` (so the `:00` comparator cycle drains it), the cycle assertion against `rum-summary.json`, the heartbeat metric, and the dead-man's-switch alarm that treats missing data as breaching over two evaluation periods. Its prerequisites are worth restating: the canary target's inventory file must route **every** alert category to the ops channel and nothing to the security channel, and the beacon fixture is vendored into the inventory repository from `test/fixtures/beacons/canary.json`.

The heartbeat metric only exists while the entire chain works — post, ingest, first sighting, drain, alert, assertion — which is why its absence covers failure modes no individual alarm does.

---

## Step 9 — Operate and upgrade

**Pin by tag; bump by bot.** Modules, ingest zip, comparator checkout and agent artefact all move together. Let Dependabot (or equivalent) raise the tag bump as a pull request, and read the CHANGELOG on every minor: any variable or output change is at least a minor, and behaviour changes are called out there.

**Soak in staging origins before production.** Roll the new agent to the origins mapped `target_type = "inventory"` first and let it run a cycle or two. Staging observations become candidate pull requests rather than alerts, so a regression in capture shows up as inventory noise instead of a false detection page.

**Agent rollout is gated by the inventory hash pull request.** The order is fixed, because the pinned entry from step 5 is what makes the agent tamper-evident:

1. Open the inventory pull request adding the new version's hash (and, during the overlap, keeping the old one as a second `authoriseWith` alternative).
2. Merge it.
3. Deploy the new `<script>` tag with its new SRI.
4. Once no page serves the old version, drop the old hash in a follow-up pull request.

Skipping step 1 makes your own deploy look exactly like an attacker replacing the agent — which is the interlock working.

**Runbook pointers, per alarm.** Queue age → is the hourly workflow running, and can it still assume `gha_role_arn`? Volume anomaly → view source on the target page: is the tag still there, and does the CSP still allow the endpoint? Ingest error rate → Lambda logs; a schema drift between a newer agent and an older ingest zip is the usual cause of a sudden step change. DLQ depth → pull the message, replay it locally against the comparator, and fix forward; the raw beacon is also in the archive. Canary silent → work the step 8 walk-back list.

**Evidence archive.** Every accepted beacon is preserved verbatim in the S3 archive (`archive_bucket`), SSE-KMS encrypted, with a one-year lifecycle by default (`archive_retention_days = 365`). It is the auditor's record and the replay source for re-evaluation, so agree the access policy with whoever owns PCI evidence in your organisation _before_ the first assessment: who may read the bucket, who may change the retention, and how a retrieval is logged. Changing `archive_retention_days` changes the lifecycle rule; shortening it destroys evidence you may be required to produce.

**Expect the one-time candidate wave.** The first site-wide rollout puts the agent on routes your payment-scoped inventory never covered, and real staging usage exercises paths the scripted synthetic workflows never reach — error paths, experiment arms, region-specific payment methods. The result is a one-off burst of staging candidate pull requests. This is the feature delivering exactly what it promised, not noise to be suppressed: schedule review capacity for it, work through the backlog, and the steady state settles to a trickle.
