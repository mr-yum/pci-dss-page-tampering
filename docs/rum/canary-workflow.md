# RUM canary workflow (inventory repository)

The permanent canary proves the full RUM path — collector ingest → novelty → queue → `--mode rum-compare` → alert — on a schedule, with **no suppression mechanism anywhere in the pipeline** (FR-016). It works by being ordinary: a dedicated canary target id in the collector's `origin_targets` map, whose inventory entry routes **all** alert categories to the ops/monitoring channel, receives a deliberately uninventoried marker script observation every hour. The expected `rum_uninventoried_script_detected` alert lands in the ops channel within one comparison cycle; the security channel stays clean because no payment-page target is ever involved; and the canary's own silence raises an alarm.

This document is the full workflow snippet; `docs/rum/IMPLEMENTATION.md` step 8 condenses it and references back here.

## Prerequisites

- `origin_targets` contains the canary entry, e.g. `{ "origin": "https://canary.example.test", "target_id": "canary", "target_type": "detection" }`.
- The inventory repo has a `canary` target file whose `alerts{}` block routes every category (including all `rum_*` categories) to the ops channel — and nothing to the security channel.
- The canary beacon fixture (copied from this repo's `test/fixtures/beacons/canary.json`) is vendored in the inventory repo as `fixtures/rum-canary.json`.
- The hourly `rum-compare` workflow (contracts/cli-rum-compare.md) already runs at `0 * * * *`.

## Hourly canary post

Each run must be a **fresh first sighting** — the novelty store deliberately dedupes repeats for `novelty_ttl_days` — so the marker URL is uniquified per run. That is not a bypass of the pipeline; it is how a genuinely novel script looks.

```yaml
name: rum-canary
on:
  schedule:
    - cron: '30 * * * *' # :30, so the :00 rum-compare cycle drains it
  workflow_dispatch:

permissions:
  contents: read

jobs:
  post-canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Post a uniquified canary beacon at the collector edge
        env:
          COLLECTOR_URL: https://collector.example.test # edge (CloudFront/Cloudflare) URL — it injects the edge key
        run: |
          # Include GITHUB_RUN_ATTEMPT so a re-run produces a distinct marker —
          # a repeated marker would be deduped by the novelty store for 90 days.
          MARKER="https://canary-marker.example.test/rum-canary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.js"
          jq --arg url "$MARKER" \
             --arg sid "$(uuidgen | tr '[:upper:]' '[:lower:]')" \
             --argjson ts "$(date +%s)000" \
             '.observations[0].url = $url | .session.id = $sid | .observations[0].ts = $ts' \
             fixtures/rum-canary.json > /tmp/canary-beacon.json
          curl --fail-with-body -sS -o /dev/null -X POST "$COLLECTOR_URL/" \
            -H 'Origin: https://canary.example.test' \
            -H 'Content-Type: text/plain' \
            --data-binary @/tmp/canary-beacon.json
```

The collector always answers `204` (no-oracle contract), so the curl proves reachability only — the assertion below proves the pipeline.

## Assertion — one comparison cycle later

In the hourly `rum-compare` workflow, after the compare step (which writes `--report-dir` artefacts), assert the canary alert fired and emit a heartbeat metric. The alert routes to the ops channel by the canary target's own alerts config — the assertion checks the run summary, the humans see the Slack message.

Bind the assertion to the **canary target specifically**, not the aggregate.
The summary's `alertedByCategory` is a run-wide count: another target's
`rum_uninventoried_script_detected` alert in the same cycle would satisfy it
while the canary path is actually broken — a false pass that defeats the whole
dead-man's switch. `alertedByTarget["canary"]` is populated only when an alert
for `target_id = canary` fired, so it is the field the assertion must read.

```yaml
# …after the `npm start -- --mode rum-compare … --report-dir report` step:
- name: Assert the canary alert fired this cycle
  run: |
    # Per-target, not the aggregate: alertedByCategory could be satisfied by a
    # different target's alert while the canary is silently broken.
    COUNT=$(jq '.alertedByTarget["canary"].rum_uninventoried_script_detected // 0' \
      report/rum-compare/rum-summary.json)
    if [ "$COUNT" -lt 1 ]; then
      echo "canary: no rum_uninventoried_script_detected alert for target_id=canary in this cycle" >&2
      exit 1
    fi

- name: Emit the canary heartbeat metric
  env:
    # collector-core's `metric_namespace` output ("<name_prefix>/rum"), passed
    # through a repository/workflow variable (see wiring below). The comparator
    # role's PutMetricData permission is scoped to exactly this namespace, and
    # the dead-man alarm reads module.collector_core.metric_namespace — so a
    # non-default name_prefix must reach both sides from the one Terraform
    # output. Hard-coding "rum/rum" here would silently break the alarm on any
    # non-default prefix (the heartbeat would land in a namespace the alarm
    # never watches).
    METRIC_NAMESPACE: ${{ vars.RUM_METRIC_NAMESPACE }}
  run: |
    aws cloudwatch put-metric-data \
      --namespace "$METRIC_NAMESPACE" \
      --metric-name rum_canary_passed \
      --dimensions TargetId=canary \
      --value 1
```

### Wiring the metric namespace

`RUM_METRIC_NAMESPACE` must equal the collector's `metric_namespace`
(`${name_prefix}/rum`) exactly — it is the single source of truth read by both
the heartbeat `put-metric-data` above and the dead-man alarm below. Publish the
Terraform output into the repository (or environment) variable so the two never
drift:

```bash
# After `terraform apply`, from the collector infra directory:
gh variable set RUM_METRIC_NAMESPACE \
  --repo <org>/<inventory-repo> \
  --body "$(terraform output -raw collector_core_metric_namespace)"
```

With the default `name_prefix = "rum"` this resolves to `rum/rum`; a deployment
that sets a different prefix gets its own namespace on both sides automatically.

## Alarm on absence (dead-man's switch)

The heartbeat metric only exists while the whole chain works — post, ingest, first sighting, drain, alert, assertion. A missing heartbeat therefore covers every failure mode, **including the workflows not running at all**: the alarm treats missing data as breaching.

```hcl
resource "aws_cloudwatch_metric_alarm" "rum_canary_silent" {
  alarm_name          = "rum-canary-silent"
  namespace           = module.collector_core.metric_namespace
  metric_name         = "rum_canary_passed"
  dimensions          = { TargetId = "canary" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 2 # tolerate one missed/slow cycle, alarm on the second
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [var.ops_sns_topic_arn] # ops channel, never the security channel
}
```

Two evaluation periods keeps SC-009's ≥ 99% monthly pass rate honest without paging on a single transient scheduler delay; every persistent failure alarms.
