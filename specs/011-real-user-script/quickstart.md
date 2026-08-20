# Quickstart: Real-User Script Surveillance (developer loop)

How to build, exercise, and verify each component locally, without AWS, plus the one end-to-end check that needs a deployed stack. Adopter-facing deployment steps live in `docs/rum/IMPLEMENTATION.md`; this file is for developers of this repo.

## Build

```bash
npm ci
npm run build:agent        # esbuild → dist/agent/agent.js (single IIFE) + SRI hash printed
npm run build:collector    # esbuild → dist/collector/ingest.zip
npm run build:js           # existing SWC build for src/ (unchanged)
```

## 1. Agent against a fixture page

```bash
npm run test:unit -- agent            # co-located jsdom tests: capture, fingerprint, session dedupe
npx serve test/fixtures/rum-page &    # fixture SPA: soft navigations, inline/external/CSP cases
# open http://localhost:3000?collector=http://localhost:9999 — the fixture wires data-collector
npx tsx collector/dev-server.ts       # local stand-in: runs the REAL ingest handler in-process,
                                      # origin map from origin-targets.local.json,
                                      # archive → ./tmp/archive/, queue → ./tmp/queue/*.json
```

Browse the fixture page; watch `./tmp/queue/` fill with first-sighting messages and `./tmp/archive/` with verbatim beacons. Repeat visits produce no new queue files (novelty), only counter bumps.

## 2. Schema round-trip (the three-way contract)

```bash
npm run test:unit -- beacon           # src/types/beacon.test.ts: canonical fixtures, rejection cases
```

Agent, collector, and comparator tests all import the same fixtures from `test/fixtures/beacons/` — if a change breaks one consumer, this suite is where it shows first.

## 3. Comparator against a local queue and file:// inventory

```bash
npm start -- --mode rum-compare \
  --repo file://$PWD/../script-inventory --git-token dummy \
  --rum-queue-url file://$PWD/tmp/queue     # file:// queue adapter for local dev
```

- Detection-pass fixture (uninventoried URL) → `rum_uninventoried_script_detected` logged to console (no `--slack-token`).
- Inventory-pass fixture → pending candidate entry written on the inventory branch (inspect the diff; no push with file:// remote unless configured, same as existing modes).
- Run twice: second run routes nothing new (idempotency on novelty pk + ref).

## 4. Terraform modules (no credentials)

```bash
cd infra && terraform fmt -check -recursive
terraform -chdir=examples/cloudfront-stack init -backend=false && terraform test
terraform -chdir=examples/cloudflare-stack init -backend=false && terraform test
```

Mocked-provider tests assert: required inputs, edge/`edge_auth` pairing, the no-VPC contract, alarm presence, output wiring.

## 5. Integration suite

```bash
npm run test:integration -- rum
```

Drives fixture beacons through: schema → origin stamping → novelty key building → queue message → normalisation → real comparison services against a fixture inventory → routing assertions (right category, right pass, prevalence and route context present, inventory SHA recorded, no duplicates on re-run).

## 6. End-to-end canary (deployed stack only)

```bash
curl -s -X POST "$COLLECTOR_ENDPOINT" \
  -H 'Origin: https://canary.example.test' \
  -H 'Content-Type: text/plain' \
  --data @test/fixtures/beacons/canary.json
# then: run the comparator (or wait one cycle) and expect
# rum_uninventoried_script_detected for the canary target in the OPS channel.
```

The same fixture is what the permanent scheduled canary posts; its absence alarms (queue-age + canary assertions in the inventory repo workflow).

## Gates before commit (unchanged repo rules)

`npm run precommit` · `/coderabbit:review --base main` · `branch-review` skill (staged scope) — plus `terraform fmt/validate/test` for `infra/` changes. README.md gains the `--rum-queue-url` and `rum-compare` rows as part of the same change that lands the mode.
