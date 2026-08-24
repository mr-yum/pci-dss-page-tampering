# Tasks: Real-User Script Surveillance (RUM Collector)

**Input**: Design documents from `/specs/011-real-user-script/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution Principle V mandates automated coverage for comparison, alerting, and security logic; unit tests are co-located with source, integration tests live in `test/integration/`.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md) so each story is independently implementable and testable. US1 is the MVP.

## Phase 1: Setup

- [x] T001 Add esbuild dev dependency and `build:agent` / `build:collector` scripts to package.json (agent → single ES2020 IIFE with printed SRI hash; collector → self-contained Lambda ESM zip), plus `agent/`, `collector/`, `infra/` roots with tsconfig references that exclude them from the SWC `src/` pipeline
- [x] T002 [P] Create shared fixture directories: `test/fixtures/beacons/` (canonical + rejection + canary JSON fixtures per contracts/beacon-schema.md) and `test/fixtures/rum-page/` (fixture SPA skeleton with soft navigations)

## Phase 2: Foundational (blocking all user stories)

- [x] T003 Implement the shared beacon Zod schema in src/types/beacon.ts per data-model.md §1–2 (strict envelope, four observation kinds, all caps: ≤24 observations, ≤32 KB, 128-char head/tail, ≤2048-char URLs, version literal `v: 1`)
- [x] T004 Write co-located schema tests in src/types/beacon.test.ts against the shared fixtures: accept canonical example; reject unknown key, 25th observation, 129-char head, non-hex hash, missing ts, oversize body
- [x] T005 [P] Implement the novelty key builder in collector/src/novelty.ts (`{target_id}#{identity}#{initiator_host}` per data-model.md §4: external URL / `inline:{hash|fallback}` identity, `-` for absent initiator, route never in the key) with co-located tests in collector/src/novelty.test.ts
- [x] T006 Implement the ingest Lambda handler in collector/src/ingest.ts per contracts/collector-ingest.md: edge auth (AWS_IAM passthrough or constant-time shared-secret header check before body read), Origin → origin_targets stamping, strict schema parse, Firehose put, DynamoDB conditional PutItem / UpdateItem counters, SQS enqueue of first sightings (queue-message.md shape), always-204 no-oracle responses, CloudWatch metrics (accepted/rejected/unmapped/edge-auth-failure/first-sightings)
- [x] T007 Write co-located ingest tests in collector/src/ingest.test.ts with mocked AWS clients: stamping per origin, unmapped-origin drop+count, agent-health never enqueued, first-sighting vs repeat paths, 204 invariance across outcomes
- [x] T008 [P] Implement the local dev server in collector/dev-server.ts running the real handler in-process with file-backed archive (`./tmp/archive/`) and queue (`./tmp/queue/*.json`), origin map from origin-targets.local.json (quickstart.md §1)
- [x] T009 Author Terraform module infra/collector-core/ per contracts/terraform-modules.md (Lambda + Function URL with edge_auth modes, Firehose→S3 SSE-KMS with archive_retention_days=365, DynamoDB on-demand with TTL, SQS+DLQ maxReceiveCount=3, four alarm sets → SNS, OIDC role scoped to SQS-consume + metrics-read, all declared outputs)
- [x] T010 [P] Author Terraform module infra/edge-cloudfront/ (distribution with POST passthrough + no caching, WAFv2 rate limit + size constraint, shared-secret origin header — OAC rejected in review: signed POSTs need client-supplied x-amz-content-sha256, which sendBeacon cannot set; collector_endpoint output)
- [x] T011 [P] Author Terraform module infra/edge-cloudflare/ (proxied DNS Full-Strict, rate-limiting ruleset, transform rule injecting x-collector-edge-key; collector_endpoint output)
- [x] T012 [P] Author runnable examples infra/examples/cloudfront-stack/ and infra/examples/cloudflare-stack/ composing core + one edge each, RFC-reserved domains and fictional values only
- [x] T013 Write `terraform test` suites in infra/tests/ with mocked AWS and Cloudflare providers: required inputs, edge/edge_auth mode pairing failures, the source-level no-VPC guard (tests/no-vpc-check.sh — no aws_vpc/aws_subnet/aws_security_group declared under infra/), alarm presence, output wiring (contracts/terraform-modules.md §Test obligations)
- [x] T014 Add CI jobs to .github/workflows/: build + unit-test agent and collector bundles on PR; terraform fmt/validate/tflint/test for infra/ changes; no credentials, no applies

**Checkpoint**: schema, collector, and infrastructure exist and are contract-tested — user story phases can begin.

## Phase 3: User Story 1 — Unknown-script tripwire on production (P1) 🎯 MVP

**Goal**: an uninventoried script observed in real production traffic produces a `rum_uninventoried_script_detected` alert within one hourly cycle, carrying prevalence and first-seen-route context.

**Independent Test**: post the fixture beacon for an uninventoried external URL from an allowed production origin; assert the alert (category, target, URL, route, prevalence) after a comparator run; re-run and assert no duplicate alert.

- [x] T015 [P] [US1] Implement agent session layer in agent/src/session.ts (random UUID session id, sessionStorage dedupe set, History-API route tracking) with co-located jsdom tests in agent/src/session.test.ts
- [x] T016 [P] [US1] Implement external-script capture in agent/src/capture.ts (MutationObserver childList+subtree for script src, PerformanceObserver resource entries with buffered:true, initiator attribution, route stamping; callbacks capture-and-enqueue only) with co-located tests in agent/src/capture.test.ts
- [x] T017 [US1] Implement agent entry in agent/src/agent.ts (data-collector config, requestIdleCallback processing with setTimeout fallback, flush on visibilitychange/pagehide via sendBeacon text/plain with fetch-keepalive fallback, beacon splitting at 24 observations / 32 KB) with co-located tests in agent/src/agent.test.ts
- [x] T018 [P] [US1] Build the fixture SPA (delivered by T002's fixture; verified against T018 scope) in test/fixtures/rum-page/ (external script loads, dynamic insertion, soft navigations) wired to a configurable collector URL for manual and integration use (quickstart.md §1)
- [x] T019 [P] [US1] Implement SQS drain in src/rum/drain.ts per contracts/queue-message.md (batch receive, visibility handling, delete-only-after-route, malformed/unknown-version → DLQ path) with co-located tests in src/rum/drain.test.ts using a mocked SQS client and the file:// queue adapter for local dev
- [x] T020 [US1] Implement normalisation in src/rum/normalise.ts per data-model.md §6 (queue message → Matchable; targetType from message; workflowId never set; external scripts flagged identification-only) with co-located tests in src/rum/normalise.test.ts
- [x] T021 [US1] Add the three `rum_*` alert categories to the alert types and inventory alerts{} config schema in src/types/ and src/services/alert/, with context fields for prevalence (sessions, first/last seen) and first-seen route, and co-located tests asserting category routing per target config
- [x] T022 [US1] Implement detection-lane routing in src/rum/route.ts (identification-only evaluation for external scripts via existing ScriptComparisonService; unidentified → rum_uninventoried_script_detected with prevalence + route + inventory SHA; identified+authorised → recorded; alert failure never blocks; idempotent on novelty pk + ref) with co-located tests in src/rum/route.test.ts
- [x] T023 [US1] Wire `--mode rum-compare` and `--rum-queue-url` into src/main.ts per contracts/cli-rum-compare.md (parameter validation incl. rejection outside the mode, run summary output, exit-code semantics, --report-dir integration) with co-located tests for argument handling
- [x] T024 [US1] Write integration test test/integration/rum-tripwire.test.ts: fixture external-script beacon → schema → stamping → novelty key → queue message → normalise → real comparison services against a fixture inventory → alert assertion (category, context, SHA); second run routes nothing (idempotency)
- [x] T025 [US1] Add README.md rows for `rum-compare` in the Execution Modes table and `--rum-queue-url` in Optional Parameters (contracts/cli-rum-compare.md)

**Checkpoint**: MVP shippable — deploy collector, embed agent, schedule the mode, and the unknown-origin tripwire is live.

## Phase 4: User Story 2 — Inline script content verification (P2)

**Goal**: inline scripts from real sessions are held to inventory content authorisation via fingerprints; mismatches alert.

**Independent Test**: post an inline-script fixture beacon whose fingerprint fails an identified entry's authorisation; assert `rum_mismatched_script_detected` with matcher context and failure reason.

- [x] T026 [P] [US2] Implement fingerprinting in agent/src/fingerprint.ts (crypto.subtle SHA-256, length, strict-prefix 128-char head, strict-suffix 128-char tail, 512 KB ceiling with oversize flag, cheap pre-hash local dedupe fingerprint) with co-located tests in agent/src/fingerprint.test.ts including multibyte boundary cases
- [x] T027 [US2] Extend agent/src/capture.ts + agent.ts for inline scripts: source capture at insertion, initiator attribution via the page-attribution technique, idle-time hashing pipeline, degraded (hash-absent) path when crypto.subtle unavailable — with tests covering the fallback
- [x] T028 [US2] Extend src/rum/normalise.ts for inline observations (hash, anchored head/tail windows as content evidence, fail-secure when unverifiable) with tests asserting an existing 64-char anchored matcher evaluates identically against fingerprint and full content
- [x] T029 [US2] Extend src/rum/route.ts detection lane with rum_mismatched_script_detected (matcher details, failure reason, metadataPath from the existing comparison result types) with co-located tests
- [x] T030 [US2] Write integration test test/integration/rum-inline.test.ts covering: authorised inline (recorded, no alert), mismatch (alert with reason), oversize fallback (evaluated, never dropped), hash-absent degraded observation (fail-secure)

**Checkpoint**: full inline pipeline — both script kinds evaluated with existing matcher semantics.

## Phase 5: User Story 3 — Staging real usage feeds the inventory (P3)

**Goal**: novel scripts from staging sessions open pending (`authorised: false`) inventory candidate PRs; nothing is ever auto-authorised.

**Independent Test**: post a novel-script fixture beacon from a staging origin; assert a pending candidate entry lands on the inventory branch; re-run and assert no duplicate; assert the automated path never sets `authorised: true`.

- [x] T031 [US3] Implement inventory-lane routing in src/rum/route.ts feeding the existing InventoryService candidate flow (provenance-based matcher generation reused as-is; idempotent against entries already covering the script; PR flow unchanged) with co-located tests
- [x] T032 [US3] Write integration test test/integration/rum-inventory-candidates.test.ts: novel staging script → pending entry diff on the inventory branch; duplicate observation → no second entry; staging-scoped (targetTypeMatcher) authorisation → same script on a production origin still alerts as unknown
- [x] T033 [US3] Extend the run summary and --report-dir artefacts in src/rum/ + src/services/report/ so RUM runs record processed/alerted/candidates/recorded/DLQ counts and the inventory SHAs used, with tests

**Checkpoint**: both lanes live — detection alerts and human-gated inventory growth from real traffic.

## Phase 6: User Story 4 — The monitor notices its own defeat (P4)

**Goal**: suppression, tampering, and pipeline stalls become alarms; the canary permanently proves the full path; CSP alerting activates.

**Independent Test**: per-target volume drop fires the anomaly alarm (terraform test assertion + fixture metrics); aged queue fires staleness alarm; altered agent bytes flagged by the synthetic run; canary fixture produces its ops-channel alert and its absence alarms.

- [x] T034 [P] [US4] Extend agent capture for `securitypolicyviolation` events and the per-session `agent-health` observation (p95 task time via self-instrumented marks, drop count) in agent/src/capture.ts + agent.ts with co-located tests
- [x] T035 [US4] Activate rum_csp_violation_reported in src/rum/route.ts (was recorded-only pre-phase-4) with prevalence-threshold gating from alert config, plus tests covering the noise-floor behaviour (extension-injected violation below threshold → recorded, not alerted)
- [x] T036 [US4] Extend the ingest Lambda to emit agent-health metrics (p95TaskMs distribution, dropped count per target) for the SC-003 evidence trail, with tests in collector/src/ingest.test.ts
- [x] T037 [US4] Extend the synthetic detection pass to assert the RUM agent's presence and hash on every monitored page (agent entry identified in inventory but absent from the page → alert) in src/services/detection.ts + comparison services, with co-located tests
- [x] T038 [US4] Add the CSP report-to ingestion path to collector/src/ingest.ts (accept report-to/report-uri payloads on a dedicated path, map to csp-violation observations, same stamping and novelty flow) and document it as an addendum in specs/011-real-user-script/contracts/collector-ingest.md, with tests
- [x] T039 [P] [US4] Create the canary fixture test/fixtures/beacons/canary.json (dedicated canary target, deliberately uninventoried marker URL) and the documented inventory-repo workflow snippet (hourly canary post + assertion + alarm-on-absence) for docs/rum/IMPLEMENTATION.md
- [x] T040 [US4] Write integration test test/integration/rum-interlocks.test.ts: canary beacon → ops-channel category routing (never the security channel); agent-tamper fixture → synthetic detection alert; CSP violation above threshold → alert, below → recorded

**Checkpoint**: defeating RUM silently now requires defeating three independent mechanisms.

## Phase 7: User Story 5 — External adopter deploys the reference implementation (P5)

**Goal**: an outsider deploys from this repository alone, following a shipped guide, and passes the canary.

**Independent Test**: follow docs/rum/IMPLEMENTATION.md against a fresh account using only repo contents and released artefacts; passing canary within the guide's steps.

- [x] T041 [US5] Write docs/rum/IMPLEMENTATION.md — the nine dependency-ordered adopter steps (deploy modules → origin map → CSP connect-src → embed agent with SRI → inventory the agent → schedule comparator with sample workflow YAML → alarms to Slack → canary verification → operate/upgrade with the wrapper rule), each with copy-paste material
- [x] T042 [US5] Add the release workflow in .github/workflows/release.yml: on tag vX.Y.Z publish agent-vX.Y.Z.js + SHA-256 + SRI string + ready-to-paste inventory-entry snippet, ingest-vX.Y.Z.zip + SHA-256; Terraform modules consumed at the same tag; CHANGELOG discipline noted in CONTRIBUTING/README
- [x] T043 [P] [US5] Add CODEOWNERS entry for infra/ requiring infra review (contracts/terraform-modules.md shared rules)

**Checkpoint**: the open-source deliverable is complete and self-serve.

## Phase 8: Polish & Cross-Cutting

- [x] T044 [P] Update AGENTS.md (architecture section: RUM components, new mode, alert categories, beacon schema pointer) and verify README.md CLI tables are complete
- [x] T045 [P] Align quickstart npm scripts (`test:unit -- agent`, `test:integration -- rum`, dev-server invocation) with specs/011-real-user-script/quickstart.md and fix any drift
- [x] T046 Run the full gate suite (npm run precommit; terraform fmt/validate/test; /coderabbit:review --base main; branch-review skill over the branch) and address findings before PR

## Dependencies

- Phase 1 → Phase 2 → all story phases. Phase 2 is the hard gate: T003/T004 (schema) block T005–T008 and every story task; T009–T013 (infra) block only deployment, not code-path stories.
- US1 (T015–T025) depends only on Phase 2. **MVP = Phases 1+2+3.**
- US2 (T026–T030) depends on US1's agent core (T016/T017) and comparator skeleton (T019/T020/T022).
- US3 (T031–T033) depends on US1's comparator skeleton; independent of US2.
- US4 (T034–T040) depends on US1 (agent + routing); T035 additionally on US2's route extensions; T037 is independent of the other US4 tasks.
- US5 (T041–T043) depends on Phase 2 infra + US1 (the guide documents a working tripwire); content-complete only after US4 adds the canary snippet (T039 → T041).
- Polish (T044–T046) last.

## Parallel Execution Examples

- **Phase 2**: T005, T008, T010, T011, T012 in parallel after T003/T004; T009 then T013 once modules exist.
- **US1**: T015, T016, T018, T019 in parallel; then T017 (needs T015/T016), T020 (needs T019), T021 ∥ T020; then T022 → T023 → T024 → T025.
- **US2**: T026 ∥ (nothing else initially), then T027 → T028 → T029 → T030.
- **US4**: T034, T037, T039 in parallel; T035/T036/T038 sequential on their files; T040 last.

## Implementation Strategy

Ship the MVP first: Phases 1–3 deliver the unknown-origin tripwire end-to-end (deployable collector, agent capturing external scripts, hourly comparator, one alert category, README rows) — the highest-value slice per research R1/R14. Each subsequent story is an independently testable increment matching the spec's delivery phases; stop-and-validate checkpoints close every phase. The first site-wide staging rollout after US3 will produce the expected one-time candidate wave — schedule review capacity for it rather than treating it as a defect.
