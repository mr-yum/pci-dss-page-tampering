import { createHash } from 'node:crypto'

import type { Matchable } from '../types/matcher/matcher.interface.js'
import type { QueueMessage } from './drain.js'

/**
 * Queue message → comparator-side normalisation (data-model.md §6).
 *
 * Turns one novel-observation queue message into the shape the existing
 * matcher pipeline evaluates. The binding rules, verbatim from §6:
 *
 * - `name`: external → `observation.url`; inline →
 *   `inline_script/rum:{hash | fingerprint}`.
 * - `content`: external → always `null` (bodies are opaque client-side,
 *   research R8). Inline → the head window IS the full source when the
 *   whole source fits one window, so it is promoted to `content` and every
 *   matcher evaluates it exactly as full content (US2 rule (a)); otherwise
 *   `content` stays `null` — `head + "…" + tail` reconstruction is
 *   deliberately NOT used — and the windows ride `Matchable.contentEvidence`
 *   for ContentMatcher's anchored-window evaluation (T028): a sound anchored
 *   match accepts, anything else fails secure with an explicit
 *   bounded-excerpt reason.
 * - `hash`: the client-computed SHA-256, inline scripts only, when present.
 * - `url`: external → `observation.url` (the script's OWN URL — the same
 *   binding the synthetic path uses, so a domain-trust `urlMatcher` /
 *   `hostMatcher` judges the script by where it lives, never by who inserted
 *   it); inline → `observation.initiator` (the synthetic inline-attribution
 *   semantics). The initiator itself is carried separately on
 *   `rum.initiator` as provenance context for alerts.
 * - `workflowId`: never set in v1 — workflow-gated entries fail secure by
 *   design (a RUM observation cannot prove which checkout variation it was).
 * - `targetType`: `target_type` stamped on the message at ingest.
 *
 * Nothing is ever fabricated: no placeholder hash, no reconstructed content.
 */

/** RUM provenance carried alongside the matchable for routing and alerts. */
export type RumObservationContext = {
  /** Novelty partition key — the dedupe identity (data-model.md §4). */
  pk: string
  /** Epoch ms of the first sighting (novelty stamp). */
  firstSeen: number
  /** SPA route of the first sighting — triage context, never identity. */
  firstRoute: string
  /** Session id of the first-sighting session. */
  sessionId: string
  /** Canonical inventory target name stamped at ingest. */
  targetId: string
  /** Which pass the observation belongs to, stamped at ingest. */
  targetType: 'inventory' | 'detection'
  /** Epoch ms the collector received the observation. */
  receivedAt: number
  /**
   * Initiator URL the observation carried (the script that performed the
   * insertion, or the document URL) — provenance context for alerts, never
   * matched against. `Matchable.url` binds to the script's own URL for
   * externals, so the initiator must travel separately.
   */
  initiator?: string | undefined
}

/**
 * Inline-script evidence preserved verbatim (`head` is a strict prefix,
 * `tail` a strict suffix of the real content). The matching-relevant subset
 * (length/head/tail) also rides `Matchable.contentEvidence` for the
 * anchored-window evaluation (T028); this copy additionally carries the
 * `oversize` flag as routing/alert context.
 */
export type InlineScriptEvidence = {
  length: number
  head: string
  tail: string
  oversize: boolean
}

export type NormalisedScriptObservation = {
  kind: 'script'
  matchable: Matchable
  /**
   * True for external scripts: content and hash are unobtainable client-side
   * (research R8), so evaluation short-circuits to identification only —
   * identified means recorded, never an authorisation attempt.
   */
  identificationOnly: boolean
  /** Present for inline scripts only. */
  evidence?: InlineScriptEvidence | undefined
  rum: RumObservationContext
}

/**
 * CSP violations are their own variant, not forced into `Matchable`: they
 * describe a policy event, not a resource with name/content. Routing records
 * them (counted in the run summary) by default; alerting is opt-in per target
 * via `alerts.rum.cspViolationReported` (T035), detection lane only.
 */
export type NormalisedCspObservation = {
  kind: 'csp'
  directive: string
  blockedUri: string
  rum: RumObservationContext
}

export type NormalisedObservation = NormalisedScriptObservation | NormalisedCspObservation

const sha256Hex8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)

/**
 * Fingerprint for an inline script the agent could not hash. The format is a
 * wire contract shared with the collector's novelty keying
 * (collector/src/novelty.ts, data-model.md §4) — `"len{length}:{first 8 hex
 * of sha256(head)}:{first 8 hex of sha256(tail)}"`. Changing it here or there
 * re-keys every unhashed inline script; keep both in lockstep.
 */
export const inlineFingerprint = (observation: { length: number; head: string; tail: string }): string => `len${observation.length}:${sha256Hex8(observation.head)}:${sha256Hex8(observation.tail)}`

const rumContextOf = (msg: QueueMessage, initiator?: string): RumObservationContext => ({
  pk: msg.novelty.pk,
  firstSeen: msg.novelty.first_seen,
  firstRoute: msg.novelty.first_route,
  sessionId: msg.session_id,
  targetId: msg.target_id,
  targetType: msg.target_type,
  receivedAt: msg.received_at,
  ...(initiator !== undefined ? { initiator } : {}),
})

/** Normalises one validated queue message per data-model.md §6. */
export function normaliseMessage(msg: QueueMessage): NormalisedObservation {
  const observation = msg.observation

  switch (observation.kind) {
    case 'external-script':
      return {
        kind: 'script',
        identificationOnly: true,
        matchable: {
          name: observation.url,
          content: null,
          // The script's OWN URL — never the initiator. Binding the initiator
          // here would let a first-party domain-trust entry (urlMatcher /
          // hostMatcher on the page's host) identify a third-party skimmer
          // merely because first-party code inserted it. The initiator rides
          // its own field, where only InitiatorHostMatcher consumes it.
          url: observation.url,
          ...(observation.initiator !== undefined ? { initiator: observation.initiator } : {}),
          targetType: msg.target_type,
        },
        rum: rumContextOf(msg, observation.initiator),
      }

    case 'inline-script': {
      const identity = observation.hash ?? inlineFingerprint(observation)
      // US2 rule (a): when the whole source fits one fingerprint window, the
      // head IS the full content (strict-prefix invariant, cross-checked
      // against the claimed length), so it is promoted to `content` and any
      // pattern evaluates against it exactly as against full content. A
      // whole source and its windows would be redundant, so `content` and
      // `contentEvidence` are mutually exclusive.
      const wholeSource = observation.head.length === observation.length && observation.tail === observation.head
      return {
        kind: 'script',
        identificationOnly: false,
        matchable: {
          name: `inline_script/rum:${identity}`,
          content: wholeSource ? observation.head : null,
          ...(wholeSource ? {} : { contentEvidence: { length: observation.length, head: observation.head, tail: observation.tail } }),
          ...(observation.hash !== undefined ? { hash: { value: observation.hash } } : {}),
          // Inline scripts have no URL of their own: the initiator IS the
          // synthetic inline provenance semantics (Matchable.url docs). It is
          // ALSO bound to `initiator` so entries written with
          // initiatorHostMatcher behave uniformly across script kinds.
          ...(observation.initiator !== undefined ? { url: observation.initiator, initiator: observation.initiator } : {}),
          targetType: msg.target_type,
        },
        evidence: {
          length: observation.length,
          head: observation.head,
          tail: observation.tail,
          oversize: observation.oversize ?? false,
        },
        rum: rumContextOf(msg, observation.initiator),
      }
    }

    case 'csp-violation':
      return {
        kind: 'csp',
        directive: observation.directive,
        blockedUri: observation.blockedUri,
        rum: rumContextOf(msg),
      }
  }
}
