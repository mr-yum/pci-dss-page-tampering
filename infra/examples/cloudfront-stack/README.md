# Example: CloudFront stack

A complete, applyable composition of `collector-core` + `edge-cloudfront`: the ingest Lambda (Function URL, `edge_auth.mode = "shared_secret"`) fronted by a CloudFront distribution that injects the `x-collector-edge-key` shared secret on every origin request, plus WAFv2 rate limiting and body-size capping. (Origin Access Control is not usable for beacon traffic — see `infra/edge-cloudfront/README.md`.)

## What it deploys

- `collector-core`: ingest Lambda + Function URL (open URL, shared-secret verification in the handler), Firehose → S3 archive, DynamoDB novelty table, SQS + DLQ, CloudWatch alarms → SNS, and the OIDC-federated comparator role.
- `edge-cloudfront`: CloudFront distribution (no caching, POST passthrough, secret-injecting origin header) and WAFv2 web ACL.

All fictional values (`example.com` / `.test` origins, `example-org/script-inventory`) are placeholders — replace them with your own.

## Before you apply

1. **Build the Lambda package**: run `npm run build:collector` at the repository root first — `lambda_package` defaults to `../../../dist/collector/ingest.zip`, which only exists after that build.
2. **Set your region**: the default `aws` provider block is empty; region and credentials come from the environment (`AWS_REGION`, `AWS_PROFILE`, ...). The aliased `aws.us_east_1` provider is pinned to `us-east-1` because CloudFront-scoped WAFv2 web ACLs only exist there — leave it as is.
3. **Set the variables an adopter owns**:
   - `origin_targets` — replace the example staging/production/canary origins with the exact `scheme+host` origins of your payment pages and their inventory target ids.
   - `github_repo` — the `org/repo` whose GitHub Actions comparator workflow assumes `gha_role_arn`.
   - `name_prefix` — naming prefix for every created resource.
   - `edge_shared_secret` — a long random value shared by the distribution and the ingest Lambda; a leak means edge bypass until it is rotated in both (see `infra/edge-cloudfront/README.md`).

```bash
npm run build:collector
terraform -chdir=infra/examples/cloudfront-stack init
terraform -chdir=infra/examples/cloudfront-stack apply
```

## Custom domain

This example uses the default `*.cloudfront.net` domain. To serve a custom domain, pass `acm_certificate_arn` + `route53_zone_id` + `domain_name` (all-or-none) through to `edge-cloudfront` — see that module's README.

## Outputs

- `collector_endpoint` — put this in the payment page's CSP `connect-src` and the agent's `data-collector`.
- `gha_role_arn` — the role your comparator workflow assumes via OIDC.
- `queue_url` — the novel-observations queue that workflow drains.
