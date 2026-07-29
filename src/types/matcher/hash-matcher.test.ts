/**
 * HashMatcher Unit Tests
 *
 * Tests hash-based script authorization with SHA-256 hashes.
 * Covers single hash match, multiple hashes, no match, and null content.
 *
 * @see ../../../specs/001-refactor-script-identification/research.md (R7) for test strategy
 */

import type { SHA256Hash } from '../hash.js'
import type { InventoryScriptHashInfo } from '../inventory/model.js'
import { ContentMatcher } from './content-matcher.js'
import { HashMatcher } from './hash-matcher.js'
import type { DetectedScript } from './matcher.interface.js'
import { OrMatcher } from './or-matcher.js'

describe('HashMatcher', () => {
  const createHash = (value: string): SHA256Hash => ({ value })

  const createHashInfo = (value: string): InventoryScriptHashInfo => ({
    timestamp: new Date('2025-10-15T00:00:00.000Z'),
    hash: createHash(value),
  })

  const createDetectedScript = (name: string, content: string | null, hashValue: string): DetectedScript => ({
    name,
    content,
    hash: createHash(hashValue),
  })

  describe('constructor', () => {
    it('should create HashMatcher with valid hashes', () => {
      const hashes = [createHashInfo('hash123'), createHashInfo('hash456')]
      const matcher = new HashMatcher(hashes)

      expect(matcher.getType()).toBe('hash')
    })

    it('should throw error when hashes array is empty', () => {
      expect(() => new HashMatcher([])).toThrow('HashMatcher requires at least one authorized hash')
    })

    it('should throw error when hashes is null', () => {
      expect(() => new HashMatcher(null as any)).toThrow('HashMatcher requires at least one authorized hash')
    })

    it('should throw error when hashes is undefined', () => {
      expect(() => new HashMatcher(undefined as any)).toThrow('HashMatcher requires at least one authorized hash')
    })
  })

  describe('getType', () => {
    it('should return "hash" as matcher type', () => {
      const matcher = new HashMatcher([createHashInfo('hash123')])
      expect(matcher.getType()).toBe('hash')
    })
  })

  describe('getPattern', () => {
    it('should return the authorized hashes array', () => {
      const hashes = [createHashInfo('hash123'), createHashInfo('hash456')]
      const matcher = new HashMatcher(hashes)

      const pattern = matcher.getPattern()

      expect(pattern).toEqual(hashes)
      expect(pattern).toHaveLength(2)
    })
  })

  describe('identify', () => {
    it('identifies a script whose pre-computed hash is authorized', () => {
      const matcher = new HashMatcher([createHashInfo('hash123')])
      const script = createDetectedScript('https://example.com/script.js', 'content', 'hash123')

      expect(matcher.identify(script)).toBe(true)
    })

    it('does not identify a script whose hash is not authorized', () => {
      const matcher = new HashMatcher([createHashInfo('matching-hash')])
      const script = createDetectedScript('https://example.com/script.js', 'content', 'different-hash')

      expect(matcher.identify(script)).toBe(false)
    })

    it('fails secure for empty content even when the pre-computed hash matches', () => {
      const matcher = new HashMatcher([createHashInfo('matching-hash')])

      expect(matcher.identify(createDetectedScript('https://example.com/script.js', '', 'matching-hash'))).toBe(false)
      expect(matcher.identify(createDetectedScript('https://example.com/script.js', null, 'matching-hash'))).toBe(false)
    })

    it('fails secure when a non-script resource has no hash', () => {
      const matcher = new HashMatcher([createHashInfo('matching-hash')])
      const resource = { name: 'content-security-policy', content: "default-src 'self'" }

      expect(matcher.identify(resource)).toBe(false)
      expect(matcher.authorize(resource)).toEqual({ authorized: false, reason: 'hash is missing' })
    })
  })

  describe('authorize', () => {
    it('denies a matching hash whose authorization metadata is denied', () => {
      const authorisationInfo = {
        description: 'Deprecated script version',
        authorised: false,
        date: new Date('2025-10-15T00:00:00.000Z'),
      }
      const script = createDetectedScript('https://example.com/script.js', 'content', 'matching-hash')
      const matcher = new OrMatcher([new HashMatcher([createHashInfo('matching-hash')], authorisationInfo), new ContentMatcher('never-matches')])

      expect(matcher.authorize(script)).toEqual({
        authorized: false,
        reason: 'Top-level authorization denied: Deprecated script version',
        metadataPath: [authorisationInfo],
      })
    })

    describe('single hash match', () => {
      it('should authorize when script hash matches the authorized hash', () => {
        const authorizedHash = 'abc123def456'
        const matcher = new HashMatcher([createHashInfo(authorizedHash)])
        const script = createDetectedScript('https://example.com/script.js', 'console.log("hello")', authorizedHash)

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('should not authorize when script hash does not match', () => {
        const matcher = new HashMatcher([createHashInfo('authorized-hash')])
        const script = createDetectedScript('https://example.com/script.js', 'console.log("hello")', 'different-hash')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('hash different-hash not in authorized list')
      })
    })

    describe('multiple hashes', () => {
      it('should authorize when script hash matches any of the authorized hashes', () => {
        const hashes = [createHashInfo('hash1'), createHashInfo('hash2'), createHashInfo('hash3')]
        const matcher = new HashMatcher(hashes)
        const script = createDetectedScript('https://example.com/script.js', 'content', 'hash2')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
      })

      it('should authorize when script hash matches the first hash', () => {
        const hashes = [createHashInfo('first-hash'), createHashInfo('second-hash')]
        const matcher = new HashMatcher(hashes)
        const script = createDetectedScript('https://example.com/script.js', 'content', 'first-hash')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
      })

      it('should authorize when script hash matches the last hash', () => {
        const hashes = [createHashInfo('first-hash'), createHashInfo('second-hash'), createHashInfo('last-hash')]
        const matcher = new HashMatcher(hashes)
        const script = createDetectedScript('https://example.com/script.js', 'content', 'last-hash')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
      })

      it('should not authorize when script hash does not match any hash', () => {
        const hashes = [createHashInfo('hash1'), createHashInfo('hash2'), createHashInfo('hash3')]
        const matcher = new HashMatcher(hashes)
        const script = createDetectedScript('https://example.com/script.js', 'content', 'unknown-hash')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('hash unknown-hash not in authorized list')
      })
    })

    describe('null/empty content', () => {
      it('should not authorize when content is null', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', null, 'hash123')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is empty string', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', '', 'hash123')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })

      it('should not authorize when content is whitespace-only', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', '   ', 'hash123')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('content is null or empty')
      })
    })

    describe('hash format validation', () => {
      it('should handle long SHA-256 hash values', () => {
        const longHash = 'a'.repeat(64) // SHA-256 is 64 hex characters
        const matcher = new HashMatcher([createHashInfo(longHash)])
        const script = createDetectedScript('https://example.com/script.js', 'content', longHash)

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
      })

      it('should handle hash comparison case-sensitively', () => {
        const matcher = new HashMatcher([createHashInfo('AbC123')])
        const script = createDetectedScript('https://example.com/script.js', 'content', 'abc123')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
      })
    })
  })
})
