import { createHash } from 'crypto'

/**
 * Calculates the SHA-256 hash of a given string.
 * @param content The string to hash.
 * @returns The SHA-256 hash as a hex string.
 */
export function createSha256Hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
