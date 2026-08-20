# Contract: Collector Ingest (HTTP)

**Parties**: browser agent → edge (CloudFront or Cloudflare) → ingest Lambda (Function URL)

## Request

- `POST /` with body = one Beacon (beacon-schema.md), `Content-Type: text/plain` (CORS-safelisted — no preflight; the agent never sends a content type requiring one).
- `Origin` header: required de facto — beacons without a mapped `Origin` are dropped and counted.
- No authentication from the page (pages cannot hold secrets). Abuse is bounded by edge rate limiting and payload caps; forged beacons can only add noise (prevalence context is the triage tool).

## Edge → origin authentication

Both edges authenticate to the origin with an edge-injected shared-secret header. CloudFront's OAC (IAM-signed origin requests, Function URL auth `AWS_IAM`) is deliberately not used: for OAC-signed POST/PUT requests AWS requires the **client** to send `x-amz-content-sha256`, and `navigator.sendBeacon` cannot set headers — every beacon would be rejected at the Function URL.

| Edge       | Mechanism                                                            | Lambda obligation                                                                                                             |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| CloudFront | Origin custom header injects `x-collector-edge-key: <shared secret>` | constant-time compare against configured secret **before** reading the body; mismatch → drop + `rum_edge_auth_failure` metric |
| Cloudflare | Transform Rule injects `x-collector-edge-key: <shared secret>`       | as above; optional source-IP check against Cloudflare ranges                                                                  |

## Response

- Always `204 No Content`, empty body, no CORS response headers needed (beacon responses are opaque to the page). The response MUST NOT vary by validation outcome — no oracle for probing the schema or origin map.

## Processing pipeline (per accepted request)

1. Edge auth (above) → 2. `Origin` → `origin_targets` lookup → stamp `target_id`, `target_type` → 3. strict Zod parse → 4. Firehose `PutRecord` (verbatim beacon + stamp + `received_at`) → 5. per observation (except `agent-health`): novelty conditional write → first sighting? enqueue SQS message (queue-message.md) : update counters.

Failure semantics: steps 4–5 are at-least-once; a crash between them can re-deliver on retry — downstream idempotency (novelty pk, routing) absorbs it. A Firehose failure fails the request internally (retry via client resend is acceptable loss — coverage is statistical) but never changes the 204.

## Metrics (CloudWatch, dimensioned by target where applicable)

`rum_beacons_accepted`, `rum_beacons_rejected` (reason: schema|size|version), `rum_unmapped_origin`, `rum_edge_auth_failure`, `rum_first_sightings`, `rum_observations_counted`. Beacon-volume anomaly alarms hang off `rum_beacons_accepted` per target.
