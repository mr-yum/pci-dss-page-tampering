# Contract: Terraform Modules

**Parties**: adopters (including our internal wrapper) ⇄ `infra/collector-core`, `infra/edge-cloudfront`, `infra/edge-cloudflare`, `infra/observability-datadog`

Shared rules: no module declares a provider it doesn't strictly need (core: `aws` only; edge-cloudflare declares `cloudflare` only; observability-datadog declares `datadog` only) — which is also why observability, like the edges, is a separate module: Terraform providers cannot be conditionally required, so an optional vendor surface must live behind its own module boundary rather than as a flag on core; **no module creates VPC resources** (versioned compatibility contract — removal requires a major version); every input a consumer's estate already owns is injectable, with a create-fallback default so the examples stand alone; all resources tagged from a `tags` map and named from `name_prefix`; semver discipline — any variable/output change ≥ minor, behaviour changes called out in CHANGELOG; `CODEOWNERS` gates `infra/`.

## collector-core

**Inputs** (required unless noted): `origin_targets` (list of {origin, target_id, target_type}); `name_prefix`; `tags` (default {}); `kms_key_arn` (default: create); `alert_sns_topic_arn` (default: create); `github_oidc_provider_arn` (default: create — pass existing in real estates, one per account); `oidc_subject_claims` (REQUIRED, no default: list of allowed OIDC `sub` claims, matched with StringLike — the role can consume and delete security observations, so the trust boundary is an explicit operator decision; use the comparator workflow's exact subject, e.g. `repo:ORG/REPO:ref:refs/heads/main`); `edge_auth` (object: `{ mode = "aws_iam" }` or `{ mode = "shared_secret", secret = sensitive string }`); `archive_retention_days` (default **365**); `novelty_ttl_days` (default **90**); `queue_age_alarm_hours` (default **3**); `create_alarms` (default **true** — set false when the monitors live elsewhere, e.g. observability-datadog; disables all four CloudWatch alarm families while leaving metric emission and the SNS topic logic untouched); `lambda_package` (path or S3 ref to released ingest zip).

**Creates**: Lambda + Function URL (auth per `edge_auth.mode`), Firehose → S3 (SSE-KMS, lifecycle from retention), DynamoDB table (on-demand, TTL attribute), SQS + DLQ (`maxReceiveCount` 3), CloudWatch alarms (queue age, per-target beacon-volume anomaly, Lambda error rate, DLQ depth > 0; all gated by `create_alarms`) → SNS, OIDC-federated IAM role scoped to: SQS consume, CloudWatch metrics read. Nothing else.

**Outputs**: `function_url`, `queue_url`, `queue_arn`, `dlq_arn`, `gha_role_arn`, `novelty_table_name`, `archive_bucket`, `sns_topic_arn`, `metric_namespace`.

## edge-cloudfront

**Inputs**: `origin_function_url` (from core), `name_prefix`, `tags`, `edge_shared_secret` (sensitive — must equal core's `edge_auth.secret`), `acm_certificate_arn` + `route53_zone_id` + `domain_name` (all optional together — default: CloudFront domain), `waf_rate_limit` (default 300 req/5min/IP), `max_body_kb` (default 32).
**Creates**: distribution (no caching, POST passthrough), WAFv2 web ACL (rate limit, size constraint), origin custom header injecting `x-collector-edge-key` (requires core `edge_auth.mode = "shared_secret"`). OAC + `AWS_IAM` is deliberately not used: for OAC-signed POST/PUT requests AWS requires the client to send `x-amz-content-sha256`, and `navigator.sendBeacon` cannot set headers — every beacon would be rejected at the Function URL.
**Outputs**: `collector_endpoint` (https URL for the page's CSP `connect-src` and agent `data-collector`).

## edge-cloudflare

**Inputs**: `origin_function_url`, `zone_id`, `record_name`, `edge_shared_secret` (sensitive — must equal core's `edge_auth.secret`), `rate_limit_rpm` (default 60/min/IP), `tags` n/a (Cloudflare-side naming via `record_name`).
**Creates**: proxied DNS record (Full-Strict TLS to the Function URL's public cert), rate-limiting ruleset, Transform Rule injecting `x-collector-edge-key`. Requires core `edge_auth.mode = "shared_secret"`.
**Outputs**: `collector_endpoint`.

## observability-datadog

Datadog monitors mirroring collector-core's alarm semantics, for estates whose on-call watches Datadog. Emission stays CloudWatch (AWS-native metrics are not movable; the ingest Lambda keeps zero vendor SDKs/egress/keys); metrics flow CloudWatch → Datadog via the AWS integration — CloudWatch Metric Streams is strongly recommended for the two silence-sensitive monitors (beacon-volume tripwire, canary dead-man), whose 120-minute no-data windows still function under API polling but detect correspondingly later; polling's ~10-minute latency is acceptable for the remaining monitors. Datadog API/app keys exist only at terraform-apply time in the adopter's estate. Deploy beside core with `create_alarms = false`.

**Inputs**: `metric_namespace` (core's output, e.g. `rum/rum`); `custom_metric_prefix` (default null → derived: `aws.` + namespace lowercased, non-alphanumerics → `_`; override when Metrics Explorer shows a different name — the convention is observed, not formally documented); `queue_name`, `dlq_name`, `lambda_function_name` (names as they appear in the lowercased `queuename`/`functionname` tags); `target_ids` (list, one anomaly monitor each, scoped by the `targetid` tag); `notification_handle` (`@`-handle, appended to every message); `name_prefix` (default `rum` — monitor names mirror the CloudWatch alarm names); `queue_age_alarm_hours` (default **3**); `lambda_error_rate_percent` (default **5**); `canary_metric` (default `rum_canary_passed`, null omits the dead-man monitor); `canary_target_id` (default `canary`); evaluation/no-data windows (`volume_evaluation_window` last_4h, `volume_trigger_window` last_1h, `volume_anomaly_deviations` 2, `volume_no_data_minutes` 120, `canary_no_data_minutes` 120, `short_evaluation_window` last_15m, `evaluation_delay_seconds` 300); `tags` (list, default []).

**Creates**: five `datadog_monitor` families — queue age (> hours×3600 on `aws.sqs.approximate_age_of_oldest_message`), per-target beacon-volume anomaly (`anomalies(...)` band width 2 with `notify_no_data` — missing data notifies, silence is the suppression signal), Lambda error rate (errors/invocations×100 > threshold), DLQ depth (> 0), canary dead-man (heartbeat < 1 with `notify_no_data`). Every message carries the notification handle and a one-line runbook pointer mirroring IMPLEMENTATION.md step 7. Nothing else — no AWS resources of any kind.

**Outputs**: `custom_metric_prefix` (for the Metrics Explorer verification), `monitor_ids`.

## Examples

`infra/examples/cloudfront-stack` and `infra/examples/cloudflare-stack`: complete, applyable compositions using RFC-reserved domains and fictional values only (repo behaviour rule — no organisation-specific values ever). Each example wires core + one edge and documents which `edge_auth.mode` it requires.

## Test obligations

`terraform test` with mocked providers (AWS, Cloudflare, and Datadog) runs per PR against all four modules and both examples: plan-level assertions on required inputs, `edge_auth` mode/edge pairing (both edges inject the shared-secret header, so both examples run core in `shared_secret` mode and fail if the secret is missing), no-VPC assertion (no `aws_vpc`/`aws_subnet`/`aws_security_group` resources in any plan), alarm presence, and output wiring. Core's `aws_iam` mode remains covered by the collector-core suite (valid for SigV4-capable, non-beacon consumers). No credentials, no applies in this repo's CI.
