# Contract: Novel-Observation Queue Message (SQS)

**Parties**: ingest Lambda (producer) → `--mode rum-compare` (consumer)

## Message body

```json
{
  "v": 1,
  "target_id": "1.0",
  "target_type": "detection",
  "observation": { "kind": "inline-script", "…": "verbatim as validated (beacon-schema.md)" },
  "novelty": { "pk": "1.0#inline:9f2c…#pay.example.com", "first_seen": 1755600000123, "first_route": "/checkout" },
  "received_at": 1755600000500,
  "session_id": "6f1e…-uuid"
}
```

- Self-contained: the consumer never reads DynamoDB or S3 to route an outcome.
- `novelty` carries `first_seen` only (with `pk` and `first_route`) — **never** `sessions` or `last_seen`. Those counters live in DynamoDB, which the consumer does not read, so they cannot reach an alert. `first_seen` is the guaranteed prevalence datum, captured at first sighting; `sessions`/`last_seen` are optional context and are absent for RUM first-sightings.
- `target_type` is the ingest-stamped pass — the consumer trusts it as the routing authority and never re-derives it.
- `agent-health` observations are never enqueued.

## Consumer obligations

- Drain in batches; visibility timeout comfortably exceeds a workflow run; concurrency group prevents overlapping runs.
- **Delete only after the outcome is routed** (alert delivered to AlertService, candidate handed to InventoryService, or explicitly recorded). Crash before delete → redelivery; routing MUST be idempotent on (`novelty.pk`, inventory ref): re-processing produces no duplicate alert and no duplicate candidate entry.
- Evaluation error → do not delete; after `maxReceiveCount` (3) the message lands in the DLQ, which alarms. DLQ replay is manual.
- Unknown `v` or malformed body → route directly to DLQ (never silently delete).

## Producer obligations

- Enqueue exactly on novelty conditional-write success (at-least-once; duplicates possible on retry — absorbed by consumer idempotency).
- Message attributes: `target_type` (for future per-lane consumers), `kind` — body remains the source of truth.
