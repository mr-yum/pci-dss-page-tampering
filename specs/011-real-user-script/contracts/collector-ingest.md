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

1. Edge auth (above) → 2. `Origin` → `origin_targets` lookup → stamp `target_id`, `target_type` → 3. strict Zod parse → 4. Firehose `PutRecord` (beacon + stamp + `received_at`; `page.url` is redacted to origin + pathname before archival — query and fragment stripped, the same privacy rule as agent routes and CSP document URLs — so tokens/order ids never enter the one-year archive; observations are otherwise archived verbatim) → 5. per observation (except `agent-health`): novelty conditional write → first sighting? enqueue SQS message (queue-message.md) : update counters.

Failure semantics: steps 4–5 are at-least-once; a crash between them can re-deliver on retry — downstream idempotency (novelty pk, routing) absorbs it. A Firehose failure fails the request internally (retry via client resend is acceptable loss — coverage is statistical) but never changes the 204.

## Metrics (CloudWatch, dimensioned by target where applicable)

`rum_beacons_accepted` (dimension TargetId only — the series the volume anomaly alarms consume), `rum_beacons_accepted_by_version` (dimensions TargetId + AgentVersion — a separate metric name, because an extra dimension on `rum_beacons_accepted` would change that series' identity and silently detach the alarms), `rum_beacons_rejected` (dimensions Reason: schema|size|json + AgentVersion — the claimed version when a schema reject's JSON is readable and strictly semver, else `unknown`), `rum_unmapped_origin`, `rum_edge_auth_failure`, `rum_first_sightings`, `rum_observations_counted`, and the agent-health metrics (`rum_agent_p95_task_ms`, `rum_agent_dropped`, dimensions TargetId + AgentVersion). Beacon-volume anomaly alarms hang off `rum_beacons_accepted` per target; the AgentVersion dimensions exist for sensor-release verification — a candidate version's rejects, overhead, and traffic share read directly off the metrics.

**AgentVersion cardinality bound**: the dimension is attacker-influenceable on a public endpoint, so it is bounded twice wherever it appears — by shape (strict `X.Y.Z` semver, else `unknown`) and by value space (a per-container first-seen set caps distinct attributed versions; overflow collapses to `other`). Slot allocation is reserved for ACCEPTED beacons — a rejected body attributes read-only, so unauthenticated garbage can never consume the budget ahead of a real release; a claimed version with zero accepted traffic reads as `other`. Legitimate traffic carries 1–3 live versions, which claim their slots long before a schema-valid spray can crowd them out of a warm container. A configured release allowlist was considered and rejected: it would couple every sensor release to a collector config deploy for no additional practical bound.

## Addendum: browser-native CSP reports — `POST /csp-reports`

A second route on the same Function URL (routed on the event's `rawPath`; the default `/` beacon path is unchanged) ingests the browser's own CSP violation reports, so pages can point `report-uri`/`report-to` at the collector and violations reach the pipeline even when the agent itself is blocked or absent.

### Request

Both delivery formats are accepted, recognised by **body shape**, not `Content-Type` (UAs vary):

- **Legacy `report-uri`** (`application/csp-report`): `{"csp-report": { "document-uri", "effective-directive", "blocked-uri", … }}` — one report per request. `violated-directive` is the accepted pre-CSP2 fallback for a missing `effective-directive`.
- **Reporting API `report-to`** (`application/reports+json`): an array of `{ "type": "csp-violation", "body": { "documentURL", "effectiveDirective", "blockedURL", … } }` records. Records of other report types in the batch (e.g. `deprecation`) are not ours: skipped, never rejected.

The body shares the beacon path's 32 KB pre-parse cap. Edge auth is identical to the beacon path and runs first.

### Origin → target stamping

The `Origin` header, when present, is the sole authority exactly as for beacons — present-but-unmapped drops the whole request (`rum_unmapped_origin`). But CSP reports carry **no `Origin` header in some UAs** (report delivery is not CORS-governed), so when the header is absent the collector falls back to mapping the origin of each report's own document URL (`document-uri` / `documentURL`) against `origin_targets`, per report. If neither maps, the report is dropped and counted as unmapped. The fallback trusts a page-reported field only for _routing to a target the operator already mapped_ — a forged document URL can at worst add noise to a target's triage queue, the same bound as a forged beacon.

### Mapping to observations

Each accepted report becomes a synthetic `csp-violation` observation:

| Observation field | Source                                                                                         | Cap  |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---- |
| `directive`       | `effective-directive` / `effectiveDirective` (legacy fallback: `violated-directive`)           | 128  |
| `blockedUri`      | `blocked-uri` / `blockedURL`; missing → `""` (inline violations)                               | 2048 |
| `route`           | pathname of the document URL — query and fragment stripped (same privacy rule as agent routes) | 512  |
| `ts`              | receipt time (`received_at`); browser-supplied timestamps are not trusted                      | —    |

A report missing its directive or a parseable document URL is rejected (`Reason: schema`).

### Pipeline

Identical to beacon observations from there on: Firehose archives the **verbatim** report record wrapped in a marked envelope `{stamp: {target_id, target_type, received_at}, cspReport}` (the `cspReport` key distinguishes the source from `beacon` records); novelty conditional write under the same `csp:{directive}:{blockedUri}` identity (initiator host `-`); SQS enqueue on first sighting with the standard queue-message.md body. `session_id` is the fixed sentinel `"csp-report"` — browser reports carry no agent session — and satisfies the schema's non-empty-string requirement while marking provenance.

### Response and metrics

Always `204 No Content` — the no-oracle contract holds on this path too. Metrics: `rum_csp_reports_accepted` (dimensioned by target), `rum_csp_reports_rejected` (reason: size|json|schema), plus the shared `rum_unmapped_origin`, `rum_edge_auth_failure`, `rum_first_sightings`, `rum_observations_counted`.
