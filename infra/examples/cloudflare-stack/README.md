# Example: Cloudflare stack

A complete, applyable composition of `collector-core` + `edge-cloudflare`: the ingest Lambda (Function URL, `edge_auth.mode = "shared_secret"`) behind a proxied Cloudflare record, with a per-IP rate-limiting ruleset and a Transform Rule that injects the `x-collector-edge-key` shared secret so the origin can reject traffic that bypassed the edge.

## What it deploys

- `collector-core`: ingest Lambda + Function URL (auth `NONE` — the shared secret is the gate), Firehose → S3 archive, DynamoDB novelty table, SQS + DLQ, CloudWatch alarms → SNS, and the OIDC-federated comparator role.
- `edge-cloudflare`: proxied CNAME (`record_name` → Function URL host), rate-limiting ruleset, and the header-injecting Transform Rule.

All fictional values (`example.com` / `.test` origins, `collect.example.com`, `example-org/script-inventory`) are placeholders — replace them with your own.

## Prerequisites this example cannot manage

Both are zone-level constraints inherited from the `edge-cloudflare` module (see its README):

- **Full (Strict) TLS**: the zone's SSL/TLS encryption mode must be **Full (Strict)** so Cloudflare validates the Function URL's public certificate on the origin leg. With a weaker mode the edge-to-origin hop is not strictly verified.
- **Phase-ruleset exclusivity**: Cloudflare allows a single entrypoint ruleset per phase per zone, and this stack claims the zone's `http_ratelimit` and `http_request_late_transform` phases. If your zone already carries rulesets in those phases, merge the rules there instead of applying this example as-is.

## Before you apply

1. **Build the Lambda package**: run `npm run build:collector` at the repository root first — `lambda_package` defaults to `../../../dist/collector/ingest.zip`, which only exists after that build.
2. **Set your AWS region**: the `aws` provider block is empty; region and credentials come from the environment (`AWS_REGION`, `AWS_PROFILE`, ...).
3. **Set the variables an adopter owns**:
   - `cloudflare_api_token` (sensitive) — token with DNS and zone-ruleset edit permission.
   - `zone_id` — the Cloudflare zone to create the record and rulesets in.
   - `record_name` — the fully qualified collector hostname (`collect.example.com` is a placeholder).
   - `edge_shared_secret` (sensitive) — a long random value; it must reach both modules, which this example wires for you. A leak means edge bypass until rotated — rotate core and edge together, and never commit it.
   - `origin_targets`, `github_repo`, `name_prefix` — as in the CloudFront example.

```bash
npm run build:collector
terraform -chdir=infra/examples/cloudflare-stack init
terraform -chdir=infra/examples/cloudflare-stack apply
```

## Outputs

- `collector_endpoint` — `https://<record_name>`; put it in the payment page's CSP `connect-src` and the agent's `data-collector`.
- `gha_role_arn` — the role your comparator workflow assumes via OIDC.
- `queue_url` — the novel-observations queue that workflow drains.
