# observability-datadog

Datadog monitors mirroring collector-core's four CloudWatch alarm families — queue age, per-target beacon-volume anomaly (missing data notifies, by design), ingest Lambda error rate, DLQ depth — plus the canary dead-man's switch from `docs/rum/canary-workflow.md`. Deploy it beside collector-core with `create_alarms = false` when your on-call rotation watches Datadog rather than CloudWatch: running CloudWatch alarms nobody watches is worse than none.

## Why a separate module, and why emission stays CloudWatch

Terraform providers cannot be conditionally required — a module that declared the Datadog provider "only when wanted" would force every collector-core consumer to configure Datadog credentials. So, exactly like the two edge modules, the Datadog surface is its own module with its own single provider (`datadog` only, no `aws`).

The **monitors** are what become pluggable — never the emission. The ingest Lambda keeps zero vendor SDKs, zero egress, zero runtime keys; AWS-native metrics (SQS age, Lambda errors, DLQ depth) exist only in CloudWatch and cannot be emitted anywhere else. Metrics therefore flow CloudWatch → Datadog via Datadog's AWS integration, and the Datadog API/app keys exist only at terraform-apply time in your estate — nothing on the beacon path ever sees them.

## Prerequisites the module cannot manage

- **The Datadog AWS integration** must be installed for the collector's AWS account.
- **CloudWatch Metric Streams, filtered to include the collector's namespace (`metric_namespace`, default `rum/rum`) and the AWS/SQS and AWS/Lambda namespaces, is REQUIRED for the beacon-volume tripwire and the canary dead-man monitor.** Both treat absence of data as the alert condition; API polling's ~10-minute (often longer for custom namespaces) latency and irregular arrival make "no data" indistinguishable from "not polled yet", which turns the suppression tripwire into a flapping liar. Streams deliver in ~2–3 minutes. For the three threshold monitors (queue age, error rate, DLQ) polling is acceptable but degraded — expect up to ~10 minutes of extra alert latency, and raise `evaluation_delay_seconds` to 900.
- **Custom-namespace metrics must be collected**: with Metric Streams, include the namespace in the stream's filter; with polling, enable _Collect Custom Metrics_ on the integration tile.

## The metric-name prefix, and how to verify it

CloudWatch metrics arrive in Datadog renamed. For custom namespaces the observed convention is `aws.` + the namespace lowercased with every non-alphanumeric character replaced by an underscore (Datadog metric names admit only ASCII alphanumerics, `_` and `.`; everything else converts to `_`) — so `rum/rum` becomes `aws.rum_rum`, and the beacon counter reads `aws.rum_rum.rum_beacons_accepted`. CloudWatch dimensions arrive as lowercased tags: `TargetId=checkout` becomes `targetid:checkout`.

Datadog does not formally document the custom-namespace case and sanitisation conventions drift, which is why the derivation is overridable. **Verify before trusting the tripwire**: open _Metrics → Explorer_, search for `rum_beacons_accepted`, and compare the full name against this module's `custom_metric_prefix` output. If they differ, set the `custom_metric_prefix` variable to what the Explorer actually shows.

## Composition

```hcl
module "collector_core" {
  source = "github.com/example-org/pci-dss-page-tampering//infra/collector-core"

  name_prefix         = "rum"
  create_alarms       = false # the monitors live in Datadog now
  oidc_subject_claims = ["repo:example-org/script-inventory:ref:refs/heads/main"]

  origin_targets = [
    { origin = "https://checkout.example.com", target_id = "checkout", target_type = "detection" },
  ]

  edge_auth = {
    mode   = "shared_secret"
    secret = var.edge_shared_secret
  }
}

module "observability_datadog" {
  source = "github.com/example-org/pci-dss-page-tampering//infra/observability-datadog"

  name_prefix          = "rum"
  metric_namespace     = module.collector_core.metric_namespace
  queue_name           = "rum-novel-observations" # <name_prefix>-novel-observations
  dlq_name             = "rum-novel-observations-dlq"
  lambda_function_name = "rum-ingest"
  target_ids           = ["checkout"]
  notification_handle  = "@slack-ops-channel"
}

provider "datadog" {
  # API/app keys exist only here, at apply time — never on the beacon path.
  api_key = var.datadog_api_key
  app_key = var.datadog_app_key
}
```

`queue_name`, `dlq_name` and `lambda_function_name` are names, not ARNs — they must match the `queuename`/`functionname` tags Datadog derives from the CloudWatch dimensions.

## Parity with the CloudWatch alarms, stated honestly

The monitors mirror `collector-core`'s alarm _semantics_, with two deliberate differences:

- **Queue age and DLQ depth** evaluate a single `last_5m` window (`threshold_evaluation_window`), matching CloudWatch's one 5-minute period — a recovered transient breach stops paging within ~5 minutes.
- **Lambda error rate** cannot be a literal translation: the CloudWatch alarm uses 3×5-minute periods with 2-to-alarm, and Datadog metric monitors have no M-of-N evaluation. The monitor uses one traffic-weighted `last_15m` window (`error_rate_evaluation_window`) over the same span — both forms require errors sustained across ~15 minutes; the Datadog form smooths a single bad 5-minute burst slightly more. If your on-call practice needs burst sensitivity, shorten the window rather than expecting M-of-N.

## What still lives in CloudWatch

collector-core's SNS topic and its creation logic are untouched by `create_alarms = false`; the collector's own telemetry (`rum_beacons_accepted`, `rum_beacons_rejected`, `rum_edge_auth_failure`, …) is still emitted to CloudWatch and remains queryable there. This module adds read-side monitors only — deleting it loses no data.

## Outputs

- `custom_metric_prefix` — the derived (or overridden) Datadog prefix, for the Metrics Explorer verification above.
- `monitor_ids` — every created monitor id, keyed by role.
