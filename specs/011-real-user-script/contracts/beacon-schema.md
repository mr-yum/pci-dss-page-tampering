# Contract: Beacon Wire Schema

**Parties**: browser agent (producer) ⇄ ingest Lambda (validator) ⇄ comparator (consumer, via archive/queue)
**Implementation**: `src/types/beacon.ts` — one Zod schema, imported by all three. No party may define its own variant.

## Obligations

- **Strictness**: unknown keys anywhere reject the whole beacon. All strings individually length-capped (see data-model.md §1–2). Total body ≤ 32 KB, 1–24 observations.
- **Versioning**: `v: 1` literal. A schema change that adds fields is a new version literal; the Lambda accepts the versions it knows and counts-and-drops others. Agent and Lambda of the same release tag always share a version.
- **Privacy invariant**: the schema MUST NOT gain any field capable of carrying unbounded page content, cookies, form values, or customer identifiers. `head`/`tail` stay ≤ 128 chars, strict prefix/suffix. This is a review gate, not a convention — changes here get security review per constitution Principle I.
- **Compatibility invariant**: `head` is a strict content prefix and `tail` a strict content suffix, so `^`-anchored and `$`-anchored inventory content matchers of length ≤ 128 evaluate identically against fingerprints and full content.

## Canonical example

```json
{
  "v": 1,
  "session": { "id": "6f1e…-uuid", "agentVersion": "1.0.0" },
  "page": { "url": "https://pay.example.com/checkout" },
  "observations": [
    { "kind": "external-script", "url": "https://cdn.example.net/sdk.js", "initiator": "https://pay.example.com/", "route": "/menu", "ts": 1755600000000 },
    { "kind": "inline-script", "hash": "9f2c…64hex", "length": 412, "head": "<first 128 chars>", "tail": "<last 128 chars>", "initiator": "https://pay.example.com/", "route": "/checkout", "ts": 1755600000123 },
    { "kind": "csp-violation", "directive": "script-src", "blockedUri": "https://evil.example/x.js", "route": "/checkout", "ts": 1755600000456 },
    { "kind": "agent-health", "p95TaskMs": 2, "dropped": 0, "route": "/", "ts": 1755600000999 }
  ]
}
```

## Test obligations

- Schema unit tests live once, next to `src/types/beacon.ts`: accept canonical example; reject unknown key, oversize body, 25th observation, 129-char head, non-hex hash, missing `ts`.
- Agent and Lambda test suites import the same fixtures (no copied literals).
