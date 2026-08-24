import { createHash } from 'node:crypto'

import type { CspViolationObservation, ExternalScriptObservation, InlineScriptObservation } from '../../src/types/beacon.js'

/**
 * Novelty key construction — data-model.md §4.
 *
 * pk = "{target_id}#{identity}#{initiator_host}". The SPA route is triage
 * context only and must never enter the key (clarification #1): a script
 * appearing on a new route is not a new script.
 *
 * `agent-health` observations are never keyed — they feed metrics only — so
 * they are excluded from `KeyableObservation` at the type level, and the
 * exhaustive switch below throws if one is smuggled past the compiler.
 */
export type KeyableObservation = ExternalScriptObservation | InlineScriptObservation | CspViolationObservation

const sha256Hex8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)

/**
 * A DynamoDB partition key is capped at 2048 bytes, but an identity component
 * can approach that on its own (an external URL ≤ 2048 chars, or a CSP
 * `csp:{directive}:{blockedUri}` whose blockedUri is ≤ 2048), and once
 * `{target_id}#…#{initiator_host}` is wrapped around it the raw pk can exceed
 * the cap — PutItem would then throw and the first sighting would be silently
 * lost behind the always-204 contract.
 *
 * Rule: an identity whose UTF-8 length is within {@link IDENTITY_HASH_THRESHOLD}
 * is kept verbatim (human-readable pks, unchanged for every existing short
 * value); a longer one is replaced by `sha256:{64-hex}` of the identity. The
 * digest is deterministic (same identity → same pk across sightings), and the
 * threshold keeps the compacted component ≤ 71 bytes so the assembled pk stays
 * well under 2048 for any realistic target id and initiator host. The full
 * fields still travel verbatim in the queued observation — only the pk changes.
 */
const IDENTITY_HASH_THRESHOLD = 256

const compactIdentity = (identity: string): string => (Buffer.byteLength(identity, 'utf8') > IDENTITY_HASH_THRESHOLD ? `sha256:${createHash('sha256').update(identity, 'utf8').digest('hex')}` : identity)

/**
 * Inline-script identity when the agent could not hash the content (hashing
 * unavailable or the 512 KB ceiling was hit). Chosen fallback format, stable
 * by contract — changing it would re-key every unhashed inline script and
 * re-fire first-sighting alerts:
 *
 *   "len{length}:{first 8 hex of sha256(head)}:{first 8 hex of sha256(tail)}"
 *
 * Length plus both anchored windows is deterministic from the beacon alone
 * and collides only when two scripts share length, 128-char prefix, and
 * 128-char suffix — acceptable for novelty dedupe (not integrity).
 */
const inlineFallbackIdentity = (observation: InlineScriptObservation): string => `len${observation.length}:${sha256Hex8(observation.head)}:${sha256Hex8(observation.tail)}`

const identityOf = (observation: KeyableObservation): string => {
  switch (observation.kind) {
    case 'external-script':
      return observation.url
    case 'inline-script':
      return `inline:${observation.hash ?? inlineFallbackIdentity(observation)}`
    case 'csp-violation':
      return `csp:${observation.directive}:${observation.blockedUri}`
    default:
      // Unreachable for well-typed callers; fail loudly rather than mint a
      // bogus key for an observation kind that must never be keyed.
      throw new Error(`observation kind cannot be keyed: ${(observation as { kind: string }).kind}`)
  }
}

/**
 * Host portion of the observation's initiator URL, "-" when the initiator is
 * absent or unparseable. Never throws: a malformed initiator must not block
 * novelty processing of an otherwise valid observation.
 */
export const initiatorHostOf = (initiator: string | undefined): string => {
  if (!initiator) return '-'
  try {
    return new URL(initiator).host || '-'
  } catch {
    return '-'
  }
}

/** Builds the DynamoDB novelty partition key per data-model.md §4. */
export const buildNoveltyKey = (targetId: string, observation: KeyableObservation): string => {
  const initiator = observation.kind === 'csp-violation' ? undefined : observation.initiator
  return `${targetId}#${compactIdentity(identityOf(observation))}#${initiatorHostOf(initiator)}`
}

/** TTL attribute value: expiry in epoch seconds, `ttlDays` after `nowMs`. */
export const ttlEpochSeconds = (nowMs: number, ttlDays: number): number => Math.floor(nowMs / 1000) + ttlDays * 86400
