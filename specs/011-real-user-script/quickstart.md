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
npm run test:unit -- --testPathPatterns agent/src   # jsdom project: agent, capture, fingerprint, session dedupe
cp dist/agent/agent.js test/fixtures/rum-page/agent.js   # the page loads ./agent.js; build:agent first
npx serve -l 3000 test/fixtures/rum-page &          # fixture SPA: soft navigations, inline/external/CSP cases
# open http://localhost:3000?collector=http://localhost:9999 — the fixture wires data-collector
cp origin-targets.local.example.json origin-targets.local.json   # one-time: local origin map (gitignored; adjust as needed)
npx tsx collector/dev-server.ts       # local stand-in: runs the REAL ingest handler in-process,
                                      # origin map from origin-targets.local.json,
                                      # archive → ./tmp/archive/, queue → ./tmp/queue/*.json
                                      # PORT=<n> if 9999 is taken — match it in the ?collector= URL
```

Browse the fixture page; watch `./tmp/queue/` fill with first-sighting messages and `./tmp/archive/` with verbatim beacons. Repeat visits produce no new queue files (novelty), only counter bumps.

The copied `test/fixtures/rum-page/agent.js` is a build artefact; it is gitignored and prettier-ignored, so leaving it in place is harmless.

Narrow a run with `--testPathPatterns`, never a bare word: `npm run test:unit -- agent` looks like a filter but is not one — the script already passes `--selectProjects unit unit-agent`, so `agent` is parsed as a third project name and all 64 suites run anyway. A second `--selectProjects` appends rather than replaces, for the same reason; to run one project alone, bypass the script (`npx jest --selectProjects unit-agent`).

## 2. Schema round-trip (the three-way contract)

```bash
npm run test:unit -- --testPathPatterns src/types/beacon   # canonical fixtures, rejection cases
```

Agent, collector, and comparator tests all import the same fixtures from `test/fixtures/beacons/` — if a change breaks one consumer, this suite is where it shows first.

## 3. Comparator against a local queue and file:// inventory

```bash
npm start -- --mode rum-compare \
  --repo file://$PWD/../script-inventory --git-token dummy \
  --rum-queue-url file://$PWD/tmp/queue     # file:// queue adapter for local dev
```

`--git-token` is still required (only `--mode validate` waives it for a `file://` repo), hence the dummy. Point `--repo` at a throwaway clone, not your working inventory checkout: the inventory lane really does commit and push candidates to `--inventory-branch` on a `file://` remote — only PR creation is skipped, and only because the remote is not GitHub HTTPS.

- Detection-pass message (uninventoried URL) → `rum_uninventoried_script_detected` logged to console (no `--slack-token`), carrying prevalence, first route and the `inventoryRef` SHA it was judged against.
- Inventory-pass message → pending candidate appended on the inventory branch and pushed (inspect the diff).
- Run twice: routed messages are deleted from the queue, so the second run processes nothing. Re-deliver the same message by hand and the diff dedupes it against the pending entry already covering it — `entries appended: 0`, no commit, no PR.

Each `*.json` in the queue directory is one bare `QueueMessage` (`src/rum/drain.ts`) — exactly the body SQS would carry, and exactly what `collector/dev-server.ts` writes, so step 1's output feeds this step directly.

## 4. Terraform modules (no credentials)

Run as one block — the `cd` is what makes the shortened `-chdir` paths resolve:

```bash
cd infra && terraform fmt -check -recursive
tflint --init && TFLINT_CONFIG_FILE=$PWD/../.tflint.hcl tflint --recursive --format compact
terraform -chdir=tests init -backend=false && terraform -chdir=tests test
terraform -chdir=examples/cloudfront-stack init -backend=false && terraform -chdir=examples/cloudfront-stack test
terraform -chdir=examples/cloudflare-stack init -backend=false && terraform -chdir=examples/cloudflare-stack test
./tests/no-vpc-check.sh
```

Terraform ≥ 1.11 is required (`override_during = plan` in the test harness). The suites pin `lambda_package` to `infra/tests/fixtures/placeholder.zip`, so no `npm run build:collector` is needed first. `init` leaves `.terraform/` and lock files behind in each directory — gitignored, but see the Housekeeping notes in `infra/tests/README.md`.

`tflint` is the one step here that needs a tool the repo does not install; skip it locally if you do not have it, but `.github/workflows/infra.yml` runs it before any `init`, so a locally clean run can still fail CI on lint.

Mocked-provider tests assert: required inputs, edge/`edge_auth` pairing, alarm presence, output wiring. The no-VPC contract is enforced by `tests/no-vpc-check.sh`, a source-level guard (`terraform test` cannot assert the absence of a resource type across a plan). See `infra/tests/README.md` for coverage details and known plan-time gaps.

## 5. Integration suite

```bash
npm run test:integration -- --testPathPatterns rum
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

`$COLLECTOR_ENDPOINT` must be the **edge** endpoint (the `collector_endpoint` output of `edge-cloudfront` / `edge-cloudflare`), not the Lambda Function URL: the edge is what injects `x-collector-edge-key`, and the handler rejects — silently, with a 204 — anything reaching it without that header. Everything else about the request is the ingest contract: the default path (anything other than `/csp-reports`) is the beacon route, `Origin` must be an exact string match against a configured `origin_targets` entry (it is the sole authority on target and pass), and `text/plain` is what `sendBeacon` sends. Expect **204 with an empty body whatever happens** — auth failure, unmapped origin and schema rejection are indistinguishable from success by design (no-oracle), so confirm delivery from `rum_beacons_accepted` and the queue, never from the response.

The same fixture is what the permanent scheduled canary posts; its absence alarms (queue-age + canary assertions in the inventory repo workflow).

## Gates before commit (unchanged repo rules)

`npm run precommit` · `/coderabbit:review --base main` · `branch-review` skill (staged scope) — plus §4's Terraform block for `infra/` changes. User-facing behaviour lands with its README.md and AGENTS.md updates in the same change, as the `--rum-queue-url` / `rum-compare` rows and the RUM surveillance architecture entry did.
