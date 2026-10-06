# Contract: Beacon Wire Schema

**Parties**: browser agent (producer) ⇄ ingest Lambda (validator) ⇄ comparator (consumer, via archive/queue)
**Implementation**: `src/types/beacon.ts` — one Zod schema, imported by all three. No party may define its own variant. The browser agent imports the beacon **types only** (`import type`), so Zod never enters the page bundle; the runtime consumers (collector, comparator) import the shared Zod schemas and validate against them.

## Obligations

- **Strictness**: unknown keys anywhere reject the whole beacon. All strings individually length-capped (see data-model.md §1–2). Total body ≤ 32 KB, 1–24 observations.
- **Versioning**: `v: 2` literal. A schema change that adds fields is a new version literal; the Lambda accepts the versions it knows and counts-and-drops others. Agent and Lambda of the same release tag always share a version. Version 2 added `initiatorChain`; no version-1 agent was ever deployed, so version 1 is no longer accepted.
- **`initiatorChain`** (v2, external and inline script observations, optional): who inserted the script, then who inserted that, out to the page — 1 to 8 hops, each `{ url, kind }` with `kind` one of `script` / `document` / `unknown`. The agent emits only `script` and `unknown`: every chain it records ends at the page as an **`unknown`** hop (origin + path), because from inside the page an inserter parsed from the markup, an inserter added through a path it does not patch, and an async callback with no `currentScript` all leave it with nothing that shows who inserted the script. `document` is part of the shared hop type (the synthetic lane uses it) and is accepted, but no agent produces it; consumers treat a beacon's chain as claims, like every beacon field. A hop's `url` is either an `http(s)` or `blob` URL under the same 2048-char cap as every URL field (never `data:`, which would carry script source), or an inline script's agent identity `inline_script/rum#<n>`, where `<n>` is a decimal session-local counter of at most 9 digits — the regex admits nothing else, so a hop cannot carry inline source, page text or identifiers. The page hop is origin + path only (no query or fragment), like `page.url`. Worst case 8 × ~2 KB per observation, inside the 32 KB beacon cap that already governs every field; the agent splits beacons, sheds the chain of an observation that alone exceeds the cap, and drops (and counts) it only if it still does.
- **Privacy invariant**: the schema MUST NOT gain any field capable of carrying unbounded page content, cookies, form values, or customer identifiers. `head`/`tail` stay ≤ 128 chars, strict prefix/suffix. This is a review gate, not a convention — changes here get security review per constitution Principle I.
- **Compatibility invariant**: `head` is a strict content prefix and `tail` a strict content suffix, so `^`-anchored and `$`-anchored inventory content matchers of length ≤ 128 evaluate identically against fingerprints and full content.

## Canonical example

```json
{
  "v": 2,
  "session": { "id": "6f1e…-uuid", "agentVersion": "1.0.0" },
  "page": { "url": "https://pay.example.com/checkout" },
  "observations": [
    {
      "kind": "external-script",
      "url": "https://cdn.example.net/sdk.js",
      "initiator": "https://pay.example.com/assets/main.js",
      "initiatorChain": [
        { "url": "https://pay.example.com/assets/main.js", "kind": "script" },
        { "url": "https://pay.example.com/checkout", "kind": "unknown" }
      ],
      "route": "/menu",
      "ts": 1755600000000
    },
    { "kind": "inline-script", "hash": "9f2c…64hex", "length": 412, "head": "<first 128 chars>", "tail": "<last 128 chars>", "initiator": "https://pay.example.com/", "route": "/checkout", "ts": 1755600000123 },
    { "kind": "csp-violation", "directive": "script-src", "blockedUri": "https://evil.example/x.js", "route": "/checkout", "ts": 1755600000456 },
    { "kind": "agent-health", "p95TaskMs": 2, "dropped": 0, "route": "/", "ts": 1755600000999 }
  ]
}
```

## Test obligations

- Schema unit tests live once, next to `src/types/beacon.ts`: accept canonical example; reject unknown key, oversize body, 25th observation, 129-char head, non-hex hash, missing `ts`, a version-1 envelope, and a chain with a 9th hop, a non-URL non-identity hop, an unknown hop kind, an over-cap hop URL, or an extra hop key.
- Agent and Lambda test suites import the same fixtures (no copied literals).
