import { z } from 'zod'

/**
 * Beacon wire schema — the single source of truth shared by the browser agent
 * (producer), the ingest Lambda (validator), and the comparator (consumer).
 * See specs/011-real-user-script/contracts/beacon-schema.md.
 *
 * Privacy invariant: every string field is individually length-capped, so the
 * schema is structurally incapable of carrying unbounded page content, cookies,
 * form values, or customer identifiers. Changes here require security review.
 */

/** Maximum serialized beacon size in UTF-8 bytes, matching the edge/Lambda body limit. */
export const MAX_BEACON_BYTES = 32768

/** URL-valued fields share the same cap as the transport's URL limit. */
const BoundedUrlSchema = z.url().max(2048)

/**
 * Fields common to every observation kind. `route` is the SPA route active at
 * capture — triage context only, never identity.
 */
const observationCommon = {
  ts: z.number().int().positive(),
  route: z.string().max(512),
}

/**
 * One hop of an initiator chain (schema v2): who inserted the script, then
 * who inserted that, out to the page. A hop's `url` is a URL under the same
 * 2048-char cap as every URL field, or an inline script's agent-assigned
 * identity (`inline_script/rum#<n>` — a session-local counter, never content).
 * `kind` says what the hop is: `script`, `document`, or `unknown`. The agent
 * emits only `script` and `unknown` — every chain it records ends at the page
 * as an `unknown` hop, since it cannot tell who inserted a script it never
 * saw inserted; `document` belongs to the shared hop type and is accepted,
 * never produced. See src/types/initiator-chain.ts.
 */
export const InitiatorHopSchema = z.strictObject({
  // http(s) and blob only: a data: URL would put script source on the wire.
  url: z.union([BoundedUrlSchema.regex(/^(https?|blob):/i), z.string().regex(/^inline_script\/rum#[0-9]{1,9}$/)]),
  kind: z.enum(['script', 'document', 'unknown']),
})

/** At most 8 hops — the same depth cap the comparator applies. */
const InitiatorChainSchema = z.array(InitiatorHopSchema).min(1).max(8)

export const ExternalScriptObservationSchema = z.strictObject({
  kind: z.literal('external-script'),
  ...observationCommon,
  url: BoundedUrlSchema,
  initiator: BoundedUrlSchema.optional(),
  initiatorChain: InitiatorChainSchema.optional(),
})

/**
 * `head` is a strict prefix and `tail` a strict suffix of the script content
 * (compatibility invariant): `^`-anchored and `$`-anchored inventory content
 * matchers of length ≤ 128 evaluate identically against the fingerprint and
 * the full content. `hash` is absent when hashing was unavailable or the
 * content exceeded the 512 KB hashing ceiling (`oversize: true`).
 */
export const InlineScriptObservationSchema = z.strictObject({
  kind: z.literal('inline-script'),
  ...observationCommon,
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  length: z.number().int().nonnegative(),
  head: z.string().max(128),
  tail: z.string().max(128),
  oversize: z.boolean().optional(),
  initiator: BoundedUrlSchema.optional(),
  initiatorChain: InitiatorChainSchema.optional(),
})

export const CspViolationObservationSchema = z.strictObject({
  kind: z.literal('csp-violation'),
  ...observationCommon,
  directive: z.string().max(128),
  blockedUri: z.string().max(2048),
})

export const AgentHealthObservationSchema = z.strictObject({
  kind: z.literal('agent-health'),
  ...observationCommon,
  p95TaskMs: z.number().nonnegative(),
  dropped: z.number().int().nonnegative(),
})

export const ObservationSchema = z.discriminatedUnion('kind', [ExternalScriptObservationSchema, InlineScriptObservationSchema, CspViolationObservationSchema, AgentHealthObservationSchema])

/**
 * Version 2 added `initiatorChain` to script observations. No version-1 agent
 * was ever deployed, so version 1 is not accepted.
 */
export const BeaconSchema = z.strictObject({
  v: z.literal(2),
  session: z.strictObject({
    id: z.uuid({ version: 'v4' }),
    agentVersion: z
      .string()
      .max(32)
      .regex(/^\d+\.\d+\.\d+$/),
  }),
  page: z.strictObject({
    url: BoundedUrlSchema,
  }),
  observations: z.array(ObservationSchema).min(1).max(24),
})

export type Beacon = z.infer<typeof BeaconSchema>
export type Observation = z.infer<typeof ObservationSchema>
export type ExternalScriptObservation = z.infer<typeof ExternalScriptObservationSchema>
export type InlineScriptObservation = z.infer<typeof InlineScriptObservationSchema>
export type CspViolationObservation = z.infer<typeof CspViolationObservationSchema>
export type AgentHealthObservation = z.infer<typeof AgentHealthObservationSchema>
export type InitiatorHop = z.infer<typeof InitiatorHopSchema>

export type ParseBeaconResult = { ok: true; beacon: Beacon } | { ok: false; reason: 'size' | 'json' | 'schema'; detail?: string }

/**
 * Parses and validates a raw beacon body. Used by both the ingest Lambda and
 * the comparator so size/parse semantics cannot drift between them.
 *
 * The byte cap is checked before JSON.parse: the cap is a transport limit on
 * the raw body, and an oversized payload must be rejected without spending
 * parser CPU on it (the raw string may not even be well-formed JSON).
 */
export function parseBeacon(raw: string): ParseBeaconResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_BEACON_BYTES) {
    return { ok: false, reason: 'size', detail: `body exceeds ${MAX_BEACON_BYTES} bytes` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, reason: 'json', detail: error instanceof Error ? error.message : String(error) }
  }

  const result = BeaconSchema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    return { ok: false, reason: 'schema', detail }
  }

  return { ok: true, beacon: result.data }
}
