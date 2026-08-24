# Contract: Terraform Modules

**Parties**: adopters (including our internal wrapper) ⇄ `infra/collector-core`, `infra/edge-cloudfront`, `infra/edge-cloudflare`

Shared rules: no module declares a provider it doesn't strictly need (core: `aws` only; edge-cloudflare adds `cloudflare`); **no module creates VPC resources** (versioned compatibility contract — removal requires a major version); every input a consumer's estate already owns is injectable, with a create-fallback default so the examples stand alone; all resources tagged from a `tags` map and named from `name_prefix`; semver discipline — any variable/output change ≥ minor, behaviour changes called out in CHANGELOG; `CODEOWNERS` gates `infra/`.

## collector-core

**Inputs** (required unless noted): `origin_targets` (list of {origin, target_id, target_type}); `name_prefix`; `tags` (default {}); `kms_key_arn` (default: create); `alert_sns_topic_arn` (default: create); `github_oidc_provider_arn` (default: create — pass existing in real estates, one per account); `github_repo` (OIDC role trust, `org/inventory-repo`); `oidc_subject_claims` (REQUIRED, no default: list of allowed OIDC `sub` claims, matched with StringLike — the role can consume and delete security observations, so the trust boundary is an explicit operator decision; use the comparator workflow's exact subject, e.g. `repo:ORG/REPO:ref:refs/heads/main`); `edge_auth` (object: `{ mode = "aws_iam" }` or `{ mode = "shared_secret", secret = sensitive string }`); `archive_retention_days` (default **365**); `novelty_ttl_days` (default **90**); `queue_age_alarm_hours` (default **3**); `lambda_package` (path or S3 ref to released ingest zip).

**Creates**: Lambda + Function URL (auth per `edge_auth.mode`), Firehose → S3 (SSE-KMS, lifecycle from retention), DynamoDB table (on-demand, TTL attribute), SQS + DLQ (`maxReceiveCount` 3), CloudWatch alarms (queue age, per-target beacon-volume anomaly, Lambda error rate, DLQ depth > 0) → SNS, OIDC-federated IAM role scoped to: SQS consume, CloudWatch metrics read. Nothing else.

**Outputs**: `function_url`, `queue_url`, `queue_arn`, `dlq_arn`, `gha_role_arn`, `novelty_table_name`, `archive_bucket`, `sns_topic_arn`, `metric_namespace`.

## edge-cloudfront

**Inputs**: `origin_function_url` (from core), `name_prefix`, `tags`, `edge_shared_secret` (sensitive — must equal core's `edge_auth.secret`), `acm_certificate_arn` + `route53_zone_id` + `domain_name` (all optional together — default: CloudFront domain), `waf_rate_limit` (default 300 req/5min/IP), `max_body_kb` (default 32).
**Creates**: distribution (no caching, POST passthrough), WAFv2 web ACL (rate limit, size constraint), origin custom header injecting `x-collector-edge-key` (requires core `edge_auth.mode = "shared_secret"`). OAC + `AWS_IAM` is deliberately not used: for OAC-signed POST/PUT requests AWS requires the client to send `x-amz-content-sha256`, and `navigator.sendBeacon` cannot set headers — every beacon would be rejected at the Function URL.
**Outputs**: `collector_endpoint` (https URL for the page's CSP `connect-src` and agent `data-collector`).

## edge-cloudflare

**Inputs**: `origin_function_url`, `zone_id`, `record_name`, `edge_shared_secret` (sensitive — must equal core's `edge_auth.secret`), `rate_limit_rpm` (default 60/min/IP), `tags` n/a (Cloudflare-side naming via `record_name`).
**Creates**: proxied DNS record (Full-Strict TLS to the Function URL's public cert), rate-limiting ruleset, Transform Rule injecting `x-collector-edge-key`. Requires core `edge_auth.mode = "shared_secret"`.
**Outputs**: `collector_endpoint`.

## Examples

`infra/examples/cloudfront-stack` and `infra/examples/cloudflare-stack`: complete, applyable compositions using RFC-reserved domains and fictional values only (repo behaviour rule — no organisation-specific values ever). Each example wires core + one edge and documents which `edge_auth.mode` it requires.

## Test obligations

`terraform test` with mocked providers (AWS and Cloudflare) runs per PR against all three modules and both examples: plan-level assertions on required inputs, `edge_auth` mode/edge pairing (both edges inject the shared-secret header, so both examples run core in `shared_secret` mode and fail if the secret is missing), no-VPC assertion (no `aws_vpc`/`aws_subnet`/`aws_security_group` resources in any plan), alarm presence, and output wiring. Core's `aws_iam` mode remains covered by the collector-core suite (valid for SigV4-capable, non-beacon consumers). No credentials, no applies in this repo's CI.
