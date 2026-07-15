import { createHmac } from 'node:crypto'

/**
 * Minimal RFC 6238 TOTP implementation (HMAC-SHA1, as used by Google
 * Authenticator-compatible services). Implemented with node:crypto rather
 * than a third-party dependency to keep the supply-chain surface of this
 * tampering-detection tool as small as possible; correctness is pinned by
 * the RFC 6238 Appendix B test vectors in totp.test.ts.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const TOTP_DIGITS = 6
export const TOTP_PERIOD_SECONDS = 30

/**
 * Decode an RFC 4648 base32 string (the standard TOTP seed encoding).
 * Whitespace, hyphens, and trailing padding are tolerated; case-insensitive.
 * Throws on empty input or characters outside the base32 alphabet. Error
 * messages never include the input, since seeds are secrets.
 */
export function decodeBase32(encoded: string): Buffer {
  const normalised = encoded.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')

  if (normalised.length === 0) {
    throw new Error('TOTP seed must not be empty')
  }

  let bitBuffer = 0
  let bitCount = 0
  const bytes: number[] = []

  for (const character of normalised) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) {
      throw new Error('TOTP seed is not valid base32 (RFC 4648)')
    }
    bitBuffer = (bitBuffer << 5) | index
    bitCount += 5
    if (bitCount >= 8) {
      bytes.push((bitBuffer >>> (bitCount - 8)) & 0xff)
      bitCount -= 8
    }
  }

  // Fail-secure: a 1-character seed is valid base32 but decodes to zero
  // bytes, and HMAC over an empty key silently produces wrong codes.
  if (bytes.length === 0) {
    throw new Error('TOTP seed decodes to zero bytes')
  }

  return Buffer.from(bytes)
}

/**
 * Parse one repeatable `--totp-seed <name>=<base32-seed>` CLI entry.
 * Single source of truth for the split — used both by CLI validation and by
 * runtime configuration building, so the two can never disagree.
 * Returns null when the entry has no separator, an empty name, or an empty
 * seed. Does not validate the seed's base32 encoding.
 */
export function parseTotpSeedEntry(entry: string): { name: string; seed: string } | null {
  const separatorIndex = entry.indexOf('=')
  if (separatorIndex === -1) {
    return null
  }

  const name = entry.slice(0, separatorIndex).trim()
  const seed = entry.slice(separatorIndex + 1).trim()
  if (name === '' || seed === '') {
    return null
  }

  return { name, seed }
}

/**
 * Generate the 6-digit TOTP code for the window containing `timestampMs`.
 */
export function generateTotp(base32Seed: string, timestampMs: number): string {
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', decodeBase32(base32Seed)).update(counterBuffer).digest()

  // RFC 4226 dynamic truncation
  const offset = digest[digest.length - 1]! & 0x0f
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!

  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0')
}

/**
 * Milliseconds until the TOTP window containing `timestampMs` rolls over.
 * Used to avoid typing a code that would expire mid-submission.
 */
export function millisecondsRemainingInTotpWindow(timestampMs: number): number {
  const periodMs = TOTP_PERIOD_SECONDS * 1000
  return periodMs - (timestampMs % periodMs)
}
