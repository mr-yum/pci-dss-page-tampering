# Phase 0 Research: Real-User Script Surveillance

All material unknowns were resolved during the design phase (blueprint + decision log, Notion page "2026-08-20 PCI-DSS RUM beacon") and the spec clarification session of 2026-08-20. This document consolidates those decisions in Decision/Rationale/Alternatives form so the plan stands alone. No NEEDS CLARIFICATION markers remain.

## R1. Trust model: RUM is a tripwire, synthetic stays authoritative

- **Decision**: Real-user observation extends coverage; the daily synthetic Puppeteer run remains the authoritative 11.6.1 control.
- **Rationale**: The agent runs inside the environment it monitors — a page-owning attacker can suppress or spoof beacons. RUM buys breadth (real geographies, UAs, cloaked/session-targeted attacks the synthetic run cannot see); it cannot buy certainty. Self-defeat interlocks (R12) convert suppression into signal.
- **Alternatives considered**: RUM as primary control — rejected; unverifiable against an attacker who owns the page.

## R2. Single collector, server-side pass identity

- **Decision**: One collector stack serves staging and production; each observation's target and pass (`inventory`/`detection`) is stamped at ingest from the request `Origin` against an operator-configured `origin_targets` map. Unmapped origins are counted and dropped.
- **Rationale**: Pass identity must be tamper-proof, so it derives from a header the page cannot vary per-claim; once identity is server-assigned, a second stack adds infrastructure without adding trust. Novelty keys include the target, so environments cannot collide.
- **Alternatives considered**: Stack per environment (identity = which stack received it) — rejected as more infrastructure for no trust gain.

## R3. Site-wide, session-long agent

- **Decision**: The agent ships in the SPA app shell, first script on every page, observers persisting across History-API soft navigations; each observation is stamped with the route active at capture.
- **Rationale**: In a SPA the payment view is a route inside one long-lived JS context; a script loaded on any route is still live at card entry. Page-scoped monitoring misses exactly the injection point an attacker would pick. Route is captured as triage context (checkout-route sightings outrank browse-route ones) but never forms identity (clarification #1).
- **Alternatives considered**: Checkout-route-only agent — rejected (blind to cross-route persistence); route in the novelty key — rejected (cardinality/noise; re-alerts per route).

## R4. Observation fingerprints: snippet-only, 128-char head/tail

- **Decision**: Inline scripts are fingerprinted as SHA-256 (when computable) + length + anchored 128-char head and 128-char tail excerpts; no full-content option. Head is a strict content prefix, tail a strict suffix.
- **Rationale**: Structurally bounds payload sensitivity (no full source ever leaves the page) while preserving matcher compatibility — existing 64-char anchored matchers match inside the 128-char window unchanged. Footprint validated: ~1 KB/observation in memory; the constraint is the wire, handled by R5.
- **Alternatives considered**: Full inline content under ~4 KB — rejected (larger sensitivity surface for marginal matching gain); 64-char excerpts — superseded by the 2026-08-20 decision for more matching material at negligible cost.

## R5. Beacon transport and caps

- **Decision**: JSON body sent via `sendBeacon` as `text/plain`; ≤ 24 observations and ≤ 32 KB per beacon, agent splits a flush across beacons; hashing ceiling 512 KB with `(length, head, tail)` fallback flagged `oversize`; session-long dedupe in `sessionStorage` before any hashing.
- **Rationale**: `text/plain` is CORS-safelisted → no preflight (an `application/json` Blob doubles requests); 24 × ~1.3 KB JSON-escaped worst case stays under both the 32 KB body cap and Chrome's 64 KB total in-flight `sendBeacon` budget. Idle-time processing (capture-eagerly, compute-lazily) keeps main-thread work ≤ 5 ms p95 — hashing itself is native and sub-millisecond; the cost to guard is synchronous work in observer callbacks.
- **Alternatives considered**: `application/json` + preflight handling — rejected; fetch-keepalive-only — retained as fallback path where sendBeacon is unavailable; Web Worker offload — deferred (string-copy cost ≈ encode cost; revisit only if agent-health telemetry shows contention).

## R6. Novelty semantics

- **Decision**: First-sighting key = `target + script identity (URL for external / content fingerprint for inline) + initiator host`, rolling 90-day TTL window, conditional-write (`attribute_not_exists`) in DynamoDB; repeats update prevalence counters (sessions, first/last seen, first-seen route) without re-queueing.
- **Rationale**: Initiator host in the key means a known script re-injected by a new source re-alerts — exactly the supply-chain signal (clarification #1). 90 days balances re-scrutiny of returning scripts against seasonal-path noise (clarification #2). Conditional writes make dedupe one idempotent operation, collapsing ~1M sessions/day to tens of evaluations.
- **Alternatives considered**: identity-only key (silent on new injectors — rejected); +route (noise — rejected); 30-day window (monthly-path re-alert churn) and 1-year (near-permanent trust) — rejected.

## R7. Comparator runtime: hourly GHA in the inventory repo, both lanes

- **Decision**: `--mode rum-compare` drains SQS in a scheduled hourly GitHub Actions workflow in the inventory repository (OIDC role from the Terraform module), for both the detection lane (alerts) and the inventory lane (candidate PRs). Worst-case detection latency ~60–90 min accepted.
- **Rationale**: The comparator's runtime, secrets, and inventory checkout already live there; single-scheduler principle holds (everything reading or writing the private inventory runs from its workflows); deletes an entire second runtime (compare Lambda bundle, snapshot publishing, credentials in AWS). The SQS boundary preserves the event-driven upgrade without touching ingest.
- **Alternatives considered**: Fargate consumer — rejected (always-on-ish compute for a batch job); event-driven Lambda + validated inventory snapshot — rejected for v1 (second runtime home; secrets in AWS), retained as the documented upgrade path if the queue-age metric proves hourly insufficient.

## R8. External scripts are identification-only in the RUM channel

- **Decision**: Unknown external URL/host → alert; known URL with unverifiable content → recorded, not alerted. Inline scripts are held to full content authorisation via fingerprints, failing secure.
- **Rationale**: Cross-origin response bodies are opaque to the client (no CORS → no bytes, no hash); applying the fail-secure null-content rule verbatim would misfire on every external script and bury real alerts. Synthetic hash verification of external scripts is unchanged. A server-side refetch is a triage aid only — cloaking means the server may see different bytes than the user did.
- **Alternatives considered**: Treating unverifiable as violation — rejected (alert storm, no signal); trusting server-side refetch as verification — rejected (defeated by the exact attack class RUM exists to catch).

## R9. Terraform shape: edge-agnostic core + two edge modules, no VPC

- **Decision**: `collector-core` (Lambda, Firehose→S3, DynamoDB, SQS+DLQ, alarms, OIDC role) never declares an edge provider; `edge-cloudfront` (distribution+WAF+OAC, IAM-signed origin) and `edge-cloudflare` (proxied DNS, rate-limit ruleset, transform-rule shared-secret header verified in the Lambda) are separate modules composed in examples. No module creates VPC resources — a versioned compatibility contract. Estate-owned dependencies (KMS, SNS, cert/zone, OIDC provider) are injectable with self-contained defaults; raw-archive retention default 1 year.
- **Rationale**: Providers cannot be conditionally required; serverless-only is what lets the stack drop into any account structure. The Cloudflare origin-auth trade (secret leak = edge bypass until rotation) is accepted and documented — the payload is validated harmless metadata regardless.
- **Alternatives considered**: One module with an `edge` variable — rejected (breaks init for consumers without Cloudflare credentials); API Gateway instead of Function URL — rejected (validation lands in a consumer anyway; Function URL + edge is cheaper and simpler).

## R10. Alerting: three new categories, phase-gated CSP

- **Decision**: `rum_uninventoried_script_detected`, `rum_mismatched_script_detected`, `rum_csp_violation_reported`, each carrying prevalence and first-seen-route context, delivered by the existing AlertService. CSP violations are collected/archived/counted from phase 1 but alert only from phase 4, after thresholds are tuned against the observed baseline.
- **Rationale**: Distinct categories because response differs from synthetic alerts (RUM findings need prevalence triage and may be irreproducible synthetically). Real-user CSP reports carry heavy browser-extension noise — alerting on day one would swamp the channel before anyone trusts the signal (clarification #4).
- **Alternatives considered**: Reusing synthetic categories — rejected (conflates reproducible/deterministic findings with statistical ones); CSP alerting from phase 1 — rejected (noise); never alerting CSP — rejected (drops an independent signal).

## R11. Canary isolation

- **Decision**: The permanent canary posts a fixture observation against a dedicated canary target in the origin map whose alerts route to the ops/monitoring channel; canary silence itself alarms.
- **Rationale**: Exercises the entire real pipeline (ingest → novelty → comparison → alert routing) with zero suppression machinery in the alert path, and the security channel never receives a scheduled "ignore me" alert (clarification #3).
- **Alternatives considered**: Real target + suppressed marker — rejected (a machine-bypassable hole in the alert path); alerting the security channel labelled as canary — rejected (attention erosion).

## R12. Self-defeat interlocks

- **Decision**: (a) the agent artefact is inventoried and hash-pinned, and the daily synthetic run verifies its presence and byte-identity on monitored pages; (b) per-target beacon-volume anomaly alarms; (c) queue-age alarm at 3 h (two missed hourly cycles); (d) DLQ depth and Lambda error-rate alarms. All defined in `collector-core`.
- **Rationale**: Defeating RUM silently must require defeating three independent mechanisms. The 3 h threshold avoids flapping — with hourly draining, oldest-message age routinely approaches ~75 min.
- **Alternatives considered**: 90-min queue-age alarm — rejected after the hourly-cadence decision (would flap on normal cron drift).

## R13. Toolchain: esbuild for agent and Lambda bundles

- **Decision**: esbuild (dev dependency) bundles `agent/` to a single ES2020 IIFE and `collector/` to a self-contained Lambda ESM bundle; `src/` keeps SWC/tsx unchanged. Releases are single-tag: agent JS + SRI string + ready-to-paste inventory entry, ingest zip + checksum, Terraform modules at the same ref.
- **Rationale**: SWC transpiles but does not bundle (spack deprecated); the agent must be dependency-free and loader-free; the Lambda must not rely on node_modules layout. Single-tag releases mean one version pins everything an adopter consumes.
- **Alternatives considered**: Rollup/webpack — heavier for identical output; shipping unbundled — rejected outright for a first-script payment-page asset.

## R14. Scale envelope (deferred item from clarification session, resolved here)

- **Decision**: Design envelope ~1M sessions/day, 3–6 beacons/session post-dedupe; novelty store 10³–10⁴ distinct tuples per window; SQS traffic is first-sightings only (~tens/day steady state; ~10³ one-time wave at first site-wide rollout, which is planned-for review workload, not a defect).
- **Rationale**: Every component in the path (Function URL, Firehose, DynamoDB on-demand, SQS) scales past this envelope by orders of magnitude without architectural change; cost at this envelope is dominated by Firehose/S3 and remains trivial. No sampling: client-side dedupe makes 100%-of-sessions observation affordable, and sampling would create exactly the blind spots RUM exists to remove.
- **Alternatives considered**: Session sampling — rejected (blind spots, and the cheap-device population an attacker targets is the one most likely sampled out); Kinesis Streams — rejected below tens of millions of beacons/day.
