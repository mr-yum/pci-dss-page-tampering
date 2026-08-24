/**
 * jsdom unit tests for inline-script fingerprinting: strict prefix/suffix
 * windows (incl. short content), the cheap pre-hash dedupe fingerprint, the
 * 512 KB hashing ceiling, multibyte byte-counting, and hash determinism.
 *
 * jsdom ships no `crypto.subtle` and no `TextEncoder`; Node's WebCrypto is
 * installed per-test so the REAL SHA-256 path is exercised (and its absence
 * is the degraded path, tested with the pristine jsdom global). It is pulled
 * in via `jest.requireActual` because the agent tsconfig deliberately has no
 * Node types — the page bundle must never touch Node built-ins.
 */
import { cheapInlineFingerprint, exceedsHashCeiling, FINGERPRINT_WINDOW_CHARS, fingerprintInline, hashInline, INLINE_HASH_CEILING_BYTES, utf8ByteLength } from './fingerprint.js'

const { webcrypto } = jest.requireActual('node:crypto') as { webcrypto: Crypto }

/**
 * The inline-valid.json fixture's script (139 chars): the head/tail/hash
 * assertions below pin this module to what the collector fixtures and the
 * novelty fallback identity already expect.
 */
const FIXTURE_SOURCE = "window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');"
const FIXTURE_HASH = 'e6fd3e32432da11443aadf6bd83d5464588956cec02521e635d56f11f7bfcffb'

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

function installWebCrypto(): void {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
}

afterEach(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
  else Reflect.deleteProperty(globalThis, 'crypto')
})

describe('fingerprintInline', () => {
  it('takes strict 128-char prefix and suffix windows from long content', () => {
    const { length, head, tail } = fingerprintInline(FIXTURE_SOURCE)
    expect(length).toBe(139)
    expect(head).toHaveLength(FINGERPRINT_WINDOW_CHARS)
    expect(tail).toHaveLength(FINGERPRINT_WINDOW_CHARS)
    expect(FIXTURE_SOURCE.startsWith(head)).toBe(true)
    expect(FIXTURE_SOURCE.endsWith(tail)).toBe(true)
    // Pinned to the shared fixture (test/fixtures/beacons/inline-valid.json).
    expect(head).toBe("window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E")
    expect(tail).toBe("Layer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EXAMPLE01');")
  })

  it('uses the whole source for both windows when content is ≤ 128 chars (strict prefix AND suffix of itself)', () => {
    const source = 'console.log("short")'
    expect(fingerprintInline(source)).toEqual({ length: source.length, head: source, tail: source })
    const exactly128 = 'a'.repeat(128)
    expect(fingerprintInline(exactly128)).toEqual({ length: 128, head: exactly128, tail: exactly128 })
  })

  it('handles empty content', () => {
    expect(fingerprintInline('')).toEqual({ length: 0, head: '', tail: '' })
  })

  it('slices by code units at a multibyte boundary and stays within the schema cap', () => {
    // The 128th code unit falls inside the surrogate pair of 😀 (U+1F600).
    const source = `${'a'.repeat(127)}\u{1F600}${'b'.repeat(64)}`
    const { length, head, tail } = fingerprintInline(source)
    expect(length).toBe(source.length)
    expect(head).toHaveLength(128) // schema max(128) counts code units
    expect(tail).toHaveLength(128)
    expect(source.startsWith(head)).toBe(true)
    expect(source.endsWith(tail)).toBe(true)
  })
})

describe('cheapInlineFingerprint', () => {
  it('is deterministic and cheap-window sensitive', () => {
    expect(cheapInlineFingerprint(FIXTURE_SOURCE)).toBe(cheapInlineFingerprint(FIXTURE_SOURCE))
    expect(cheapInlineFingerprint(`X${FIXTURE_SOURCE.slice(1)}`)).not.toBe(cheapInlineFingerprint(FIXTURE_SOURCE))
    expect(cheapInlineFingerprint(`${FIXTURE_SOURCE.slice(0, -1)}X`)).not.toBe(cheapInlineFingerprint(FIXTURE_SOURCE))
    expect(cheapInlineFingerprint(`${FIXTURE_SOURCE}!`)).not.toBe(cheapInlineFingerprint(FIXTURE_SOURCE))
  })

  it('embeds the length so equal windows with different middles of different sizes never collide', () => {
    const a = `${'x'.repeat(64)}${'-'.repeat(10)}${'y'.repeat(64)}`
    const b = `${'x'.repeat(64)}${'-'.repeat(20)}${'y'.repeat(64)}`
    expect(cheapInlineFingerprint(a)).not.toBe(cheapInlineFingerprint(b))
  })
})

describe('utf8ByteLength / exceedsHashCeiling', () => {
  it('counts multibyte characters in BYTES, not chars', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('€')).toBe(3) // one char, three bytes
    expect(utf8ByteLength('\u{1F600}')).toBe(4) // two code units, four bytes
  })

  it('trips the ceiling on byte length even when the char count is far below it', () => {
    // 200 000 chars of € encode to 600 000 bytes > 524 288.
    const multibyte = '€'.repeat(200_000)
    expect(multibyte.length).toBeLessThan(INLINE_HASH_CEILING_BYTES)
    expect(exceedsHashCeiling(multibyte)).toBe(true)
    // The same char count in ASCII stays comfortably under.
    expect(exceedsHashCeiling('a'.repeat(200_000))).toBe(false)
  })

  it('is inclusive at exactly the ceiling', () => {
    expect(exceedsHashCeiling('a'.repeat(INLINE_HASH_CEILING_BYTES))).toBe(false)
    expect(exceedsHashCeiling('a'.repeat(INLINE_HASH_CEILING_BYTES + 1))).toBe(true)
  })
})

describe('hashInline', () => {
  it('produces the deterministic SHA-256 hex the collector fixtures pin', async () => {
    installWebCrypto()
    await expect(hashInline(FIXTURE_SOURCE)).resolves.toBe(FIXTURE_HASH)
    await expect(hashInline(FIXTURE_SOURCE)).resolves.toBe(FIXTURE_HASH)
    // Known SHA-256 test vector.
    await expect(hashInline('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes multibyte content over its UTF-8 bytes', async () => {
    installWebCrypto()
    // Precomputed: sha256 of the 7 UTF-8 bytes of '€😀'.
    await expect(hashInline('€😀')).resolves.toBe('aa6ac38b88868c15ec32bf6cca0dda3ffa2595bdf3e1ae98c328b799f889b9ac')
  })

  it('returns undefined above the hashing ceiling without digesting', async () => {
    installWebCrypto()
    const digestSpy = jest.spyOn(webcrypto.subtle, 'digest')
    try {
      await expect(hashInline('€'.repeat(200_000))).resolves.toBeUndefined()
      await expect(hashInline('a'.repeat(INLINE_HASH_CEILING_BYTES + 1))).resolves.toBeUndefined()
      expect(digestSpy).not.toHaveBeenCalled()
    } finally {
      digestSpy.mockRestore()
    }
  })

  it('hashes content at exactly the ceiling', async () => {
    installWebCrypto()
    await expect(hashInline('a'.repeat(INLINE_HASH_CEILING_BYTES))).resolves.toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns undefined when crypto.subtle is unavailable (jsdom default) instead of throwing', async () => {
    // Pristine jsdom global: crypto exists but has no SubtleCrypto.
    expect((globalThis.crypto as Crypto | undefined)?.subtle).toBeUndefined()
    await expect(hashInline('console.log(1)')).resolves.toBeUndefined()
  })

  it('returns undefined when the digest itself rejects', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: () => Promise.reject(new Error('insecure context')) } },
    })
    await expect(hashInline('console.log(1)')).resolves.toBeUndefined()
  })
})
