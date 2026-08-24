# Data Model: Real-User Script Surveillance

Single source of truth for the wire schema is `src/types/beacon.ts` (Zod, strict — unknown keys rejected). The agent serialises against it, the ingest Lambda validates against it, and the comparator parses against it. Everything below is the contract that file implements.

## 1. Beacon (report envelope)

The unit of transport and archival. One session emits one or more beacons per flush.

| Field                  | Type             | Constraints  | Notes                                                                                                                                                       |
| ---------------------- | ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                    | literal `1`      | required     | schema version; bump = new literal, collector accepts known versions only                                                                                   |
| `session.id`           | string (UUID v4) | required     | random, minted per browser session; the only session identifier; carries no user identity                                                                   |
| `session.agentVersion` | string (semver)  | required     | released agent version, for skew triage                                                                                                                     |
| `page.url`             | string URL       | ≤ 2048 chars | document origin + path at flush time — query string and fragment stripped by design (privacy: queries routinely carry tokens/order ids); clamped to the cap |
| `observations`         | array            | 1–24 items   | mixed kinds; agent splits a flush across beacons beyond 24                                                                                                  |

**Global caps** (enforced by Zod and by edge/Lambda body limits): total serialized body ≤ 32 KB; every string field individually capped; unknown keys anywhere → reject whole beacon.

**Privacy invariant (bounded exposure, not semantic exclusion)**: the schema **bounds** how much content any field can carry, rather than guaranteeing none of it is sensitive. `head`/`tail` are bounded (128 chars each) but arbitrary — the first/last bytes of an inline script — and URL fields, though capped, could otherwise carry query strings that routinely hold tokens or order ids. So bounding is backed by redaction at capture/ingest, describing the intended end state:

- `page.url` and CSP document URLs are reduced to `origin + pathname` before archival — query string and fragment dropped.
- `route` strips its query and fragment (SPA route path only).
- novelty identities that would exceed the key bound are hashed rather than stored verbatim.

There are still no cookie, form-value, or customer-identifier fields in the schema; the honest claim is that exposure is **capped and redacted**, not that sensitive bytes are structurally impossible.

## 2. Observation (discriminated union on `kind`)

Common fields: `ts` (epoch ms, required), `route` (string ≤ 512, SPA route active at capture — triage context only, never identity).

### 2a. `external-script`

| Field       | Type       | Constraints                                                                    |
| ----------- | ---------- | ------------------------------------------------------------------------------ |
| `url`       | string URL | required, ≤ 2048                                                               |
| `initiator` | string URL | optional, ≤ 2048 (inserting script's URL when attributable, else document URL) |

No content, no hash — cross-origin bodies are opaque client-side (research R8).

### 2b. `inline-script`

| Field       | Type           | Constraints                                                    |
| ----------- | -------------- | -------------------------------------------------------------- |
| `hash`      | string, 64 hex | optional — absent when hashing unavailable or content > 512 KB |
| `length`    | integer ≥ 0    | required                                                       |
| `head`      | string         | required, ≤ 128 chars, **strict prefix** of content            |
| `tail`      | string         | required, ≤ 128 chars, **strict suffix** of content            |
| `oversize`  | boolean        | optional, true when the 512 KB hashing ceiling was hit         |
| `initiator` | string URL     | optional, ≤ 2048                                               |

Prefix/suffix strictness is what keeps existing 64-char anchored inventory matchers valid against RUM fingerprints.

### 2c. `csp-violation`

| Field        | Type   | Constraints                         |
| ------------ | ------ | ----------------------------------- |
| `directive`  | string | required, ≤ 128 (e.g. `script-src`) |
| `blockedUri` | string | required, ≤ 2048                    |

Collected/archived/counted from phase 1; alert category activates phase 4.

### 2d. `agent-health`

| Field       | Type        | Constraints                                                    |
| ----------- | ----------- | -------------------------------------------------------------- |
| `p95TaskMs` | number ≥ 0  | required — agent's own main-thread processing p95 this session |
| `dropped`   | integer ≥ 0 | required — observations discarded under pressure               |

Never queued for comparison; feeds metrics only (SC-003 evidence).

## 3. Origin mapping (operator configuration → Lambda env)

```
origin_targets: Array<{
  origin:      string   // exact scheme+host[+port], e.g. "https://pay.example.com"
  target_id:   string   // must match a canonical inventory target name; reserved id for the canary target
  target_type: "inventory" | "detection"
}>
```

Sole authority on environment identity (FR-007). Lookup is exact-match on the request `Origin` header. Unmapped → counted (`rum_unmapped_origin` metric), dropped, never stored. The canary target's alerts route to the ops channel (research R11).

## 4. Novelty record (DynamoDB)

| Attribute     | Type     | Notes                                                                                                                                                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pk`          | string   | `"{target_id}#{identity}#{initiator_host}"` — identity is the external URL or `inline:{hash \| length:head-hash8:tail-hash8 fallback}`; initiator_host derived from `initiator` URL, `"-"` when absent |
| `first_seen`  | epoch ms | set on conditional insert                                                                                                                                                                              |
| `last_seen`   | epoch ms | updated on repeats                                                                                                                                                                                     |
| `sessions`    | number   | incremented per distinct session id per day (approximate is acceptable)                                                                                                                                |
| `first_route` | string   | route of the first sighting                                                                                                                                                                            |
| `target_type` | string   | stamped pass at first sighting                                                                                                                                                                         |
| `ttl`         | epoch s  | `last_seen + 90 days` — expiry makes a returning script a fresh first sighting (clarification #2)                                                                                                      |

Write pattern: `PutItem` with `attribute_not_exists(pk)` → success = first sighting (enqueue); failure → `UpdateItem` counters only. Route never enters `pk` (clarification #1).

## 5. Queue message (SQS `novel-observations`)

Self-contained: the comparator never reads DynamoDB.

```
{
  v: 1,
  target_id, target_type,            // stamped at ingest (never client-claimed)
  observation: <Observation 2a|2b|2c>,  // verbatim as validated
  novelty: { pk, first_seen, first_route },
  received_at: epoch ms,
  session_id: string                 // of the first-sighting session
}
```

**Prevalence in the message is first-sighting only**: the `novelty` block carries `first_seen` (and `pk`, `first_route`) — **not** `sessions` or `last_seen`. Those live in DynamoDB (§4), and the comparator never reads it, so they cannot appear in an alert. `first_seen` is therefore the one guaranteed prevalence datum, captured at the first sighting; `sessions`/`last_seen` are optional context that is simply absent for RUM first-sightings.

Consumption: visibility timeout > workflow run; delete only after the outcome is routed (alert sent / candidate produced / recorded); `maxReceiveCount` → DLQ (alarmed). Duplicate delivery is harmless: routing is idempotent on `novelty.pk` + inventory ref.

## 6. Comparator normalisation (queue message → `Matchable`)

| `Matchable` field | Source                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | external: `observation.url`; inline: `inline_script/rum:{hash \| fingerprint}`                                                                                                                                                                                                                                                                                                                       |
| `content`         | external: `null`; inline: `head + "…" + tail` reconstruction is **not** used — matching runs against head and tail independently as anchored windows; unverifiable → fail-secure                                                                                                                                                                                                                     |
| `hash`            | inline `hash` when present                                                                                                                                                                                                                                                                                                                                                                           |
| `url`             | external: `observation.url` (the script's **own** URL, matching the synthetic external binding — never the initiator, so first-party domain-trust entries cannot identify a third-party script by its inserter); inline: `observation.initiator` (synthetic inline attribution semantics). The initiator is carried separately on the normalised `rum` context as provenance for alerts              |
| `initiator`       | `observation.initiator` for both script kinds — the field `initiatorHostMatcher` consumes, so an inventory entry can constrain who may load a script (the novelty key's initiator dimension re-queues a known script arriving via a new source; the entry decides whether that alerts). Synthetic passes bind it too: inline from the page-attribution shim, external from the CDP request initiator |
| `workflowId`      | never set in v1 — workflow-gated entries fail secure by design                                                                                                                                                                                                                                                                                                                                       |
| `targetType`      | `target_type` from the message                                                                                                                                                                                                                                                                                                                                                                       |

External scripts short-circuit to identification-only evaluation (research R8): identified + authorised-by-identity → recorded; unidentified → `rum_uninventoried_script_detected`.

## 7. Comparison outcomes and routing

| Pass      | Outcome                                   | Result                                                                                                                              |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| detection | unidentified script                       | alert `rum_uninventoried_script_detected`                                                                                           |
| detection | identified, authorisation failed (inline) | alert `rum_mismatched_script_detected` (matcher context + failure reason)                                                           |
| detection | CSP violation (phase 4+)                  | alert `rum_csp_violation_reported`                                                                                                  |
| detection | identified + authorised                   | recorded (no alert), prevalence noted                                                                                               |
| inventory | unidentified script                       | pending `authorised: false` candidate via existing InventoryService flow → PR (idempotent: no duplicate entry for a covered script) |
| inventory | identified + authorised                   | recorded                                                                                                                            |
| any       | evaluation error                          | retry; then DLQ (alarmed)                                                                                                           |

Every routed outcome records the inventory ref (commit) it was judged against (SC-005). Alerts carry: observation, prevalence (`first_seen` — the guaranteed first-sighting datum; `sessions`/`last_seen` are optional and absent for RUM first-sightings, since the queue message omits them and the comparator never reads DynamoDB — §5), `first_route`, target, inventory ref.

## 8. Alert categories (extends existing alert config)

`rum_uninventoried_script_detected` · `rum_mismatched_script_detected` · `rum_csp_violation_reported` — configured per target in the existing inventory `alerts{}` block, same destinations mechanism as synthetic categories. Canary target routes all categories to the ops channel.

## 9. State transitions

```
observation (client) ──validated──▶ archived (S3, verbatim, 1y)
                         │
                         ├─ pk exists ──▶ counters updated (terminal)
                         └─ pk new ─────▶ queued ──▶ evaluated@ref ──▶ routed (alert | candidate | recorded)
                                                        │                    └─ delete message (terminal)
                                                        └─ error ×N ──▶ DLQ (alarmed, manual replay)
ttl expiry (90d after last_seen) ──▶ identity forgotten ──▶ next sighting is first again
```
