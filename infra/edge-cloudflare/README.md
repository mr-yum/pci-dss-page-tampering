# edge-cloudflare

Cloudflare edge in front of the collector-core Lambda Function URL: a proxied DNS record, a per-IP rate-limiting ruleset, and a Transform Rule injecting the `x-collector-edge-key` shared secret so the origin can reject traffic that bypassed the edge.

Requires collector-core deployed with `edge_auth.mode = "shared_secret"` and the same secret value (see `specs/011-real-user-script/contracts/collector-ingest.md`).

## Prerequisites the module cannot manage

- **Full (Strict) TLS is a zone-level setting.** The consumer's zone must have SSL/TLS encryption mode set to **Full (Strict)** so Cloudflare validates the Function URL's public certificate on the origin leg. This module only creates the proxied record; with a weaker zone mode the edge-to-origin hop is not strictly verified.
- **One entrypoint ruleset per phase per zone.** This module claims the zone's `http_ratelimit` and `http_request_late_transform` phases. If the zone already carries rulesets in those phases, merge the rules there instead of applying this module as-is.

## Shared-secret trade-off

Per the contract's edge-to-origin authentication table: the shared secret is the only thing keeping direct-to-Function-URL traffic out, so **a leak means edge bypass until the secret is rotated** in both this module and collector-core. Rotate by applying a new secret to core and edge together; the Lambda compares in constant time and drops mismatches with a `rum_edge_auth_failure` metric. The secret is `sensitive` in Terraform but still present in state — protect the state accordingly.

## Naming

`record_name` is taken as the fully qualified hostname (e.g. `collect.example.com`), not a zone-relative label; `collector_endpoint` is simply `https://<record_name>`.

## Outputs

- `collector_endpoint` — `https://` URL for the page's CSP `connect-src` and the agent's `data-collector`.
