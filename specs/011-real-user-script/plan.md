# Implementation Plan: Real-User Script Surveillance (RUM Collector)

**Branch**: `011-real-user-script` | **Date**: 2026-08-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/011-real-user-script/spec.md`

## Summary

Extend the PCI DSS 6.4.3/11.6.1 system with continuous observation from real customer sessions. A dependency-free browser agent ships in the SPA app shell (every page, session-long), observes external scripts, inline scripts, and CSP violations, and beacons metadata-only reports to an open-source serverless collector (edge → ingest Lambda → S3 evidence archive + DynamoDB novelty store → SQS). A new `--mode rum-compare` in this tool, scheduled hourly from the inventory repository, evaluates first sightings against the canonical inventory with the existing matcher pipeline: staging observations feed the existing inventory-candidate PR flow; production observations raise new `rum_*` alert categories. The daily synthetic monitor remains the authoritative control; RUM is a breadth tripwire with self-defeat interlocks (agent hash-pinned and synthetically verified, volume anomaly alarms, permanent canary).

Design authority: the blueprint and decision log on the Notion page "2026-08-20 PCI-DSS RUM beacon" (all open decisions resolved 2026-08-20) plus the four clarifications recorded in [spec.md](spec.md) §Clarifications.

## Technical Context

**Language/Version**: TypeScript on Node.js ≥ 24 (repo standard); agent compiled to a single ES2020 IIFE for evergreen browsers (Chrome/Safari/Firefox/Edge, last 2 major)
**Primary Dependencies**: existing stack (Zod, tsx, SWC, Jest 30); new dev-only: esbuild (agent + Lambda IIFE/ESM bundling — SWC does not bundle); comparator adds `@aws-sdk/client-sqs` (SQS drain); ingest Lambda uses the SDK v3 bundled in the AWS Node runtime (no new runtime dep)
**Storage**: S3 (verbatim beacon archive via Firehose, SSE-KMS, 1-year lifecycle), DynamoDB (novelty store, conditional writes, 90-day TTL), SQS (novel-observations + DLQ). No database in this repo's code paths beyond AWS SDK calls
**Testing**: Jest unit tests co-located in `src/`, `agent/src/`, `collector/src/`; integration tests in `test/integration/` (fixture beacons through schema → novelty → comparator normalisation → comparison); `terraform test` with mocked providers for all three modules; agent DOM behaviour against a fixture page in integration
**Target Platform**: browser (agent), AWS Lambda Node 24 (ingest), GitHub Actions runner (comparator mode), Terraform ≥ 1.7 (modules; AWS + Cloudflare providers)
**Project Type**: single repo, three new top-level component roots (`agent/`, `collector/`, `infra/`) beside the existing `src/` tool
**Performance Goals**: agent ≤ 5 ms main-thread work per session p95 on low-end devices (self-measured via agent-health telemetry); detection alert within 90 min of beacon receipt in ≥ 99% of cycles; ingest Lambda p99 < 250 ms
**Constraints**: beacons ≤ 24 observations and ≤ 32 KB (Chrome's 64 KB in-flight sendBeacon budget); snippets 128-char head/tail (head strict prefix, tail strict suffix — preserves existing 64-char anchored matchers); 512 KB client hashing ceiling with fingerprint fallback; no CORS preflight (text/plain); collector responds 204 always; no VPC resources in any module (versioned contract); schema structurally excludes cardholder data
**Scale/Scope**: design envelope ~1M sessions/day across targets, ~3–6 beacons/session after client dedupe; novelty store holds ~10³–10⁴ distinct tuples per 90-day window; SQS sees only first sightings (~tens/day steady state, ~10³ one-time wave at first site-wide rollout)

## Constitution Check

_GATE: evaluated against constitution v1.1.0 before Phase 0; re-checked after Phase 1 design._

| Principle                           | Verdict                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Security-first                   | PASS                        | Purely additive coverage; no existing verification weakened. Fail-secure preserved: unverifiable inline content → unknown; external scripts (content unreadable client-side) are identification-only **in the RUM channel only** — synthetic hash verification is untouched. Beacon schema is structurally incapable of carrying cardholder data; unmapped origins are dropped, never stored.                                       |
| II. Dual-workflow integrity         | PASS                        | Pass identity stamped server-side from the origin map. Detection-pass observations can only alert (read-only); inventory-pass observations only ever produce pending `authorised: false` candidates via PR. The automated system never authorises. Canary uses a dedicated target so no suppression mechanism enters the alert path.                                                                                                |
| III. Git-based audit trail          | PASS                        | Candidate entries arrive as PRs into the inventory repo (existing flow). Every comparison decision records the inventory ref it was judged against; S3 archive adds a verbatim evidence record (1 year).                                                                                                                                                                                                                            |
| IV. Alert completeness & routing    | PASS                        | Three new categories (`rum_uninventoried_script_detected`, `rum_mismatched_script_detected`, `rum_csp_violation_reported`) with prevalence + first-seen-route context; CSP category collected from phase 1, alerting from phase 4 (documented threshold tuning). Alert failures never block processing; queue deletes only after routing.                                                                                           |
| V. Test coverage for security logic | PASS                        | Comparator normalisation and routing covered by co-located unit tests; shared beacon schema tested once, consumed three ways; integration tests drive fixture beacons end-to-end; matcher pipeline itself is reused, not reimplemented (its existing tests stand).                                                                                                                                                                  |
| VI. Minimal complexity              | PASS (justifications below) | Matching is **reused**, never duplicated — the one place semantics could drift. New components (agent, Lambda, Terraform) are irreducible to the feature. New dev dependency esbuild justified (SWC cannot bundle); Terraform three-module split forced by provider mechanics (cannot conditionally require providers). No speculative extension points; event-driven upgrade path is preserved by the SQS boundary, not pre-built. |

Post-Phase-1 re-check: no new violations introduced by the data model or contracts; Complexity Tracking below remains the complete list.

## Project Structure

### Documentation (this feature)

```
specs/011-real-user-script/
├── plan.md              # This file
├── research.md          # Phase 0: consolidated decisions + rationale
├── data-model.md        # Phase 1: beacon, novelty, queue, config, result entities
├── quickstart.md        # Phase 1: local dev + fixture-driven verification
├── contracts/
│   ├── beacon-schema.md         # agent ⇄ collector ⇄ comparator wire contract
│   ├── collector-ingest.md      # HTTP ingest contract (edge auth, responses, metrics)
│   ├── queue-message.md         # SQS novel-observation message contract
│   ├── terraform-modules.md     # collector-core / edge-cloudfront / edge-cloudflare I/O
│   └── cli-rum-compare.md       # new mode + flags contract
└── tasks.md             # Phase 2 (/speckit.tasks — not created by /speckit.plan)
```

### Source Code (repository root)

```
agent/
├── src/
│   ├── agent.ts               # entry: observers, scheduler, flush
│   ├── capture.ts             # MutationObserver/PerformanceObserver/CSP listener glue
│   ├── fingerprint.ts         # head/tail excerpts, length, crypto.subtle hashing, ceilings
│   ├── session.ts             # sessionStorage dedupe, session id, route tracking
│   └── *.test.ts              # co-located unit tests (jsdom)
collector/
├── src/
│   ├── ingest.ts              # Lambda handler: edge auth, origin map, validate, fan out
│   ├── novelty.ts             # conditional-write key building (target#identity#initiatorHost)
│   └── *.test.ts
infra/
├── collector-core/            # lambda, firehose→s3, dynamodb, sqs+dlq, alarms, oidc role
├── edge-cloudfront/           # distribution, WAF, shared-secret origin header
├── edge-cloudflare/           # proxied DNS, ruleset, transform rule (secret header)
├── examples/
│   ├── cloudfront-stack/
│   └── cloudflare-stack/
└── tests/                     # terraform test files (mocked providers)
src/
├── types/beacon.ts            # shared Zod schema (single source of truth)
├── rum/
│   ├── drain.ts               # SQS batch consumption, delete-after-route, DLQ semantics
│   ├── normalise.ts           # queue message → Matchable (targetType stamped, no workflowId)
│   ├── route.ts               # inventory-pass → candidate flow; detection-pass → rum_* alerts
│   └── *.test.ts
├── services/alert/            # extended with rum_* categories (existing slack service)
└── main.ts                    # --mode rum-compare, --rum-queue-url wiring
docs/rum/IMPLEMENTATION.md     # adopter guide (dependency-ordered steps)
test/integration/rum-*.test.ts # fixture beacon → schema → novelty key → normalise → compare → route
```

**Structure Decision**: single repository extended with three component roots. `agent/` and `collector/` are separate roots (not under `src/`) because they build to different targets (browser IIFE, Lambda bundle) with esbuild, while `src/` keeps the SWC/tsx pipeline; all three consume `src/types/beacon.ts` directly so the schema stays one file. `infra/` follows the module split from the decision log. Existing services (`AlertService`, `InventoryService`, comparison services, matcher pipeline) are consumed as-is — no forks, no parallel implementations.

## Complexity Tracking

| Violation                                               | Why Needed                                                                                                                                               | Simpler Alternative Rejected Because                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New dev dependency: esbuild                             | Agent must be a single dependency-free browser IIFE; Lambda must be a self-contained bundle                                                              | SWC (existing) transpiles but does not bundle (spack deprecated); shipping unbundled output would need a runtime loader or a second toolchain anyway                          |
| Three Terraform modules instead of one                  | Terraform providers cannot be conditionally required; a single module declaring the Cloudflare provider forces CloudFront-only consumers to configure it | Single module with `edge` variable rejected — breaks `terraform init` for consumers without Cloudflare credentials                                                            |
| Two new top-level source roots (`agent/`, `collector/`) | Different build targets and runtime constraints (browser sandbox, Lambda) from the Node CLI in `src/`                                                    | Housing them under `src/` rejected — they would inherit the ESM/tsx/SWC pipeline and its assumptions, and the browser bundle must not import Node built-ins even transitively |
