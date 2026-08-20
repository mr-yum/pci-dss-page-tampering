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

    // ADAPTED (feature 011, evidence-aware matchers): this test previously
    // asserted a content pre-gate on identify(). The hash IS this matcher's
    // evidence — RUM inline observations carry a client-computed hash with no
    // content — so identification now succeeds on a matching hash regardless
    // of content, and fails secure only when the hash itself is missing/empty.
    it('identifies on a matching pre-computed hash even when content did not travel with the resource', () => {
      const matcher = new HashMatcher([createHashInfo('matching-hash')])

      expect(matcher.identify(createDetectedScript('https://example.com/script.js', '', 'matching-hash'))).toBe(true)
      expect(matcher.identify(createDetectedScript('https://example.com/script.js', null, 'matching-hash'))).toBe(true)
    })

    it('fails secure when the pre-computed hash is missing or empty', () => {
      const matcher = new HashMatcher([createHashInfo('matching-hash')])

      expect(matcher.identify({ name: 'x', content: 'content' })).toBe(false)
      expect(matcher.identify(createDetectedScript('https://example.com/script.js', 'content', ''))).toBe(false)
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

    // ADAPTED (feature 011, evidence-aware matchers): this block previously
    // asserted a null/empty-content pre-gate on authorize(). The gate is now
    // evidence-specific — the hash is compared regardless of content, and the
    // fail-secure trigger is a missing/empty hash. Synthetic behaviour is
    // unchanged: compare() pre-gates null content before any matcher runs,
    // and synthetic scripts always carry content+hash.
    describe('evidence-aware authorisation without content (RUM inline observations)', () => {
      it('authorizes on a matching client-computed hash when content is null', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', null, 'hash123')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(true)
        expect(result.reason).toBeUndefined()
      })

      it('reports a hash mismatch (not a content failure) when content is null and the hash is wrong', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', null, 'tampered-hash')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('hash tampered-hash not in authorized list')
      })

      it('fails secure when content is null and NO hash was carried', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])

        const result = matcher.authorize({ name: 'inline_script/rum:len42', content: null })

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('hash is missing')
      })

      it('fails secure when the carried hash is an empty string', () => {
        const matcher = new HashMatcher([createHashInfo('hash123')])
        const script = createDetectedScript('https://example.com/script.js', 'content', '')

        const result = matcher.authorize(script)

        expect(result.authorized).toBe(false)
        expect(result.reason).toBe('hash is missing')
      })

      it('authorizes through an array-syntax OrMatcher of HashMatchers with null content and a matching hash', () => {
        // Array-syntax authoriseWith deserialises to an OrMatcher of the
        // alternatives; the composite must delegate rather than pre-gate on
        // content for hash evidence to reach the matching alternative.
        const composite = new OrMatcher([new HashMatcher([createHashInfo('other-hash')]), new HashMatcher([createHashInfo('hash123')])])
        const script = createDetectedScript('https://example.com/script.js', null, 'hash123')

        const result = composite.authorize(script)

        expect(result.authorized).toBe(true)
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
