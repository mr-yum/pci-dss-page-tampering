/**
 * Inline-script fingerprinting for the RUM agent (FR-002, FR-004).
 *
 * A fingerprint is `{ length, head, tail }` where `head` is a STRICT prefix
 * and `tail` a STRICT suffix of the source (≤ 128 chars each). Strictness is
 * a compatibility invariant with the beacon schema and the synthetic
 * pipeline: `^`-anchored and `$`-anchored inventory content matchers of
 * length ≤ 128 evaluate identically against the fingerprint windows and the
 * full content. For sources of ≤ 128 chars both windows are the whole source.
 *
 * Hashing uses `crypto.subtle` (SHA-256, hex) and degrades to `undefined`
 * when WebCrypto is unavailable or the source exceeds the 512 KB hashing
 * ceiling — the collector then falls back to the length-plus-windows novelty
 * identity (`collector/src/novelty.ts`). Windows are sliced by UTF-16 code
 * units (the schema counts chars); the ceiling is counted in UTF-8 BYTES so
 * it tracks what hashing actually has to encode.
 *
 * This module is part of the page bundle: no imports beyond types, no Zod.
 */

/** Maximum window size for `head`/`tail`, matching the beacon schema cap. */
export const FINGERPRINT_WINDOW_CHARS = 128

/**
 * Hashing ceiling in UTF-8 bytes (FR-004): above it the agent never encodes
 * or digests the source — a multi-megabyte bundle must not cost main-thread
 * time — and the observation carries `oversize: true` instead of a hash.
 */
export const INLINE_HASH_CEILING_BYTES = 512 * 1024

/**
 * Window size of the cheap pre-hash dedupe fingerprint. Narrower than the
 * beacon windows on purpose: this key ONLY reserves SHA-256 work (hash at most
 * once per cheap-fingerprint per session). It never gates whether an
 * observation is emitted — that decision is made on the true wire identity
 * (the SHA-256, or the 128-char head/tail windows), so a cheap-key collision
 * between two distinct scripts skips a redundant re-hash but never suppresses
 * emission. See `inlineHashedKey` / `markInlineEmitted` in agent.ts.
 */
const CHEAP_WINDOW_CHARS = 64

/** The schema-shaped inline fingerprint: content length plus anchored windows. */
export interface InlineFingerprint {
  /** Source length in UTF-16 code units (what the schema's `length` means). */
  length: number
  /** Strict prefix of the source, ≤ 128 chars. */
  head: string
  /** Strict suffix of the source, ≤ 128 chars. */
  tail: string
}

/**
 * Builds the beacon fingerprint of an inline script's source. Pure slicing —
 * cheap enough for any code path, deterministic for identical input.
 */
export function fingerprintInline(source: string): InlineFingerprint {
  return {
    length: source.length,
    head: source.slice(0, FINGERPRINT_WINDOW_CHARS),
    tail: source.slice(-FINGERPRINT_WINDOW_CHARS),
  }
}

/**
 * Cheap synchronous fingerprint used only to reserve SHA-256 work: length plus
 * narrow first/last windows, computed without hashing so observer-adjacent
 * code can decide BEFORE any SHA-256 work whether this cheap-fingerprint has
 * already been hashed this session. Two sources collide only when they share
 * length, 64-char prefix and 64-char suffix — acceptable for hashing dedupe
 * because emission is gated separately on the true wire identity, never on
 * this key (never used as the wire identity).
 *
 * The window separator is written as a '\u0000' escape, not a raw NUL byte: a
 * raw NUL in the source makes git classify the whole file as binary and drop
 * it from every diff.
 */
export function cheapInlineFingerprint(source: string): string {
  return `${source.length}:${source.slice(0, CHEAP_WINDOW_CHARS)}\u0000${source.slice(-CHEAP_WINDOW_CHARS)}`
}

/**
 * UTF-8 byte length without allocating an encoded copy. Uses the same
 * surrogate-pair accounting as a WHATWG TextEncoder for well-formed input.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: 4 bytes for the pair, skip the low surrogate.
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

/**
 * True when the source's UTF-8 byte length exceeds the hashing ceiling —
 * the exact condition under which `hashInline` suppresses hashing and the
 * observation must carry `oversize: true`.
 */
export function exceedsHashCeiling(source: string): boolean {
  return utf8ByteLength(source) > INLINE_HASH_CEILING_BYTES
}

/** UTF-8 encodes for hashing; manual fallback for engines without TextEncoder. */
function utf8Encode(value: string): Uint8Array<ArrayBuffer> {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value)
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      // Combine the surrogate pair into the astral code point.
      code = 0x10000 + ((code - 0xd800) << 10) + (value.charCodeAt(i + 1) - 0xdc00)
      i += 1
    }
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return Uint8Array.from(bytes)
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

/**
 * SHA-256 (lowercase hex) of the source's UTF-8 bytes via `crypto.subtle`.
 * Returns `undefined` — never throws — when WebCrypto is unavailable, when
 * the source exceeds {@link INLINE_HASH_CEILING_BYTES}, or when the digest
 * itself fails (e.g. subtle disabled in an insecure context). Callers
 * distinguish the ceiling case via {@link exceedsHashCeiling} to set the
 * `oversize` flag; hashing-unavailable simply yields a hash-absent
 * observation (FR-004 degraded path).
 */
export async function hashInline(source: string): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function') return undefined
  if (exceedsHashCeiling(source)) return undefined
  try {
    const digest = await crypto.subtle.digest('SHA-256', utf8Encode(source))
    return toHex(digest)
  } catch {
    // Monitoring must never break the host page — degrade to hash-absent.
    return undefined
  }
}
