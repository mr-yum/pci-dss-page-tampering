# edge-cloudfront

CloudFront edge in front of the collector-core Lambda Function URL: no caching, POST passthrough, WAFv2 rate limiting and body-size capping, and an origin custom header injecting the `x-collector-edge-key` shared secret so the origin can reject traffic that bypassed the edge.

Requires collector-core deployed with `edge_auth.mode = "shared_secret"` and the same secret value (see `specs/011-real-user-script/contracts/collector-ingest.md`).

## Why a shared secret and not Origin Access Control

OAC would let CloudFront SigV4-sign origin requests against a Function URL with `authorization_type = "AWS_IAM"` — but for OAC-signed **POST/PUT** requests AWS requires the _client_ to send an `x-amz-content-sha256` payload-hash header, and `navigator.sendBeacon` (the agent's transport) cannot set request headers. With OAC, every beacon would be rejected at the Function URL. The origin custom header is the mechanism that works for beacon traffic, so this module uses the same shared-secret pattern as `edge-cloudflare`.

## Shared-secret trade-off

Per the contract's edge-to-origin authentication table: the shared secret is the only thing keeping direct-to-Function-URL traffic out, so **a leak means edge bypass until the secret is rotated** in both this module and collector-core. Rotate by applying a new secret to core and edge together; the Lambda compares in constant time and drops mismatches with a `rum_edge_auth_failure` metric. The secret is `sensitive` in Terraform but still present in state — protect the state accordingly. Note that only requests through the distribution traverse the WAF: the rate limit and body-size cap keep fronting the origin, but they bound nothing for traffic that bypasses the edge with a leaked secret (the Lambda still validates every beacon).

## Provider configuration

CloudFront-scoped WAFv2 web ACLs can only be created in `us-east-1`, so this module requires **two** AWS provider configurations: the default one and a `us-east-1` alias.

```hcl
provider "aws" {
  region = "ap-southeast-2"
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "edge" {
  source              = "../../edge-cloudfront"
  origin_function_url = module.collector.function_url
  name_prefix         = "rum"
  edge_shared_secret  = var.edge_shared_secret

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}
```

## Custom domain

`acm_certificate_arn`, `route53_zone_id`, and `domain_name` are all-or-none. When set, the distribution serves `domain_name` with the given certificate (which must live in `us-east-1`, per CloudFront) and the module creates A/AAAA alias records; when omitted, the default `*.cloudfront.net` domain and certificate are used.

**Production hardening**: prefer a custom domain with an ACM certificate. The default CloudFront certificate pins the viewer-side minimum TLS version to TLSv1 and cannot be raised; with a custom domain the module sets `minimum_protocol_version = "TLSv1.2_2021"`. The default-domain path remains supported for evaluation and non-production stacks.

## Body-size enforcement

WAFv2 inspects CloudFront request bodies only up to a fixed tier (16/32/48/64 KB). The module picks the smallest tier covering `max_body_kb` and blocks anything the inspection window cannot fully cover (`oversize_handling = "MATCH"`), so bodies above `max_body_kb` are always rejected. `max_body_kb` is therefore capped at 64.

## Outputs

- `collector_endpoint` — `https://` URL (custom domain when configured, else the distribution domain).
