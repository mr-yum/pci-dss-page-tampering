# Contract: CLI — `--mode rum-compare`

**Parties**: scheduled GitHub Actions workflow (inventory repository) → this tool

## Invocation

```bash
npm start -- --mode rum-compare \
  --repo https://github.com/org/inventory --git-token $TOKEN \
  --rum-queue-url $QUEUE_URL \
  [--slack-token $SLACK_TOKEN] \
  [--inventory-branch <name>] [--detection-branch <name>] \
  [--report-dir <path>]
```

- **New parameters**: `--rum-queue-url <url>` (required with this mode; rejected in other modes). AWS credentials come from the ambient environment (OIDC-assumed role in CI) — never from CLI parameters.
- **Documentation**: README.md rows in the existing Optional Parameters and Execution Modes tables (decided 2026-08-20 — no separate help section yet).
- **Exit codes**: unchanged semantics — 0 success (including "queue empty"), 1 validation error (bad/missing parameters), 2 execution error (git, AWS, comparison failure). Partial batch success with some DLQ-bound messages is exit 0 (the DLQ alarm owns that signal), logged per message.

## Behaviour

1. Load inventory at the pinned ref for each pass's branch (existing deserialization: Zod + `createMatcher()`); record the commit SHA.
2. Drain `--rum-queue-url` in batches until empty or run budget reached; parse per queue-message.md (unknown/malformed → DLQ).
3. Normalise each message to `Matchable` per data-model.md §6 (`targetType` from the message; `workflowId` never set).
4. Evaluate with the existing comparison services — no RUM-specific matching logic. External scripts short-circuit to identification-only.
5. Route per data-model.md §7: detection → `rum_*` alerts via existing AlertService (CSP category no-ops before phase 4, still recorded); inventory → existing InventoryService candidate flow (pending entries, PR — idempotent against already-covered scripts).
6. Delete each message only after its outcome is routed. Emit a run summary (processed / alerted / candidates / recorded / DLQ'd, inventory SHAs used); include in `--report-dir` artefacts when set.

## Workflow obligations (documented in docs/rum/IMPLEMENTATION.md)

Hourly cron (`0 * * * *`), `permissions: id-token: write`, `aws-actions/configure-aws-credentials` with core's `gha_role_arn` output, concurrency group `rum-compare` (no overlap), tool pinned to a release tag. The schedule lives ONLY in the inventory repository (single-scheduler principle).
